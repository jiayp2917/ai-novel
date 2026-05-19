import json
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.config import get_settings
from backend.app.db.models import Artifact, Chapter, Review
from backend.app.services.annotations import NotFoundError
from backend.app.services.artifacts import ArtifactStore
from backend.app.services.context_builder import ContextBuilder
from backend.app.services.model_client import ChatMessage, ModelClient
from backend.app.services.workspace import workspace_runtime_root
from backend.app.utils.hashing import sha256_file


class PipelineFixError(ValueError):
    pass


class ChatRunner(Protocol):
    def chat(self, *, role: str, messages: list[ChatMessage], **kwargs):
        ...


class FixerService:
    def __init__(self, session: Session, *, model_client: ChatRunner | None = None) -> None:
        self.session = session
        self.settings = get_settings()
        self.model_client = model_client or ModelClient(session)
        self.runtime_root = workspace_runtime_root()

    def fix_candidate(self, artifact_id: int, *, review_id: int | None = None, force: bool = False) -> dict:
        artifact = self._artifact(artifact_id)
        self._validate_artifact_file(artifact)
        chapter = self._base_chapter(artifact)
        review = self._review(artifact_id, review_id)
        issues = json.loads(review.issues_json or "[]")
        if not isinstance(issues, list):
            issues = []
        non_writer = [issue for issue in issues if isinstance(issue, dict) and issue.get("owner") != "writer"]
        if non_writer:
            return {
                "status": "manual_required",
                "artifact_id": artifact.id,
                "review_id": review.id,
                "issues": non_writer,
            }
        writer_issues = [issue for issue in issues if isinstance(issue, dict) and issue.get("owner") == "writer"]
        if not writer_issues:
            return {
                "status": "no_fix_needed",
                "artifact_id": artifact.id,
                "review_id": review.id,
                "issues": [],
            }
        context = ContextBuilder(self.session).build(
            chapter_id=chapter.id,
            annotation_ids=[],
            task_type="fix_chapter_candidate",
        )
        candidate = self._artifact_text(artifact)
        response = self.model_client.chat(
            role="quick_fix",
            force=force,
            require_json=False,
            temperature=0.4,
            messages=[
                ChatMessage(
                    role="system",
                    content=(
                        "你是正文修复模型。只能依据审核问题修复当前单章正文。"
                        "禁止新增设定、角色、支线；只输出修复后的完整单章 Markdown 正文。"
                    ),
                ),
                ChatMessage(role="user", content=self._prompt(candidate, writer_issues, context.context)),
            ],
        )
        fixed = ArtifactStore(self.session).save_text(
            kind="candidate",
            text=response.content,
            metadata={
                "task_type": "fix_chapter_candidate",
                "parent_artifact_id": artifact.id,
                "review_id": review.id,
                "fixed_issue_count": len(writer_issues),
                "context_report": context.report,
                "context_report_artifact_id": context.report_artifact_id,
                "model_call_id": response.model_call_id,
                "role": response.route.role,
                "provider": response.route.provider,
                "model": response.route.model,
            },
            base_chapter=chapter,
        )
        self.session.commit()
        return {
            "status": "fixed",
            "artifact_id": fixed.id,
            "artifact_path": fixed.path,
            "artifact_sha256": fixed.sha256,
            "parent_artifact_id": artifact.id,
            "review_id": review.id,
            "model_call_id": response.model_call_id,
        }

    def _prompt(self, candidate: str, issues: list[dict], context: str) -> str:
        return json.dumps(
            {
                "context": context,
                "candidate": candidate,
                "writer_issues": issues,
                "rules": [
                    "只处理 writer 问题。",
                    "不得修改设定、大纲、章纲。",
                    "不得新增未提供的信息。",
                    "保留当前章节标题。",
                    "输出完整单章正文，不输出解释。",
                ],
            },
            ensure_ascii=False,
        )

    def _review(self, artifact_id: int, review_id: int | None) -> Review:
        if review_id is not None:
            review = self.session.get(Review, review_id)
            if review is None or review.artifact_id != artifact_id:
                raise PipelineFixError("Review does not belong to artifact")
            return review
        review = self.session.scalar(select(Review).where(Review.artifact_id == artifact_id).order_by(Review.id.desc()))
        if review is None:
            raise PipelineFixError("Candidate has no review")
        return review

    def _artifact(self, artifact_id: int) -> Artifact:
        artifact = self.session.get(Artifact, artifact_id)
        if artifact is None:
            raise NotFoundError("Artifact not found")
        return artifact

    def _base_chapter(self, artifact: Artifact) -> Chapter:
        if artifact.base_chapter_id is None:
            raise PipelineFixError("Candidate artifact is not bound to a chapter")
        chapter = self.session.get(Chapter, artifact.base_chapter_id)
        if chapter is None:
            raise PipelineFixError("Base chapter not found")
        return chapter

    def _artifact_text(self, artifact: Artifact) -> str:
        return self._runtime_safe_path(artifact.path).read_text(encoding="utf-8")

    def _validate_artifact_file(self, artifact: Artifact) -> None:
        path = self._runtime_safe_path(artifact.path)
        if not path.exists():
            raise PipelineFixError("Artifact file is missing")
        if sha256_file(path) != artifact.sha256:
            raise PipelineFixError("Artifact file hash mismatch")

    def _runtime_safe_path(self, relative_path: str):
        root = self.runtime_root.resolve()
        path = (root / relative_path).resolve()
        if path != root and root not in path.parents:
            raise PipelineFixError("Artifact path escapes runtime root")
        return path
