import json
from enum import Enum
from typing import Any

from sqlalchemy.orm import Session

from backend.app.db.models import Event, Job
from backend.app.repositories import Repository


class PipelineTransitionError(ValueError):
    pass


class PipelineState(str, Enum):
    PLANNED = "planned"
    QUEUED = "queued"
    CONTEXT_BUILT = "context_built"
    DRAFT_GENERATED = "draft_generated"
    LOCAL_VALIDATED = "local_validated"
    REVIEWED = "reviewed"
    FIXING = "fixing"
    APPROVED = "approved"
    PUBLISHED = "published"
    SUMMARIZED = "summarized"
    DONE = "done"
    PAUSED = "paused"
    MANUAL_REQUIRED = "manual_required"
    PAUSED_BUDGET = "paused_budget"
    FAILED_RETRYABLE = "failed_retryable"
    FAILED_TERMINAL = "failed_terminal"


TERMINAL_STATES = {
    PipelineState.DONE.value,
    PipelineState.MANUAL_REQUIRED.value,
    PipelineState.FAILED_TERMINAL.value,
}

ACTIVE_STATES = {
    "running",
    PipelineState.PLANNED.value,
    PipelineState.QUEUED.value,
    PipelineState.CONTEXT_BUILT.value,
    PipelineState.DRAFT_GENERATED.value,
    PipelineState.LOCAL_VALIDATED.value,
    PipelineState.REVIEWED.value,
    PipelineState.FIXING.value,
    PipelineState.APPROVED.value,
    PipelineState.PUBLISHED.value,
    PipelineState.SUMMARIZED.value,
    PipelineState.PAUSED.value,
    PipelineState.PAUSED_BUDGET.value,
    PipelineState.FAILED_RETRYABLE.value,
}

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "running": {
        PipelineState.QUEUED.value,
        PipelineState.CONTEXT_BUILT.value,
        PipelineState.DRAFT_GENERATED.value,
        PipelineState.REVIEWED.value,
        PipelineState.FIXING.value,
        PipelineState.APPROVED.value,
        PipelineState.SUMMARIZED.value,
        PipelineState.DONE.value,
        PipelineState.PAUSED.value,
        PipelineState.PAUSED_BUDGET.value,
        PipelineState.FAILED_RETRYABLE.value,
        PipelineState.FAILED_TERMINAL.value,
        PipelineState.MANUAL_REQUIRED.value,
    },
    PipelineState.PLANNED.value: {
        PipelineState.QUEUED.value,
        PipelineState.PAUSED.value,
        PipelineState.MANUAL_REQUIRED.value,
        PipelineState.FAILED_TERMINAL.value,
    },
    PipelineState.QUEUED.value: {
        PipelineState.CONTEXT_BUILT.value,
        PipelineState.PAUSED.value,
        PipelineState.PAUSED_BUDGET.value,
        PipelineState.FAILED_RETRYABLE.value,
        PipelineState.FAILED_TERMINAL.value,
        PipelineState.MANUAL_REQUIRED.value,
    },
    PipelineState.CONTEXT_BUILT.value: {
        PipelineState.DRAFT_GENERATED.value,
        PipelineState.LOCAL_VALIDATED.value,
        PipelineState.REVIEWED.value,
        PipelineState.DONE.value,
        PipelineState.PAUSED.value,
        PipelineState.PAUSED_BUDGET.value,
        PipelineState.FAILED_RETRYABLE.value,
        PipelineState.FAILED_TERMINAL.value,
        PipelineState.MANUAL_REQUIRED.value,
    },
    PipelineState.DRAFT_GENERATED.value: {
        PipelineState.LOCAL_VALIDATED.value,
        PipelineState.REVIEWED.value,
        PipelineState.FIXING.value,
        PipelineState.PAUSED.value,
        PipelineState.PAUSED_BUDGET.value,
        PipelineState.FAILED_RETRYABLE.value,
        PipelineState.FAILED_TERMINAL.value,
        PipelineState.MANUAL_REQUIRED.value,
    },
    PipelineState.LOCAL_VALIDATED.value: {
        PipelineState.REVIEWED.value,
        PipelineState.FIXING.value,
        PipelineState.APPROVED.value,
        PipelineState.PAUSED.value,
        PipelineState.FAILED_RETRYABLE.value,
        PipelineState.FAILED_TERMINAL.value,
        PipelineState.MANUAL_REQUIRED.value,
    },
    PipelineState.REVIEWED.value: {
        PipelineState.FIXING.value,
        PipelineState.APPROVED.value,
        PipelineState.MANUAL_REQUIRED.value,
        PipelineState.PAUSED.value,
        PipelineState.FAILED_RETRYABLE.value,
        PipelineState.FAILED_TERMINAL.value,
    },
    PipelineState.FIXING.value: {
        PipelineState.DRAFT_GENERATED.value,
        PipelineState.REVIEWED.value,
        PipelineState.PAUSED.value,
        PipelineState.PAUSED_BUDGET.value,
        PipelineState.FAILED_RETRYABLE.value,
        PipelineState.FAILED_TERMINAL.value,
        PipelineState.MANUAL_REQUIRED.value,
    },
    PipelineState.APPROVED.value: {
        PipelineState.PUBLISHED.value,
        PipelineState.DONE.value,
        PipelineState.PAUSED.value,
        PipelineState.MANUAL_REQUIRED.value,
        PipelineState.FAILED_TERMINAL.value,
    },
    PipelineState.PUBLISHED.value: {
        PipelineState.SUMMARIZED.value,
        PipelineState.DONE.value,
        PipelineState.PAUSED.value,
        PipelineState.FAILED_RETRYABLE.value,
        PipelineState.FAILED_TERMINAL.value,
    },
    PipelineState.SUMMARIZED.value: {PipelineState.DONE.value},
    PipelineState.PAUSED.value: {
        PipelineState.QUEUED.value,
        PipelineState.FAILED_TERMINAL.value,
        PipelineState.MANUAL_REQUIRED.value,
    },
    PipelineState.PAUSED_BUDGET.value: {
        PipelineState.QUEUED.value,
        PipelineState.FAILED_TERMINAL.value,
        PipelineState.MANUAL_REQUIRED.value,
    },
    PipelineState.FAILED_RETRYABLE.value: {
        PipelineState.QUEUED.value,
        PipelineState.FAILED_TERMINAL.value,
        PipelineState.MANUAL_REQUIRED.value,
    },
    PipelineState.DONE.value: set(),
    PipelineState.MANUAL_REQUIRED.value: set(),
    PipelineState.FAILED_TERMINAL.value: set(),
}


