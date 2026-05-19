import json
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.file_utils import safe_read_text
from backend.app.db.models import Artifact, Chapter, Job
from backend.app.repositories import Repository
from backend.app.services.annotations import InvalidRequestError, NotFoundError
from backend.app.services.artifacts import ArtifactStore
from backend.app.services.context_builder import ContextBuilder
from backend.app.services.model_client import ChatMessage, ModelClient


class ChatRunner(Protocol):
    def chat(
        self,
        *,
        role: str,
        messages: list[ChatMessage],
        force: bool = False,
        require_json: bool = False,
        temperature: float = 0.2,
        max_tokens: int | None = None,
    ):
        ...


class RevisionService:
    def __init__(self, session: Session, *, model_client: ChatRunner | None = None) -> None:
        self.session = session
        self.jobs = Repository(session, Job)
        self.model_client = model_client or ModelClient(session)

    def create_revision_job(
        self,
        *,
        chapter_id: int,
        annotation_ids: list[int],
    ) -> Job:
        chapter = self.session.get(Chapter, chapter_id)
        if chapter is None or not chapter.active:
            raise NotFoundError("Chapter not found")
        if chapter.current_version is None:
            raise InvalidRequestError("Chapter has no current version")
        existing = self._running_job(chapter_id)
        if existing is not None:
            raise InvalidRequestError(f"Chapter already has a running revision job: {existing.id}")

        job = self.jobs.create(
            {
                "type": "revise_from_annotations",
                "status": "queued",
                "payload_json": json.dumps(
                    {"chapter_id": chapter_id, "annotation_ids": annotation_ids},
                    ensure_ascii=False,
                ),
                "locked_chapter_id": chapter_id,
                "locked_source_file_id": chapter.source_file_id,
            }
        )
        self.session.commit()
        return job

    def revise_from_annotations(
        self,
        *,
        chapter_id: int,
        annotation_ids: list[int],
        force: bool = False,
    ) -> dict:
        job = self.create_revision_job(chapter_id=chapter_id, annotation_ids=annotation_ids)
        return {
            "job_id": job.id,
            "status": job.status,
            "artifact_id": None,
            "artifact_path": None,
            "artifact_sha256": None,
        }

    def run_revision_job(self, job_id: int, *, force: bool = False) -> dict:
        job = self.session.get(Job, job_id)
        if job is None:
            raise NotFoundError("Job not found")
        if job.type != "revise_from_annotations":
            raise InvalidRequestError("Unsupported job type")
        if job.status != "running":
            raise InvalidRequestError(f"Job is not runnable: {job.status}")
        payload = json.loads(job.payload_json)
        chapter_id = int(payload["chapter_id"])
        annotation_ids = list(payload.get("annotation_ids", []))
        chapter = self.session.get(Chapter, chapter_id)
        if chapter is None or not chapter.active:
            raise NotFoundError("Chapter not found")
        try:
            context = ContextBuilder(self.session).build(
                chapter_id=chapter_id,
                annotation_ids=annotation_ids,
                task_type="revise_from_annotations",
            )
            response = self.model_client.chat(
                role="fixer",
                messages=[
                    ChatMessage(
                        role="system",
                        content=(
                            "You revise a single Markdown chapter from user annotations. "
                            "Return only the complete revised chapter. Keep the original chapter heading unchanged."
                        ),
                    ),
                    ChatMessage(role="user", content=context.context),
                ],
                force=force,
                require_json=False,
                temperature=0.4,
            )
            artifact = ArtifactStore(self.session).save_text(
                kind="candidate",
                text=response.content,
                metadata={
                    "job_id": job.id,
                    "task_type": "revise_from_annotations",
                    "context_report": context.report,
                    "context_report_artifact_id": context.report_artifact_id,
                    "model_call_id": response.model_call_id,
                    "role": response.route.role,
                    "provider": response.route.provider,
                    "model": response.route.model,
                },
                base_chapter=chapter,
            )
            job.status = "succeeded"
            job.result_json = json.dumps({"artifact_id": artifact.id}, ensure_ascii=False)
            self.session.commit()
            return self._result(job, artifact)
        except Exception as exc:
            job.status = "paused_budget" if "budget" in str(exc).lower() else "manual_required"
            job.error = str(exc)
            self.session.commit()
            raise

    def _running_job(self, chapter_id: int) -> Job | None:
        return self.session.scalar(
            select(Job)
            .where(
                Job.type == "revise_from_annotations",
                Job.locked_chapter_id == chapter_id,
                Job.status.in_(["queued", "running"]),
            )
            .order_by(Job.id.desc())
        )

    def _result(self, job: Job, artifact: Artifact) -> dict:
        return {
            "job_id": job.id,
            "status": job.status,
            "artifact_id": artifact.id,
            "artifact_path": artifact.path,
            "artifact_sha256": artifact.sha256,
        }


def create_snapshot_candidate_for_chapter(session: Session, chapter: Chapter) -> Artifact:
    if chapter.current_version is None:
        raise InvalidRequestError("Chapter has no current version")
    from backend.app.services.workspace import WorkspaceResolver

    source_path = WorkspaceResolver().resolve_source_path(chapter.source_file.path)
    full_text = safe_read_text(source_path, encoding="utf-8-sig")
    candidate_text = full_text[chapter.range_start : chapter.range_end]
    artifact = ArtifactStore(session).save_text(
        kind="candidate",
        text=candidate_text,
        metadata={
            "purpose": "pipeline_review_snapshot",
            "source": "existing_chapter_snapshot",
            "chapter_no": chapter.chapter_no,
        },
        base_chapter=chapter,
    )
    session.commit()
    return artifact
