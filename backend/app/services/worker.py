from concurrent.futures import ThreadPoolExecutor, as_completed

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from backend.app.core.config import get_settings
from backend.app.db.models import Job
from backend.app.db.session import get_session_local
from backend.app.services.pipeline.executor import PipelineTaskExecutor
from backend.app.services.pipeline.planner import PipelineTaskType
from backend.app.services.revision import RevisionService

RUNNABLE_JOB_TYPES = {
    "revise_from_annotations",
    PipelineTaskType.PIPELINE_RUN.value,
    PipelineTaskType.GENERATE_CHAPTER_DRAFT.value,
    PipelineTaskType.REVIEW_CHAPTER_CANDIDATE.value,
    PipelineTaskType.FIX_CHAPTER_CANDIDATE.value,
    PipelineTaskType.PUBLISH_CHAPTER_CANDIDATE.value,
    PipelineTaskType.SUMMARIZE_PUBLISHED_CHAPTER.value,
}
SUCCESSFUL_RUN_STATUSES = {
    "queued",
    "context_built",
    "draft_generated",
    "local_validated",
    "reviewed",
    "fixing",
    "approved",
    "published",
    "summarized",
    "done",
    "succeeded",
}


class JobWorker:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.settings = get_settings()

    def run_once(self, *, limit: int | None = None) -> dict:
        claimed = self._claim_jobs(limit or self.settings.model_max_concurrency)
        if not claimed:
            return {"started": 0, "succeeded": 0, "failed": 0, "jobs": []}
        if not self.settings.enable_model_concurrency or len(claimed) == 1:
            results = [self._run_job(job_id) for job_id in claimed]
        else:
            max_workers = max(1, min(self.settings.model_max_concurrency, len(claimed)))
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = [executor.submit(run_job_in_new_session, job_id) for job_id in claimed]
                results = [future.result() for future in as_completed(futures)]
        return {
            "started": len(claimed),
            "succeeded": sum(1 for result in results if result["status"] in SUCCESSFUL_RUN_STATUSES),
            "failed": sum(1 for result in results if result["status"] not in SUCCESSFUL_RUN_STATUSES),
            "jobs": results,
        }

    def _claim_jobs(self, limit: int) -> list[int]:
        candidates = list(
            self.session.scalars(
                select(Job)
                .where(Job.status.in_(["queued", "paused_budget"]), Job.type.in_(RUNNABLE_JOB_TYPES))
                .order_by(Job.created_at, Job.id)
            )
        )
        claimed: list[int] = []
        claimed_chapters: set[int] = set()
        for job in candidates:
            chapter_id = job.locked_chapter_id
            if chapter_id is not None and chapter_id in claimed_chapters:
                continue
            if self._claim_job(job.id, chapter_id):
                claimed.append(job.id)
                if chapter_id is not None:
                    claimed_chapters.add(chapter_id)
            if len(claimed) >= limit:
                break
        return claimed

    def _claim_job(self, job_id: int, chapter_id: int | None) -> bool:
        if chapter_id is None:
            statement = (
                update(Job)
                .where(Job.id == job_id, Job.status.in_(["queued", "paused_budget"]))
                .values(status="running")
            )
        else:
            running_same_chapter = (
                select(Job.id)
                .where(
                    Job.locked_chapter_id == chapter_id,
                    Job.status == "running",
                    Job.id != job_id,
                )
                .exists()
            )
            statement = (
                update(Job)
                .where(
                    Job.id == job_id,
                    Job.status.in_(["queued", "paused_budget"]),
                    ~running_same_chapter,
                )
                .values(status="running")
            )
        result = self.session.execute(statement)
        self.session.commit()
        return result.rowcount == 1

    def _run_job(self, job_id: int) -> dict:
        try:
            job = self.session.get(Job, job_id)
            if job is None:
                return {"id": job_id, "status": "missing", "error": "Job missing"}
            if job.type == "revise_from_annotations":
                RevisionService(self.session).run_revision_job(job_id)
            else:
                PipelineTaskExecutor(self.session).run_job(job_id)
        except Exception:
            self.session.rollback()
        job = self.session.get(Job, job_id)
        return {
            "id": job_id,
            "status": job.status if job is not None else "missing",
            "error": job.error if job is not None else "Job missing",
        }


def run_job_in_new_session(job_id: int) -> dict:
    with get_session_local()() as session:
        try:
            job = session.get(Job, job_id)
            if job is None:
                return {"id": job_id, "status": "missing", "error": "Job missing"}
            if job.type == "revise_from_annotations":
                RevisionService(session).run_revision_job(job_id)
            else:
                PipelineTaskExecutor(session).run_job(job_id)
        except Exception:
            session.rollback()
        job = session.get(Job, job_id)
        return {
            "id": job_id,
            "status": job.status if job is not None else "missing",
            "error": job.error if job is not None else "Job missing",
        }
