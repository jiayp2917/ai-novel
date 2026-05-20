import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.db.models import Chapter, Job
from backend.app.services.pipeline.planner import PipelinePlanError, PipelinePlanner
from backend.app.services.pipeline.planner import PipelineTaskType
from backend.app.services.pipeline.state_machine import (
    PipelineState,
    PipelineStateMachine,
    PipelineTransitionError,
    job_payload,
    job_result,
    update_payload,
)


PIPELINE_RUN_MODES = {
    "review_only",
    "generate_missing",
    "review_fix",
    "full_auto",
}
DELETABLE_RUN_STATUSES = {"done", "manual_required", "failed_terminal"}
BLOCKING_DELETE_CHILD_STATUSES = {
    "planned",
    "queued",
    "running",
    "context_built",
    "draft_generated",
    "local_validated",
    "reviewed",
    "fixing",
    "paused",
    "paused_budget",
    "failed_retryable",
}


class PipelineRunError(ValueError):
    pass


class PipelineRunService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.planner = PipelinePlanner(session)
        self.machine = PipelineStateMachine(session)

    def create_run(
        self,
        *,
        start_chapter: int,
        end_chapter: int,
        mode: str,
        chunk_size: int = 3,
        max_fix_rounds: int = 2,
        dry_run: bool = True,
    ) -> dict[str, Any]:
        if mode not in PIPELINE_RUN_MODES:
            raise PipelineRunError("Unsupported pipeline mode")
        if max_fix_rounds < 0 or max_fix_rounds > 5:
            raise PipelineRunError("max_fix_rounds must be between 0 and 5")
        try:
            job = self.planner.plan_chapter_range(
                start_chapter=start_chapter,
                end_chapter=end_chapter,
                mode=mode,
                chunk_size=chunk_size,
            )
        except PipelinePlanError as exc:
            raise PipelineRunError(str(exc)) from exc
        update_payload(
            job,
            {
                "max_fix_rounds": max_fix_rounds,
                "dry_run": dry_run,
                "chapters": list(range(start_chapter, end_chapter + 1)),
                "child_task_ids": [],
            },
        )
        child_task_ids = self._create_child_tasks(
            start_chapter=start_chapter,
            end_chapter=end_chapter,
            mode=mode,
            dry_run=dry_run,
            parent_run_id=job.id,
        )
        update_payload(job, {"child_task_ids": child_task_ids})
        self.machine.transition(job, PipelineState.QUEUED)
        return self.serialize(job)

    def _create_child_tasks(
        self,
        *,
        start_chapter: int,
        end_chapter: int,
        mode: str,
        dry_run: bool,
        parent_run_id: int,
    ) -> list[int]:
        child_task_ids: list[int] = []
        for chapter_no in range(start_chapter, end_chapter + 1):
            previous_task_id: int | None = None
            if mode in {"generate_missing", "full_auto"}:
                previous_task_id = self._append_child_task(
                    child_task_ids,
                    PipelineTaskType.GENERATE_CHAPTER_DRAFT,
                    chapter_no=chapter_no,
                    dry_run=dry_run,
                    parent_run_id=parent_run_id,
                    depends_on_job_id=previous_task_id,
                )
            if mode in {"review_only", "review_fix", "full_auto"}:
                previous_task_id = self._append_child_task(
                    child_task_ids,
                    PipelineTaskType.REVIEW_CHAPTER_CANDIDATE,
                    chapter_no=chapter_no,
                    dry_run=dry_run,
                    parent_run_id=parent_run_id,
                    depends_on_job_id=previous_task_id,
                )
            if mode in {"review_fix", "full_auto"}:
                previous_task_id = self._append_child_task(
                    child_task_ids,
                    PipelineTaskType.FIX_CHAPTER_CANDIDATE,
                    chapter_no=chapter_no,
                    dry_run=dry_run,
                    parent_run_id=parent_run_id,
                    depends_on_job_id=previous_task_id,
                )
                previous_task_id = self._append_child_task(
                    child_task_ids,
                    PipelineTaskType.REVIEW_CHAPTER_CANDIDATE,
                    chapter_no=chapter_no,
                    dry_run=dry_run,
                    parent_run_id=parent_run_id,
                    depends_on_job_id=previous_task_id,
                )
            if mode == "full_auto":
                previous_task_id = self._append_child_task(
                    child_task_ids,
                    PipelineTaskType.PUBLISH_CHAPTER_CANDIDATE,
                    chapter_no=chapter_no,
                    dry_run=dry_run,
                    parent_run_id=parent_run_id,
                    depends_on_job_id=previous_task_id,
                )
                self._append_child_task(
                    child_task_ids,
                    PipelineTaskType.SUMMARIZE_PUBLISHED_CHAPTER,
                    chapter_no=chapter_no,
                    dry_run=dry_run,
                    parent_run_id=parent_run_id,
                    depends_on_job_id=previous_task_id,
                )
        return child_task_ids

    def _append_child_task(
        self,
        child_task_ids: list[int],
        task_type: PipelineTaskType,
        *,
        chapter_no: int,
        dry_run: bool,
        parent_run_id: int,
        depends_on_job_id: int | None,
    ) -> int:
        job = self._planned_child_task(
            task_type,
            chapter_no=chapter_no,
            dry_run=dry_run,
            parent_run_id=parent_run_id,
            depends_on_job_id=depends_on_job_id,
        )
        child_task_ids.append(job.id)
        return job.id

    def _planned_child_task(
        self,
        task_type: PipelineTaskType,
        *,
        chapter_no: int,
        dry_run: bool,
        parent_run_id: int,
        depends_on_job_id: int | None,
    ) -> Job:
        payload = {
            "parent_run_id": parent_run_id,
            "chapter_no": chapter_no,
            "dry_run": dry_run,
            "execution": "queued",
        }
        if depends_on_job_id is not None:
            payload["depends_on_job_id"] = depends_on_job_id
        job = self.planner.create_task(
            task_type=task_type,
            payload=payload,
            status=PipelineState.PLANNED,
        )
        chapter = self.session.scalar(select(Chapter).where(Chapter.chapter_no == chapter_no, Chapter.active.is_(True)))
        if chapter is not None:
            job.locked_chapter_id = chapter.id
            job.locked_source_file_id = chapter.source_file_id
            self.session.commit()
        return job

    def queue_children(self, run_id: int) -> dict[str, Any]:
        run = self._run(run_id)
        if run.status not in {PipelineState.QUEUED.value, "running"}:
            raise PipelineRunError(f"Run is not queueable: {run.status}")
        payload = job_payload(run)
        child_ids = [int(item) for item in payload.get("child_task_ids", []) if isinstance(item, int)]
        queued = 0
        for child_id in child_ids:
            child = self.session.get(Job, child_id)
            if child is None:
                continue
            self._ensure_child_lock(child)
            queued += self._queue_child_if_ready(child)
        if child_ids and self._children_finished(child_ids):
            self.machine.transition(run, PipelineState.DONE, result_updates=self._run_result(child_ids))
        return {"run_id": run.id, "queued_children": queued}

    def refresh_run_status(self, run_id: int) -> Job:
        run = self._run(run_id)
        payload = job_payload(run)
        child_ids = [int(item) for item in payload.get("child_task_ids", []) if isinstance(item, int)]
        if not child_ids or run.status in {"done", "manual_required", "failed_terminal"}:
            return run
        for child in self.session.scalars(select(Job).where(Job.id.in_(child_ids)).order_by(Job.id)):
            self._propagate_terminal_dependency(child)
            self._queue_child_if_ready(child)
        if self._children_finished(child_ids):
            if self._children_need_manual(child_ids):
                self.machine.transition(run, PipelineState.MANUAL_REQUIRED, result_updates=self._run_result(child_ids))
            elif self._children_failed(child_ids):
                self.machine.transition(run, PipelineState.FAILED_RETRYABLE, result_updates=self._run_result(child_ids), error="Some child tasks failed")
            else:
                self.machine.transition(run, PipelineState.DONE, result_updates=self._run_result(child_ids))
        return run

    def _children_finished(self, child_ids: list[int]) -> bool:
        children = list(self.session.scalars(select(Job).where(Job.id.in_(child_ids))))
        return len(children) == len(child_ids) and all(
            child.status
            in {
                "approved",
                "published",
                "summarized",
                "done",
                "manual_required",
                "failed_terminal",
                "failed_retryable",
                "paused_budget",
            }
            for child in children
        )

    def _children_need_manual(self, child_ids: list[int]) -> bool:
        return any(
            child.status == "manual_required"
            for child in self.session.scalars(select(Job).where(Job.id.in_(child_ids)))
        )

    def _children_failed(self, child_ids: list[int]) -> bool:
        return any(
            child.status in {"failed_terminal", "failed_retryable", "paused_budget"}
            for child in self.session.scalars(select(Job).where(Job.id.in_(child_ids)))
        )

    def _run_result(self, child_ids: list[int]) -> dict[str, Any]:
        children = list(self.session.scalars(select(Job).where(Job.id.in_(child_ids))))
        counts: dict[str, int] = {}
        for child in children:
            counts[child.status] = counts.get(child.status, 0) + 1
        return {"child_status_counts": counts}

    def _ensure_child_lock(self, child: Job) -> None:
        if child.locked_chapter_id is not None:
            return
        payload = job_payload(child)
        chapter_no = payload.get("chapter_no")
        if not isinstance(chapter_no, int):
            return
        chapter = self.session.scalar(select(Chapter).where(Chapter.chapter_no == chapter_no, Chapter.active.is_(True)))
        if chapter is None:
            return
        child.locked_chapter_id = chapter.id
        child.locked_source_file_id = chapter.source_file_id
        self.session.commit()

    def _dependency_satisfied(self, child: Job) -> bool:
        dependency_id = job_payload(child).get("depends_on_job_id")
        if not isinstance(dependency_id, int):
            return True
        dependency = self.session.get(Job, dependency_id)
        if dependency is None:
            return False
        return dependency.status in {"done", "approved", "published", "summarized"}

    def _queue_child_if_ready(self, child: Job) -> int:
        if child.status not in {PipelineState.PLANNED.value, PipelineState.PAUSED.value}:
            return 0
        if self._parent_stops_child_queue(child) or not self._dependency_satisfied(child):
            return 0
        self.machine.transition(child, PipelineState.QUEUED, payload_updates={"execution": "queued"})
        return 1

    def _parent_stops_child_queue(self, child: Job) -> bool:
        parent_run_id = job_payload(child).get("parent_run_id")
        if not isinstance(parent_run_id, int):
            return False
        parent = self.session.get(Job, parent_run_id)
        if parent is None:
            return True
        return parent.status in {
            PipelineState.PAUSED.value,
            PipelineState.MANUAL_REQUIRED.value,
            PipelineState.FAILED_TERMINAL.value,
            PipelineState.DONE.value,
        }

    def _propagate_terminal_dependency(self, child: Job) -> None:
        if child.status != PipelineState.PLANNED.value:
            return
        dependency_id = job_payload(child).get("depends_on_job_id")
        if not isinstance(dependency_id, int):
            return
        dependency = self.session.get(Job, dependency_id)
        if dependency is None:
            self.machine.transition(
                child,
                PipelineState.FAILED_TERMINAL,
                error=f"Dependency job missing: {dependency_id}",
            )
            return
        if dependency.status == PipelineState.MANUAL_REQUIRED.value:
            self.machine.transition(
                child,
                PipelineState.MANUAL_REQUIRED,
                error=f"Dependency requires manual handling: {dependency_id}",
            )
        elif dependency.status in {PipelineState.FAILED_TERMINAL.value, PipelineState.FAILED_RETRYABLE.value, PipelineState.PAUSED_BUDGET.value}:
            self.machine.transition(
                child,
                dependency.status,
                error=f"Dependency stopped: {dependency_id} ({dependency.status})",
            )

    def list_runs(self) -> list[dict[str, Any]]:
        runs = self.session.scalars(
            select(Job).where(Job.type == "pipeline_run").order_by(Job.created_at.desc()).limit(100)
        )
        return [self.serialize(job) for job in runs]

    def get_run(self, run_id: int) -> dict[str, Any]:
        return self.serialize(self._run(run_id))

    def pause(self, run_id: int) -> dict[str, Any]:
        job = self._run(run_id)
        self.machine.pause(job)
        for child in self._child_jobs(job):
            if child.status in {"planned", "queued", "running", "context_built", "draft_generated", "local_validated", "reviewed", "fixing", "approved", "published"}:
                self._transition_child_if_allowed(child, PipelineState.PAUSED, error="Paused by user")
        return self.serialize(job)

    def resume(self, run_id: int) -> dict[str, Any]:
        job = self._run(run_id)
        self.machine.resume(job)
        for child in self._child_jobs(job):
            if child.status in {PipelineState.PAUSED.value, PipelineState.PAUSED_BUDGET.value} and self._dependency_satisfied(child):
                self._transition_child_if_allowed(child, PipelineState.QUEUED, error=None)
        return self.serialize(job)

    def retry(self, run_id: int) -> dict[str, Any]:
        job = self._run(run_id)
        self.machine.retry(job)
        for child in self._child_jobs(job):
            if child.status in {PipelineState.FAILED_RETRYABLE.value, PipelineState.PAUSED_BUDGET.value} and self._dependency_satisfied(child):
                self._transition_child_if_allowed(child, PipelineState.QUEUED, payload_updates={"retry_count": int(job_payload(child).get("retry_count", 0)) + 1}, error=None)
        return self.serialize(job)

    def cancel(self, run_id: int) -> dict[str, Any]:
        job = self._run(run_id)
        if job.status in {"done", "failed_terminal", "manual_required"}:
            raise PipelineRunError(f"Run cannot be cancelled from {job.status}")
        self.machine.transition(job, PipelineState.FAILED_TERMINAL, error="Cancelled by user")
        for child in self._child_jobs(job):
            if child.status not in {"done", "manual_required", "failed_terminal"}:
                self._transition_child_if_allowed(child, PipelineState.FAILED_TERMINAL, error="Cancelled by user")
        return self.serialize(job)

    def delete_run(self, run_id: int) -> dict[str, Any]:
        job = self._run(run_id)
        if job.status not in DELETABLE_RUN_STATUSES:
            raise PipelineRunError("Pipeline run must be stopped or completed before deletion")
        children = self._child_jobs(job)
        blocking = [child for child in children if child.status in BLOCKING_DELETE_CHILD_STATUSES]
        if blocking:
            raise PipelineRunError("Pipeline run has active child tasks; stop it before deletion")
        deleted_child_tasks = len(children)
        for child in children:
            self.session.delete(child)
        self.session.delete(job)
        self.session.commit()
        return {"deleted": True, "run_id": run_id, "deleted_child_tasks": deleted_child_tasks}

    def _child_jobs(self, run: Job) -> list[Job]:
        payload = job_payload(run)
        child_ids = [int(item) for item in payload.get("child_task_ids", []) if isinstance(item, int)]
        if not child_ids:
            return []
        return list(self.session.scalars(select(Job).where(Job.id.in_(child_ids)).order_by(Job.id)))

    def _transition_child_if_allowed(
        self,
        child: Job,
        target: PipelineState,
        *,
        payload_updates: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> None:
        if self.machine.can_transition(child.status, target.value):
            self.machine.transition(child, target, payload_updates=payload_updates, error=error)

    def serialize(self, job: Job) -> dict[str, Any]:
        payload = job_payload(job)
        result = job_result(job)
        child_ids = [int(item) for item in payload.get("child_task_ids", []) if isinstance(item, int)]
        child_tasks = []
        if child_ids:
            tasks = self.session.scalars(select(Job).where(Job.id.in_(child_ids)).order_by(Job.id))
            child_tasks = [self._serialize_task(task) for task in tasks]
        return {
            "id": job.id,
            "type": job.type,
            "status": job.status,
            "payload": payload,
            "result": result,
            "error": job.error,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
            "child_tasks": child_tasks,
        }

    def _serialize_task(self, job: Job) -> dict[str, Any]:
        return {
            "id": job.id,
            "type": job.type,
            "status": job.status,
            "payload": json.loads(job.payload_json or "{}"),
            "result": json.loads(job.result_json or "{}"),
            "error": job.error,
            "locked_chapter_id": job.locked_chapter_id,
            "locked_source_file_id": job.locked_source_file_id,
        }

    def _run(self, run_id: int) -> Job:
        job = self.session.get(Job, run_id)
        if job is None or job.type != "pipeline_run":
            raise PipelineRunError("Pipeline run not found")
        return job
