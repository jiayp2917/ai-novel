import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.config import get_settings
from backend.app.core.file_utils import safe_write_text
from backend.app.db.models import Chapter, Job
from backend.app.services.workspace import ensure_workspace_runtime_subdir, workspace_runtime_root
from backend.app.services.pipeline.planner import PipelinePlanError, PipelinePlanner
from backend.app.services.pipeline.planner import PipelineTaskType
from backend.app.services.pipeline.state_machine import (
    PipelineState,
    PipelineStateMachine,
    PipelineTransitionError,
    job_payload,
    job_result,
    update_payload,
    update_result,
)


PIPELINE_RUN_MODES = {
    "review_only",
    "generate_missing",
    "review_fix",
    "full_auto",
}
DELETABLE_RUN_STATUSES = {"done", "manual_required", "failed_terminal"}
UNSTARTED_CHILD_STATUSES = {"planned", "queued"}
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

STATUS_LABELS = {
    "planned": "等待开始",
    "queued": "等待开始",
    "running": "运行中",
    "context_built": "运行中",
    "draft_generated": "运行中",
    "local_validated": "运行中",
    "reviewed": "运行中",
    "fixing": "运行中",
    "approved": "运行中",
    "published": "运行中",
    "summarized": "运行中",
    "done": "已完成",
    "paused": "已暂停",
    "manual_required": "需人工处理",
    "paused_budget": "今日调用额度已暂停",
    "failed_retryable": "失败可重试",
    "failed_terminal": "已终止",
}

TASK_LABELS = {
    "generate_chapter_draft": "生成草稿",
    "review_chapter_candidate": "检查草稿",
    "fix_chapter_candidate": "修订草稿",
    "publish_chapter_candidate": "写回确认",
    "summarize_published_chapter": "整理记忆",
}

