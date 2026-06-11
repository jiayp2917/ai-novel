import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.db.models import Artifact, Chapter, Job, Review
from backend.app.services.annotations import NotFoundError
from backend.app.services.pipeline.fixer import FixerService
from backend.app.services.pipeline.planner import PipelineTaskType
from backend.app.services.pipeline.reviewer import ReviewerService
from backend.app.services.pipeline.runs import DIRECT_PUBLISH_ERROR, PipelineRunService, _direct_publish_allowed
from backend.app.services.pipeline.state_machine import PipelineState, PipelineStateMachine, job_payload, job_result
from backend.app.services.pipeline.summarizer import SummarizerService
from backend.app.services.pipeline.writer import WriterService
from backend.app.services.revision import create_snapshot_candidate_for_chapter
from backend.app.services.review_publish import ReviewPublishService
from backend.app.services.writing_cards import normalize_generation_mode


class PipelineTaskExecutor:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.machine = PipelineStateMachine(session)

    def run_job(self, job_id: int) -> dict[str, Any]:
        job = self.session.get(Job, job_id)
        if job is None:
            raise NotFoundError("Job not found")
        if job.status != "running":
            raise ValueError(f"Job is not runnable: {job.status}")
        try:
            result = self._run_by_type(job)
        except Exception as exc:
            self._fail_job(job, exc)
            raise
        self._refresh_parent(job)
        return result

    def _run_by_type(self, job: Job) -> dict[str, Any]:
        if job.type == PipelineTaskType.PIPELINE_RUN.value:
            return self._run_pipeline_run(job)
        if job.type == PipelineTaskType.GENERATE_CHAPTER_DRAFT.value:
            return self._run_generate_chapter_draft(job)
        if job.type == PipelineTaskType.REVIEW_CHAPTER_CANDIDATE.value:
            return self._run_review_chapter_candidate(job)
        if job.type == PipelineTaskType.FIX_CHAPTER_CANDIDATE.value:
            return self._run_fix_chapter_candidate(job)
        if job.type == PipelineTaskType.PUBLISH_CHAPTER_CANDIDATE.value:
            return self._run_publish_chapter_candidate(job)
        if job.type == PipelineTaskType.SUMMARIZE_PUBLISHED_CHAPTER.value:
            return self._run_summarize_published_chapter(job)
        raise ValueError(f"Unsupported job type: {job.type}")

    def _run_pipeline_run(self, job: Job) -> dict[str, Any]:
        result = PipelineRunService(self.session).queue_children(job.id)
        self.machine.transition(
            job,
            PipelineState.CONTEXT_BUILT,
            result_updates={"queued_children": result["queued_children"]},
            error=None,
        )
        return result

    def _run_generate_chapter_draft(self, job: Job) -> dict[str, Any]:
        chapter = self._chapter(job)
        payload = job_payload(job)
        generation_mode = normalize_generation_mode(payload.get("generation_mode"))
        result = WriterService(self.session).generate_chapter_draft(chapter.id, generation_mode=generation_mode)
        self.machine.transition(
            job,
            PipelineState.DONE,
            result_updates={
                "artifact_id": result["artifact_id"],
                "artifact_path": result["artifact_path"],
                "artifact_sha256": result["artifact_sha256"],
                "model_call_id": result["model_call_id"],
                "generation_mode": generation_mode,
            },
            payload_updates={"execution": "executed"},
            error=None,
        )
        return result

    def _run_review_chapter_candidate(self, job: Job) -> dict[str, Any]:
        artifact_id = self._candidate_artifact_id(job)
        result = ReviewerService(self.session).review_candidate(artifact_id)
        if result["passed"]:
            target = PipelineState.APPROVED
            error = None
        elif self._has_only_writer_issues(result["issues"]):
            target = PipelineState.DONE
            error = "Review found writer issues; queued fixer may continue"
        else:
            target = PipelineState.MANUAL_REQUIRED
            error = "Review did not pass"
        self.machine.transition(
            job,
            target,
            result_updates={
                "artifact_id": artifact_id,
                "review_id": result["review_id"],
                "passed": result["passed"],
                "manual_required": result["manual_required"],
                "model_call_id": result["model_call_id"],
            },
            payload_updates={"execution": "executed"},
            error=error,
        )
        return result

    def _run_fix_chapter_candidate(self, job: Job) -> dict[str, Any]:
        artifact_id = self._candidate_artifact_id(job)
        review_id = self._latest_review_id(artifact_id)
        result = FixerService(self.session).fix_candidate(artifact_id, review_id=review_id)
        if result["status"] == "fixed":
            self.machine.transition(
                job,
                PipelineState.DONE,
                result_updates={
                    "artifact_id": result["artifact_id"],
                    "parent_artifact_id": result["parent_artifact_id"],
                    "review_id": result["review_id"],
                    "model_call_id": result["model_call_id"],
                },
                payload_updates={"execution": "executed"},
                error=None,
            )
        elif result["status"] == "no_fix_needed":
            self.machine.transition(
                job,
                PipelineState.DONE,
                result_updates={"artifact_id": artifact_id, "review_id": result["review_id"], "no_fix_needed": True},
                payload_updates={"execution": "executed"},
                error=None,
            )
        else:
            self.machine.transition(
                job,
                PipelineState.MANUAL_REQUIRED,
                result_updates={"artifact_id": artifact_id, "review_id": result["review_id"], "issues": result["issues"]},
                payload_updates={"execution": "executed"},
                error="Non-writer issues require manual handling",
            )
        return result

    def _run_publish_chapter_candidate(self, job: Job) -> dict[str, Any]:
        artifact_id = self._candidate_artifact_id(job)
        if bool(job_payload(job).get("dry_run", True)):
            diff = ReviewPublishService(self.session).diff_artifact(artifact_id)
            result = {
                "artifact_id": artifact_id,
                "dry_run": True,
                "diff_chars": len(diff["diff"]),
                "published": False,
            }
            self.machine.transition(
                job,
                PipelineState.DONE,
                result_updates=result,
                payload_updates={"execution": "executed"},
                error=None,
            )
            return result
        if not _direct_publish_allowed():
            result = {"artifact_id": artifact_id, "dry_run": False, "published": False, "manual_required": True}
            self.machine.transition(
                job,
                PipelineState.MANUAL_REQUIRED,
                result_updates=result,
                payload_updates={"execution": "blocked"},
                error=DIRECT_PUBLISH_ERROR,
            )
            return result
        result = ReviewPublishService(self.session).publish_artifact(artifact_id, approved_by_user=True)
        self.machine.transition(
            job,
            PipelineState.PUBLISHED,
            result_updates=result,
            payload_updates={"execution": "executed"},
            error=None,
        )
        return result

    def _run_summarize_published_chapter(self, job: Job) -> dict[str, Any]:
        chapter = self._chapter(job)
        result = SummarizerService(self.session).summarize_chapter(chapter.id)
        self.machine.transition(
            job,
            PipelineState.DONE,
            result_updates={
                "artifact_id": result["artifact_id"],
                "artifact_path": result["artifact_path"],
                "artifact_sha256": result["artifact_sha256"],
                "model_call_id": result["model_call_id"],
            },
            payload_updates={"execution": "executed"},
            error=None,
        )
        return result

    def _candidate_artifact_id(self, job: Job) -> int:
        combined = {**job_payload(job), **job_result(job)}
        raw = combined.get("artifact_id")
        if isinstance(raw, int):
            return raw
        dependency_artifact_id = self._dependency_artifact_id(job)
        if dependency_artifact_id is not None:
            self.machine.transition(
                job,
                PipelineState.QUEUED,
                payload_updates={"artifact_id": dependency_artifact_id},
                result_updates={"artifact_id": dependency_artifact_id},
                error=None,
            )
            raise RuntimeError("Candidate artifact prepared; rerun task to continue review")
        artifact = self._latest_chapter_artifact(job)
        if artifact is None:
            artifact = create_snapshot_candidate_for_chapter(self.session, self._chapter(job))
        self.machine.transition(
            job,
            PipelineState.QUEUED,
            payload_updates={"artifact_id": artifact.id},
            result_updates={"artifact_id": artifact.id, "artifact_sha256": artifact.sha256},
            error=None,
        )
        raise RuntimeError("Candidate artifact prepared; rerun task to continue review")

    def _dependency_artifact_id(self, job: Job) -> int | None:
        dependency_id = job_payload(job).get("depends_on_job_id")
        if not isinstance(dependency_id, int):
            return None
        dependency = self.session.get(Job, dependency_id)
        if dependency is None:
            return None
        raw = {**job_payload(dependency), **job_result(dependency)}.get("artifact_id")
        return raw if isinstance(raw, int) else None

    def _latest_chapter_artifact(self, job: Job) -> Artifact | None:
        chapter = self._chapter(job)
        return self.session.scalar(
            select(Artifact)
            .where(Artifact.kind == "candidate", Artifact.base_chapter_id == chapter.id)
            .order_by(Artifact.id.desc())
        )

    def _latest_review_id(self, artifact_id: int) -> int | None:
        review = self.session.scalar(select(Review).where(Review.artifact_id == artifact_id).order_by(Review.id.desc()))
        return review.id if review is not None else None

    def _has_only_writer_issues(self, issues: list[dict[str, Any]]) -> bool:
        if not issues:
            return False
        return all(isinstance(issue, dict) and issue.get("owner") == "writer" for issue in issues)

    def _chapter(self, job: Job) -> Chapter:
        payload = job_payload(job)
        chapter_no = payload.get("chapter_no")
        if not isinstance(chapter_no, int):
            raise ValueError("Pipeline task missing chapter_no")
        chapter = self.session.scalar(select(Chapter).where(Chapter.chapter_no == chapter_no, Chapter.active.is_(True)))
        if chapter is None:
            raise NotFoundError("Chapter not found")
        return chapter

    def _fail_job(self, job: Job, exc: Exception) -> None:
        message = str(exc)
        if "budget" in message.lower():
            self.machine.transition(job, PipelineState.PAUSED_BUDGET, error=message)
            return
        if "Candidate artifact prepared" in message:
            return
        self.machine.transition(job, PipelineState.MANUAL_REQUIRED, error=message)

    def _refresh_parent(self, job: Job) -> None:
        parent_run_id = job_payload(job).get("parent_run_id")
        if isinstance(parent_run_id, int):
            PipelineRunService(self.session).refresh_run_status(parent_run_id)
