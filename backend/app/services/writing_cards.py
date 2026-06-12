import json
import re
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.file_utils import safe_read_text
from backend.app.db.models import Artifact, MemoryItem, SourceFile
from backend.app.services.annotations import InvalidRequestError, NotFoundError
from backend.app.services.artifacts import ArtifactStore
from backend.app.services.model_client import ChatMessage, ModelClient
from backend.app.services.workspace import WorkspaceResolver, workspace_runtime_root
from backend.app.utils.hashing import sha256_file


CHAPTER_HEADING_RE = re.compile(r"^\ufeff?[ \t]*#{0,6}[ \t]*第[ \t]*0*(\d+)[ \t]*章[^\n]*$", re.MULTILINE)
CHAPTER_TABLE_ROW_RE = re.compile(r"^\ufeff?[ \t]*\|[ \t]*0*(\d+)[ \t]*\|[^\n]*$", re.MULTILINE)
VALID_GENERATION_MODES = {"stable", "quality", "fast"}


class WritingCardService:
    def __init__(self, session: Session, *, model_client: ModelClient | None = None) -> None:
        self.session = session
        self.model_client = model_client or ModelClient(session)
        self.workspace = WorkspaceResolver()

    def generate_card(
        self,
        source_file_id: int,
        *,
        chapter_no: int,
        generation_mode: str = "stable",
        force: bool = False,
    ) -> dict:
        if generation_mode not in VALID_GENERATION_MODES:
            raise InvalidRequestError("generation_mode must be one of: stable, quality, fast")
        if chapter_no <= 0:
            raise InvalidRequestError("chapter_no must be positive")
        source_file = self.session.get(SourceFile, source_file_id)
        if source_file is None or not source_file.active:
            raise NotFoundError("Source file not found")
        if source_file.kind != "outlines":
            raise InvalidRequestError("Writing cards can only be generated from outline sources")

        text = safe_read_text(self.workspace.resolve_source_path(source_file.path), encoding="utf-8-sig")
        chapter_block = self._chapter_block(text, chapter_no)
        response = self.model_client.chat(
            role="outliner",
            messages=[
                ChatMessage(
                    role="system",
                    content=(
                        "你是通用长篇小说的单章写作卡生成器。"
                        "只输出 Markdown 写作卡，不输出解释。"
                        "写作卡用于稳定生成单章正文，不能新增已确认设定之外的事实。"
                    ),
                ),
                ChatMessage(
                    role="user",
                    content=json.dumps(
                        {
                            "task": "generate_chapter_writing_card",
                            "chapter_no": chapter_no,
                            "generation_mode": generation_mode,
                            "source_path": source_file.path,
                            "outline_block": chapter_block,
                            "required_fields": [
                                "章节编号",
                                "章节标题",
                                "本章目标",
                                "场景",
                                "出场人物",
                                "冲突/机制",
                                "常规解法或常规推进",
                                "主角行动",
                                "情绪点/爽点/悬念点",
                                "配角反应",
                                "结尾钩子",
                                "禁写项",
                                "字数范围",
                                "风格摘要",
                            ],
                        },
                        ensure_ascii=False,
                    ),
                ),
            ],
            force=force,
            require_json=False,
            temperature=self._temperature(generation_mode),
        )
        artifact = ArtifactStore(self.session).save_text(
            kind="proposal",
            text=response.content,
            metadata={
                "purpose": "chapter_writing_card",
                "task_type": "generate_chapter_writing_card",
                "source_file_id": source_file.id,
                "source_kind": source_file.kind,
                "chapter_no": chapter_no,
                "generation_mode": generation_mode,
                "model_call_id": response.model_call_id,
                "role": response.route.role,
                "provider": response.route.provider,
                "model": response.route.model,
                "canonical": False,
            },
            base_source_file=source_file,
        )
        self.session.commit()
        return {
            "artifact_id": artifact.id,
            "artifact_path": artifact.path,
            "artifact_sha256": artifact.sha256,
            "source_file_id": source_file.id,
            "chapter_no": chapter_no,
            "generation_mode": generation_mode,
        }

    def confirm_card(self, artifact_id: int) -> dict:
        artifact = self.session.get(Artifact, artifact_id)
        if artifact is None:
            raise NotFoundError("Artifact not found")
        metadata = _artifact_metadata(artifact)
        if artifact.kind != "proposal" or metadata.get("purpose") != "chapter_writing_card":
            raise InvalidRequestError("Artifact is not a chapter writing card proposal")
        chapter_no = int(metadata.get("chapter_no") or 0)
        if chapter_no <= 0:
            raise InvalidRequestError("Writing card proposal is missing chapter_no")
        source_file = self.session.get(SourceFile, artifact.base_source_file_id)
        if source_file is None or not source_file.active:
            raise NotFoundError("Source file not found")
        if source_file.sha256 != artifact.base_source_file_hash:
            raise InvalidRequestError("Source file hash changed; regenerate writing card")
        runtime_root = workspace_runtime_root().resolve()
        path = (runtime_root / artifact.path).resolve()
        if path != runtime_root and runtime_root not in path.parents:
            raise InvalidRequestError("Artifact path escapes runtime root")
        if sha256_file(path) != artifact.sha256:
            raise InvalidRequestError("Artifact file hash mismatch")
        card_markdown = safe_read_text(path, encoding="utf-8")
        payload = {
            "chapter_no": chapter_no,
            "source": "confirmed_writing_card",
            "card_markdown": card_markdown,
            "source_file_id": source_file.id,
            "source_path": source_file.path,
            "artifact_id": artifact.id,
            "artifact_sha256": artifact.sha256,
            "generation_mode": metadata.get("generation_mode") or "stable",
            "confirmed_at": datetime.now(UTC).isoformat(),
        }
        for item in self.session.scalars(
            select(MemoryItem).where(
                MemoryItem.kind == "chapter_card",
                MemoryItem.scope == str(chapter_no),
                MemoryItem.stale.is_(False),
            )
        ):
            if _memory_payload(item).get("source") == "confirmed_writing_card":
                item.stale = True
        memory = MemoryItem(
            kind="chapter_card",
            scope=str(chapter_no),
            content_json=json.dumps(payload, ensure_ascii=False),
            source_hash=artifact.sha256,
            stale=False,
        )
        self.session.add(memory)
        metadata["canonical"] = True
        metadata["confirmed_memory_kind"] = "chapter_card"
        artifact.metadata_json = json.dumps(metadata, ensure_ascii=False)
        self.session.commit()
        return {
            "artifact_id": artifact.id,
            "chapter_no": chapter_no,
            "memory_id": memory.id,
            "memory_kind": memory.kind,
            "confirmed": True,
        }

    def _chapter_block(self, text: str, chapter_no: int) -> str:
        matches = list(CHAPTER_HEADING_RE.finditer(text))
        for index, match in enumerate(matches):
            if int(match.group(1)) != chapter_no:
                continue
            start = match.start()
            end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
            return text[start:end].strip()
        for match in CHAPTER_TABLE_ROW_RE.finditer(text):
            if int(match.group(1)) == chapter_no:
                return match.group(0).strip()
        raise InvalidRequestError("Outline source does not contain the requested chapter")

    def _temperature(self, generation_mode: str) -> float:
        if generation_mode == "stable":
            return 0.25
        if generation_mode == "quality":
            return 0.35
        return 0.5


def normalize_generation_mode(value: str | None) -> str:
    mode = (value or "stable").strip().lower()
    if mode not in VALID_GENERATION_MODES:
        raise InvalidRequestError("generation_mode must be one of: stable, quality, fast")
    return mode


def _artifact_metadata(artifact: Artifact) -> dict:
    try:
        payload = json.loads(artifact.metadata_json or "{}")
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _memory_payload(item: MemoryItem) -> dict:
    try:
        payload = json.loads(item.content_json or "{}")
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}
