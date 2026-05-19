import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.file_utils import safe_read_text
from backend.app.core.config import get_settings
from backend.app.db.models import Annotation, SourceFile
from backend.app.services.annotations import InvalidRequestError, NotFoundError
from backend.app.services.artifacts import ArtifactStore
from backend.app.services.model_client import ChatMessage, ModelClient
from backend.app.services.workspace import WorkspaceResolver


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
