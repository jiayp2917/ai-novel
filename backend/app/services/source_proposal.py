import json
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.file_utils import safe_read_text
from backend.app.core.config import get_settings
from backend.app.db.models import Annotation, Artifact, MemoryItem, SourceFile
from backend.app.services.annotations import InvalidRequestError, NotFoundError
from backend.app.services.artifacts import ArtifactStore
from backend.app.services.model_client import ChatMessage, ModelClient
from backend.app.services.workspace import WorkspaceResolver, workspace_runtime_root
from backend.app.utils.hashing import sha256_file


class SourceProposalService:
    def __init__(self, session: Session, *, model_client: ModelClient | None = None) -> None:
        self.session = session
        self.model_client = model_client or ModelClient(session)
        self.settings = get_settings()
        self.workspace = WorkspaceResolver()

    def generate_proposal(self, source_file_id: int, *, annotation_ids: list[int] | None = None) -> dict:
        source_file = self.session.get(SourceFile, source_file_id)
        if source_file is None or not source_file.active:
            raise NotFoundError("Source file not found")
        if source_file.kind not in {"settings", "outlines"}:
            raise InvalidRequestError("Only settings and outlines can use source proposals")
        annotations = self._annotations(source_file_id, annotation_ids)
        text = safe_read_text(self.workspace.resolve_source_path(source_file.path), encoding="utf-8-sig")
        role = "outliner" if source_file.kind == "outlines" else "structural_fix"
        response = self.model_client.chat(
            role=role,
            messages=[
                ChatMessage(
                    role="system",
                    content=(
                        "You produce a complete Markdown proposal for a settings or outline source file. "
                        "Keep existing useful structure. Return only Markdown, no explanations."
                    ),
                ),
                ChatMessage(
                    role="user",
                    content=json.dumps(
                        {
                            "source_kind": source_file.kind,
                            "source_path": source_file.path,
                            "current_markdown": text,
                            "annotations": [
                                {
                                    "id": annotation.id,
                                    "type": annotation.type,
                                    "severity": annotation.severity,
                                    "quote": annotation.quote_text,
                                    "comment": annotation.comment,
                                    "example_rewrite": annotation.example_rewrite,
                                }
                                for annotation in annotations
                            ],
                        },
                        ensure_ascii=False,
                    ),
                ),
            ],
            require_json=False,
            temperature=0.3,
        )
        artifact = ArtifactStore(self.session).save_text(
            kind="proposal",
            text=response.content,
            metadata={
                "purpose": "source_file_proposal",
                "task_type": "generate_source_proposal",
                "source_file_id": source_file.id,
                "source_kind": source_file.kind,
                "annotation_ids": [annotation.id for annotation in annotations],
                "model_call_id": response.model_call_id,
                "role": response.route.role,
                "provider": response.route.provider,
                "model": response.route.model,
            },
            base_source_file=source_file,
        )
        self.session.commit()
        return {
            "artifact_id": artifact.id,
            "artifact_path": artifact.path,
            "artifact_sha256": artifact.sha256,
            "source_file_id": source_file.id,
        }

    def generate_work_profile_proposal(self, source_file_id: int, *, force: bool = False) -> dict:
        source_file = self.session.get(SourceFile, source_file_id)
        if source_file is None or not source_file.active:
            raise NotFoundError("Source file not found")
        if source_file.kind != "settings":
            raise InvalidRequestError("Work profile proposals can only use settings sources")
        text = safe_read_text(self.workspace.resolve_source_path(source_file.path), encoding="utf-8-sig")
        response = self.model_client.chat(
            role="outliner",
            messages=[
                ChatMessage(
                    role="system",
                    content=(
                        "You create a concise public-safe novel work profile from confirmed settings. "
                        "Return Markdown only. Do not invent facts outside the supplied source."
                    ),
                ),
                ChatMessage(
                    role="user",
                    content=json.dumps(
                        {
                            "task": "generate_work_profile_proposal",
                            "source_path": source_file.path,
                            "current_markdown": text,
                            "template": [
                                "作品定位",
                                "核心卖点",
                                "主角目标",
                                "世界规则",
                                "爽点机制",
                                "风格边界",
                                "禁止新增或改写的事实",
                            ],
                        },
                        ensure_ascii=False,
                    ),
                ),
            ],
            require_json=False,
            force=force,
            temperature=0.25,
        )
        artifact = ArtifactStore(self.session).save_text(
            kind="proposal",
            text=response.content,
            metadata={
                "purpose": "work_profile_proposal",
                "task_type": "generate_work_profile_proposal",
                "profile_type": "work_profile",
                "source_file_id": source_file.id,
                "source_kind": source_file.kind,
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
        }

    def confirm_work_profile(self, artifact_id: int) -> dict:
        artifact = self.session.get(Artifact, artifact_id)
        if artifact is None:
            raise NotFoundError("Artifact not found")
        metadata = _artifact_metadata(artifact)
        if artifact.kind != "proposal" or metadata.get("purpose") != "work_profile_proposal":
            raise InvalidRequestError("Artifact is not a work profile proposal")
        source_file = self.session.get(SourceFile, artifact.base_source_file_id)
        if source_file is None or not source_file.active:
            raise NotFoundError("Source file not found")
        if source_file.sha256 != artifact.base_source_file_hash:
            raise InvalidRequestError("Source file hash changed; regenerate work profile proposal")
        runtime_root = workspace_runtime_root().resolve()
        path = (runtime_root / artifact.path).resolve()
        if path != runtime_root and runtime_root not in path.parents:
            raise InvalidRequestError("Artifact path escapes runtime root")
        if sha256_file(path) != artifact.sha256:
            raise InvalidRequestError("Artifact file hash mismatch")
        profile_markdown = safe_read_text(path, encoding="utf-8")
        payload = {
            "source": "confirmed_work_profile",
            "profile_markdown": profile_markdown,
            "source_file_id": source_file.id,
            "source_path": source_file.path,
            "artifact_id": artifact.id,
            "artifact_sha256": artifact.sha256,
            "confirmed_at": datetime.now(UTC).isoformat(),
        }
        for item in self.session.scalars(
            select(MemoryItem).where(
                MemoryItem.kind == "work_profile",
                MemoryItem.scope == "global",
                MemoryItem.stale.is_(False),
            )
        ):
            if _memory_payload(item).get("source") == "confirmed_work_profile":
                item.stale = True
        memory = MemoryItem(
            kind="work_profile",
            scope="global",
            content_json=json.dumps(payload, ensure_ascii=False),
            source_hash=artifact.sha256,
            stale=False,
        )
        self.session.add(memory)
        metadata["canonical"] = True
        metadata["confirmed_memory_kind"] = "work_profile"
        artifact.metadata_json = json.dumps(metadata, ensure_ascii=False)
        self.session.commit()
        return {
            "artifact_id": artifact.id,
            "memory_id": memory.id,
            "memory_kind": memory.kind,
            "confirmed": True,
        }

    def _annotations(self, source_file_id: int, annotation_ids: list[int] | None) -> list[Annotation]:
        statement = select(Annotation).where(Annotation.source_file_id == source_file_id, Annotation.chapter_id.is_(None))
        if annotation_ids:
            statement = statement.where(Annotation.id.in_(annotation_ids), Annotation.status.in_(["open", "needs_relocate"]))
        else:
            statement = statement.where(Annotation.status.in_(["open", "needs_relocate"]))
        annotations = list(self.session.scalars(statement.order_by(Annotation.id)))
        if annotation_ids and len(annotations) != len(set(annotation_ids)):
            raise InvalidRequestError("Some annotations do not belong to this source file or are not active")
        return annotations


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