TRACKING_FIELDS = {"input_hash", "output_hash", "artifact_id", "model_call_id", "context_report_artifact_id"}


def job_payload(job: Job) -> dict[str, Any]:
    return json.loads(job.payload_json or "{}")


def job_result(job: Job) -> dict[str, Any]:
    return json.loads(job.result_json or "{}")


def update_payload(job: Job, updates: dict[str, Any]) -> None:
    payload = job_payload(job)
    payload.update(updates)
    job.payload_json = json.dumps(payload, ensure_ascii=False, sort_keys=True)


def update_result(job: Job, updates: dict[str, Any]) -> None:
    result = job_result(job)
    result.update(updates)
    job.result_json = json.dumps(result, ensure_ascii=False, sort_keys=True)


class PipelineStateMachine:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.events = Repository(session, Event)

    def can_transition(self, from_status: str, to_status: str) -> bool:
        return to_status in ALLOWED_TRANSITIONS.get(from_status, set())

    def transition(
        self,
        job: Job,
        to_status: PipelineState | str,
        *,
        result_updates: dict[str, Any] | None = None,
        payload_updates: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> Job:
        target = to_status.value if isinstance(to_status, PipelineState) else to_status
        source = job.status
        if not self.can_transition(source, target):
            raise PipelineTransitionError(f"Illegal pipeline transition: {source} -> {target}")
        if payload_updates:
            update_payload(job, payload_updates)
        if result_updates:
            update_result(job, result_updates)
        job.status = target
        job.error = error
        self.session.flush()
        self.events.create(
            {
                "event_type": "pipeline_transition",
                "entity_type": "job",
                "entity_id": job.id,
                "payload_json": json.dumps(
                    {
                        "from": source,
                        "to": target,
                        "result_updates": sorted((result_updates or {}).keys()),
                        "payload_updates": sorted((payload_updates or {}).keys()),
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                ),
            }
        )
        self.session.commit()
        return job

    def mark_context_built(self, job: Job, *, context_report_artifact_id: int | None = None) -> Job:
        updates: dict[str, Any] = {}
        if context_report_artifact_id is not None:
            updates["context_report_artifact_id"] = context_report_artifact_id
        return self.transition(job, PipelineState.CONTEXT_BUILT, result_updates=updates)

    def mark_output(
        self,
        job: Job,
        *,
        status: PipelineState,
        output_hash: str | None = None,
        artifact_id: int | None = None,
        model_call_id: int | None = None,
    ) -> Job:
        updates: dict[str, Any] = {}
        if output_hash is not None:
            updates["output_hash"] = output_hash
        if artifact_id is not None:
            updates["artifact_id"] = artifact_id
        if model_call_id is not None:
            updates["model_call_id"] = model_call_id
        return self.transition(job, status, result_updates=updates)

    def mark_retryable_failure(self, job: Job, error: str) -> Job:
        return self.transition(job, PipelineState.FAILED_RETRYABLE, error=error)

    def mark_terminal_failure(self, job: Job, error: str) -> Job:
        return self.transition(job, PipelineState.FAILED_TERMINAL, error=error)

    def pause_for_budget(self, job: Job, error: str) -> Job:
        return self.transition(job, PipelineState.PAUSED_BUDGET, error=error)

    def retry(self, job: Job) -> Job:
        if job.status not in {PipelineState.FAILED_RETRYABLE.value, PipelineState.PAUSED_BUDGET.value}:
            raise PipelineTransitionError(f"Job is not retryable: {job.status}")
        retry_count = int(job_payload(job).get("retry_count", 0)) + 1
        return self.transition(job, PipelineState.QUEUED, payload_updates={"retry_count": retry_count}, error=None)

    def pause(self, job: Job) -> Job:
        return self.transition(job, PipelineState.PAUSED, error="Paused by user")

    def resume(self, job: Job) -> Job:
        if job.status not in {PipelineState.PAUSED.value, PipelineState.PAUSED_BUDGET.value}:
            raise PipelineTransitionError(f"Job is not resumable: {job.status}")
        return self.transition(job, PipelineState.QUEUED, error=None)


def tracking_complete(job: Job) -> bool:
    combined = {**job_payload(job), **job_result(job)}
    return "input_hash" in combined and any(field in combined for field in TRACKING_FIELDS - {"input_hash"})
