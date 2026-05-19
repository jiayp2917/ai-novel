import json
from enum import Enum
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.db.models import Job
from backend.app.repositories import Repository
from backend.app.services.pipeline.state_machine import ACTIVE_STATES, PipelineState
from backend.app.utils.hashing import sha256_text


class PipelinePlanError(ValueError):
    pass


class PipelineTaskType(str, Enum):
    PIPELINE_RUN = "pipeline_run"
    GENERATE_CHAPTER_DRAFT = "generate_chapter_draft"
    REVIEW_CHAPTER_CANDIDATE = "review_chapter_candidate"
    FIX_CHAPTER_CANDIDATE = "fix_chapter_candidate"
    PUBLISH_CHAPTER_CANDIDATE = "publish_chapter_candidate"
    SUMMARIZE_PUBLISHED_CHAPTER = "summarize_published_chapter"
    REBUILD_STRUCTURED_MEMORY = "rebuild_structured_memory"
    GENERATE_OUTLINE_PROPOSAL = "generate_outline_proposal"
    REVIEW_OUTLINE_PROPOSAL = "review_outline_proposal"


def canonical_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def compute_input_hash(payload: dict[str, Any]) -> str:
    sanitized = dict(payload)
    sanitized.pop("input_hash", None)
    sanitized.pop("retry_count", None)
    return sha256_text(canonical_json(sanitized))


class PipelinePlanner:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.jobs = Repository(session, Job)

    def create_task(
        self,
        *,
        task_type: PipelineTaskType | str,
        payload: dict[str, Any],
        chapter_id: int | None = None,
        source_file_id: int | None = None,
        status: PipelineState | str = PipelineState.PLANNED,
        serial_source: bool = False,
    ) -> Job:
        resolved_type = task_type.value if isinstance(task_type, PipelineTaskType) else task_type
        resolved_status = status.value if isinstance(status, PipelineState) else status
        if resolved_status not in ACTIVE_STATES:
            raise PipelinePlanError(f"Task must start in an active state: {resolved_status}")
        self._reject_active_chapter_task(chapter_id)
        if serial_source:
            self._reject_active_source_task(source_file_id)
        enriched_payload = {
            **payload,
            "task_type": resolved_type,
            "input_hash": compute_input_hash({"task_type": resolved_type, **payload}),
        }
        if serial_source:
            enriched_payload["serial_source"] = True
        job = self.jobs.create(
            {
                "type": resolved_type,
                "status": resolved_status,
                "payload_json": canonical_json(enriched_payload),
                "locked_chapter_id": chapter_id,
                "locked_source_file_id": source_file_id,
            }
        )
        self.session.commit()
        return job

    def queue_task(self, job: Job) -> Job:
        if job.status != PipelineState.PLANNED.value:
            raise PipelinePlanError(f"Only planned tasks can be queued: {job.status}")
        job.status = PipelineState.QUEUED.value
        self.session.commit()
        return job

    def plan_chapter_range(self, *, start_chapter: int, end_chapter: int, mode: str, chunk_size: int = 3) -> Job:
        if start_chapter < 1 or end_chapter < start_chapter:
            raise PipelinePlanError("Invalid chapter range")
        if chunk_size < 1:
            raise PipelinePlanError("chunk_size must be positive")
        return self.create_task(
            task_type=PipelineTaskType.PIPELINE_RUN,
            payload={
                "start_chapter": start_chapter,
                "end_chapter": end_chapter,
                "mode": mode,
                "chunk_size": chunk_size,
            },
        )

    def _reject_active_chapter_task(self, chapter_id: int | None) -> None:
        if chapter_id is None:
            return
        existing = self.session.scalar(
            select(Job)
            .where(
                Job.locked_chapter_id == chapter_id,
                Job.status.in_(ACTIVE_STATES),
            )
            .order_by(Job.id.desc())
        )
        if existing is not None:
            raise PipelinePlanError(f"Chapter already has an active pipeline task: {existing.id}")

    def _reject_active_source_task(self, source_file_id: int | None) -> None:
        if source_file_id is None:
            raise PipelinePlanError("serial_source tasks require source_file_id")
        existing = self.session.scalar(
            select(Job)
            .where(
                Job.locked_source_file_id == source_file_id,
                Job.status.in_(ACTIVE_STATES),
                Job.payload_json.contains('"serial_source":true'),
            )
            .order_by(Job.id.desc())
        )
        if existing is not None:
            raise PipelinePlanError(f"Source file already has an active serial task: {existing.id}")