FINISHED_CHILD_STATUSES = {"approved", "published", "summarized", "done"}
PROBLEM_CHILD_STATUSES = {"manual_required", "failed_terminal", "failed_retryable", "paused_budget"}
MUTABLE_CHILD_STATUSES = {
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
DIRECT_PUBLISH_ERROR = "自动流水线当前只允许预演，不直接写回正文。请到 AI 工作台确认写回。"


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
        if not dry_run and not _direct_publish_allowed():
            raise PipelineRunError(DIRECT_PUBLISH_ERROR)
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
            self._ensure_report(run)
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
            self._ensure_report(run)
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

    def list_runs(self, *, limit: int = 100) -> list[dict[str, Any]]:
        runs = self.session.scalars(
            select(Job).where(Job.type == "pipeline_run").order_by(Job.created_at.desc()).limit(limit)
        )
        return [self.serialize(job) for job in runs]

    def get_run(self, run_id: int) -> dict[str, Any]:
        return self.serialize(self._run(run_id))

    def pause(self, run_id: int) -> dict[str, Any]:
        job = self._run(run_id)
        self.machine.pause(job)
        for child in self._child_jobs(job):
            if child.status in MUTABLE_CHILD_STATUSES:
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
            if child.status in MUTABLE_CHILD_STATUSES:
                self._transition_child_if_allowed(child, PipelineState.FAILED_TERMINAL, error="Cancelled by user")
        self._ensure_report(job)
        return self.serialize(job)

    def delete_run(self, run_id: int) -> dict[str, Any]:
        job = self._run(run_id)
        if job.status not in DELETABLE_RUN_STATUSES:
            raise PipelineRunError("Pipeline run must be stopped or completed before deletion")
        children = self._child_jobs(job)
        blocking = [child for child in children if self._child_blocks_delete(job, child)]
        if blocking:
            raise PipelineRunError("Pipeline run has active child tasks; stop it before deletion")
        report = self._ensure_report(job)
        deleted_child_tasks = len(children)
        for child in children:
            self.session.delete(child)
        self.session.delete(job)
        self.session.commit()
        return {"deleted": True, "run_id": run_id, "deleted_child_tasks": deleted_child_tasks, "report_path": report.get("path")}

    def _child_blocks_delete(self, run: Job, child: Job) -> bool:
        if child.status not in BLOCKING_DELETE_CHILD_STATUSES:
            return False
        if run.status in DELETABLE_RUN_STATUSES and child.status in UNSTARTED_CHILD_STATUSES:
            return False
        return True

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
        summary = self._summary(job, child_tasks)
        report_summary = self._report_summary(job)
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
            "summary": summary,
            "next_step": self._next_step(job, summary),
            "report_summary": report_summary,
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

    def _summary(self, run: Job, child_tasks: list[dict[str, Any]]) -> dict[str, Any]:
        completed = sum(1 for child in child_tasks if child["status"] in FINISHED_CHILD_STATUSES)
        manual = sum(1 for child in child_tasks if child["status"] == PipelineState.MANUAL_REQUIRED.value)
        failed = sum(1 for child in child_tasks if child["status"] in PROBLEM_CHILD_STATUSES)
        failure_summaries = [
            self._failure_summary(child)
            for child in child_tasks
            if child["status"] in PROBLEM_CHILD_STATUSES or child.get("error")
        ]
        delete_block_reason = self._delete_block_reason(run, child_tasks)
        return {
            "total_steps": len(child_tasks),
            "completed_steps": completed,
            "manual_required_steps": manual,
            "failed_or_paused_steps": failed,
            "status_label": _status_label(run.status),
            "can_delete": delete_block_reason is None,
            "delete_block_reason": delete_block_reason,
            "failure_summaries": failure_summaries,
        }

    def _delete_block_reason(self, run: Job, child_tasks: list[dict[str, Any]]) -> str | None:
        if run.status not in DELETABLE_RUN_STATUSES:
            return "这条流水线还没有结束。请先停止，或等它完成后再删除。"
        blocking = [
            child for child in child_tasks
            if self._child_blocks_delete(run, _SerializedChild(child))
        ]
        if blocking:
            return "这条流水线仍有运行中、暂停或可重试的步骤。请先停止或处理失败步骤后再删除。"
        return None

    def _failure_summary(self, child: dict[str, Any]) -> dict[str, Any]:
        payload = child.get("payload") if isinstance(child.get("payload"), dict) else {}
        chapter_no = payload.get("chapter_no")
        return {
            "job_id": child["id"],
            "chapter_no": chapter_no if isinstance(chapter_no, int) else None,
            "task_type": child["type"],
            "task_label": TASK_LABELS.get(child["type"], child["type"]),
            "status": child["status"],
            "status_label": _status_label(child["status"]),
            "reason": child.get("error") or _status_label(child["status"]),
            "next_step": _failure_next_step(child["status"]),
        }

    def _next_step(self, run: Job, summary: dict[str, Any]) -> dict[str, str]:
        if run.status == PipelineState.DONE.value:
            return {"label": "已完成", "text": "可查看报告和产物；如要重新跑，请复用设置。", "tone": "ok"}
        if run.status == PipelineState.MANUAL_REQUIRED.value or summary["manual_required_steps"] > 0:
            return {"label": "需人工处理", "text": "请查看失败摘要，处理后复用设置重新创建，或到 AI 工作台查看草稿。", "tone": "warn"}
        if run.status == PipelineState.FAILED_TERMINAL.value:
            return {"label": "已终止", "text": "这条流水线不会继续运行；可复用设置重新创建。", "tone": "danger"}
        if run.status == PipelineState.FAILED_RETRYABLE.value:
            return {"label": "失败可重试", "text": "请先查看失败原因，再点击重试和继续队列。", "tone": "danger"}
        if run.status == PipelineState.PAUSED_BUDGET.value:
            return {"label": "额度暂停", "text": "确认今日调用额度后恢复或重试，再继续队列。", "tone": "warn"}
        if run.status == PipelineState.PAUSED.value:
            return {"label": "已暂停", "text": "点击恢复，再继续队列。", "tone": "info"}
        if summary["failed_or_paused_steps"] > 0:
            return {"label": "有步骤失败", "text": "请查看失败摘要；可重试的步骤需要先点击重试。", "tone": "danger"}
        return {"label": "下一步", "text": "点击运行一次队列推进任务。每次只执行一批，便于观察失败原因。", "tone": "info"}

    def _report_summary(self, run: Job) -> dict[str, Any]:
        result = job_result(run)
        path = result.get("report_path")
        exists = isinstance(path, str) and (workspace_runtime_root() / path).exists()
        return {
            "path": path if isinstance(path, str) else None,
            "exists": exists,
            "generated": exists,
            "note": "报告保存在当前工作区 runtime/reports，不进入 Git。",
        }

    def _ensure_report(self, run: Job) -> dict[str, Any]:
        result = job_result(run)
        existing = result.get("report_path")
        if isinstance(existing, str) and (workspace_runtime_root() / existing).exists():
            return {"path": existing, "exists": True}
        report_dir = ensure_workspace_runtime_subdir("reports")
        report_path = report_dir / f"pipeline_run_{run.id}.json"
        child_tasks = [self._serialize_task(child) for child in self._child_jobs(run)]
        summary = self._summary(run, child_tasks)
        report = {
            "run_id": run.id,
            "status": run.status,
            "status_label": _status_label(run.status),
            "created_at": run.created_at.isoformat() if run.created_at else None,
            "updated_at": run.updated_at.isoformat() if run.updated_at else None,
            "generated_at": datetime.now(UTC).isoformat(),
            "payload": _safe_report_payload(job_payload(run)),
            "summary": summary,
            "failures": summary["failure_summaries"],
            "artifact_ids": _collect_int_result_values(child_tasks, "artifact_id"),
            "model_call_ids": _collect_int_result_values(child_tasks, "model_call_id"),
            "context_report_artifact_ids": _collect_int_result_values(child_tasks, "context_report_artifact_id"),
            "note": "轻量运行报告：不包含正文内容；runtime 产物不进入 Git。",
        }
        safe_write_text(report_path, json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        relative_path = report_path.relative_to(workspace_runtime_root()).as_posix()
        update_result(run, {"report_path": relative_path})
        self.session.commit()
        return {"path": relative_path, "exists": True}


class _SerializedChild:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.status = str(payload.get("status"))


def _status_label(status: str) -> str:
    return STATUS_LABELS.get(status, status)


def _failure_next_step(status: str) -> str:
    if status == PipelineState.MANUAL_REQUIRED.value:
        return "需要人工判断后再决定是否复用设置重跑。"
    if status == PipelineState.FAILED_RETRYABLE.value:
        return "可点击重试，再运行一次队列。"
    if status == PipelineState.PAUSED_BUDGET.value:
        return "确认今日调用额度后恢复或重试。"
    if status == PipelineState.FAILED_TERMINAL.value:
        return "已终止，建议查看原因后复用设置重新创建。"
    return "请查看步骤状态和错误原因。"


def _safe_report_payload(payload: dict[str, Any]) -> dict[str, Any]:
    allowed = {"start_chapter", "end_chapter", "mode", "chunk_size", "max_fix_rounds", "dry_run", "chapters"}
    return {key: value for key, value in payload.items() if key in allowed}


def _collect_int_result_values(child_tasks: list[dict[str, Any]], key: str) -> list[int]:
    values: list[int] = []
    for child in child_tasks:
        result = child.get("result")
        if isinstance(result, dict) and isinstance(result.get(key), int):
            values.append(result[key])
    return values


def _direct_publish_allowed() -> bool:
    settings = get_settings()
    return settings.enable_test_support or settings.allow_pipeline_direct_publish
