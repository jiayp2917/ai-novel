import json
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.file_utils import safe_read_text
from backend.app.db.models import SourceFile
from backend.app.services.annotations import InvalidRequestError, NotFoundError
from backend.app.services.artifacts import ArtifactStore
from backend.app.services.model_client import ChatMessage, ModelClient
from backend.app.services.workspace import WorkspaceResolver


CHAPTER_HEADING_RE = re.compile(r"^\ufeff?[ \t]*#{0,6}[ \t]*第[ \t]*0*(\d+)[ \t]*章[^\n]*$", re.MULTILINE)
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

    def _chapter_block(self, text: str, chapter_no: int) -> str:
        matches = list(CHAPTER_HEADING_RE.finditer(text))
        for index, match in enumerate(matches):
            if int(match.group(1)) != chapter_no:
                continue
            start = match.start()
            end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
            return text[start:end].strip()
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
