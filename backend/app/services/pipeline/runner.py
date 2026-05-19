from sqlalchemy.orm import Session

from backend.app.db.models import Job
from backend.app.services.pipeline.state_machine import PipelineState, PipelineStateMachine


class PipelineRunner:
    """Runner facade for durable task state updates.

    Stage 4 will attach writer/reviewer/fixer implementations. This class keeps
    stage 3 focused on traceable state progression instead of model calls.
    """

    def __init__(self, session: Session) -> None:
        self.session = session
        self.machine = PipelineStateMachine(session)

    def mark_context_built(self, job_id: int, *, context_report_artifact_id: int | None = None) -> Job:
        return self.machine.mark_context_built(self._job(job_id), context_report_artifact_id=context_report_artifact_id)

    def mark_draft_generated(
        self,
        job_id: int,
        *,
        output_hash: str,
        artifact_id: int | None = None,
        model_call_id: int | None = None,
    ) -> Job:
        return self.machine.mark_output(
            self._job(job_id),
            status=PipelineState.DRAFT_GENERATED,
            output_hash=output_hash,
            artifact_id=artifact_id,
            model_call_id=model_call_id,
        )

    def mark_reviewed(self, job_id: int, *, artifact_id: int | None = None, model_call_id: int | None = None) -> Job:
        return self.machine.mark_output(
            self._job(job_id),
            status=PipelineState.REVIEWED,
            artifact_id=artifact_id,
            model_call_id=model_call_id,
        )

    def _job(self, job_id: int) -> Job:
        job = self.session.get(Job, job_id)
        if job is None:
            raise ValueError("Pipeline job not found")
        return job

