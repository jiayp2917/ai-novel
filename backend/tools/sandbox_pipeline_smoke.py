from __future__ import annotations

import argparse
import json
import os
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import select

from backend.app.core.config import get_settings
from backend.app.db.base import Base
from backend.app.db.models import Artifact, Event, Job, ModelCall, PublishDecision, Review
from backend.app.db.session import get_engine, get_session_local, reset_engine
from backend.app.services.library import LibraryScanner
from backend.app.services.memory import MemoryService
from backend.app.services.model_client import ChatMessage, ModelResponse
from backend.app.services.model_router import ModelRoute
from backend.app.services.pipeline.executor import PipelineTaskExecutor
from backend.app.services.pipeline.fixer import FixerService
from backend.app.services.pipeline.reviewer import ReviewerService
from backend.app.services.pipeline.runs import PipelineRunService
from backend.app.services.pipeline.summarizer import SummarizerService
from backend.app.services.pipeline.state_machine import job_payload
from backend.app.services.pipeline.writer import WriterService
from backend.app.services.review_publish import ReviewPublishService
from backend.app.services.workspace import set_active_workspace, workspace_runtime_root
from backend.app.utils.hashing import sha256_text


class SmokeError(RuntimeError):
    pass


@dataclass(frozen=True)
class SmokeRoute:
    role: str
    provider: str = "fake"
    model: str = "sandbox-fake-model"


class FakePipelineModelClient:
    def __init__(self, session) -> None:
        self.session = session

    def chat(
        self,
        *,
        role: str,
        messages: list[ChatMessage],
        require_json: bool = False,
        **kwargs: Any,
    ) -> ModelResponse:
        prompt = "\n\n".join(message.content for message in messages)
        content = self._content(role, prompt, require_json=require_json)
        call = ModelCall(
            role=role,
            provider="fake",
            model="sandbox-fake-model",
            prompt_hash=sha256_text(f"{role}:{prompt}"),
            input_chars=len(prompt),
            output_chars=len(content),
            usage_json=json.dumps(
                {
                    "usage_source": "sandbox_fake",
                    "total_tokens": max(1, (len(prompt) + len(content)) // 3),
                },
                ensure_ascii=False,
            ),
            cost_estimate=0.0,
            cache_hit=False,
            status="succeeded",
        )
        self.session.add(call)
        self.session.flush()
        route = ModelRoute(
            role=role,
            provider="fake",
            model="sandbox-fake-model",
            base_url="sandbox://fake",
            api_key_env="SANDBOX_FAKE_API_KEY",
            max_tokens=8000,
            supports_json=require_json,
            cheap=True,
        )
        return ModelResponse(content, {}, False, call.id, route)

    def _content(self, role: str, prompt: str, *, require_json: bool) -> str:
        chapter_no = _extract_chapter_no(prompt)
        title = _extract_title(prompt, chapter_no)
        if role == "writer":
            return _chapter_text(chapter_no, title, marker="生成候选")
        if role == "reviewer":
            return json.dumps({"passed": True, "overall": "沙盒审核通过", "issues": []}, ensure_ascii=False)
        if role == "quick_fix":
            return _chapter_text(chapter_no, title, marker="修复候选")
        if role == "long_context":
            return json.dumps(
                {
                    "summary": f"第{chapter_no:03d}章已通过沙盒流水线。",
                    "character_state_delta": {},
                    "plot_state_delta": {"chapter": chapter_no},
                    "unresolved_hooks": [],
                    "items": [],
                    "locations": [],
                },
                ensure_ascii=False,
            )
        if require_json:
            return json.dumps({"passed": True, "issues": []}, ensure_ascii=False)
        return _chapter_text(chapter_no, title, marker=role)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a fake-model sandbox pipeline smoke test.")
    parser.add_argument("--workspace", default="runtime/sandbox_pipeline_workspace")
    parser.add_argument("--chapters", type=int, default=3)
    parser.add_argument("--publish", action="store_true", help="Publish into the sandbox workspace. Default is dry-run.")
    parser.add_argument("--reset", action="store_true", help="Reset the sandbox workspace before running.")
    args = parser.parse_args()

    workspace = Path(args.workspace)
    if args.reset or not workspace.exists():
        create_workspace(workspace, args.chapters)

    report: dict[str, Any]
    runtime_root = workspace / "runtime"
    with temporary_environment(
        {
            "CONTENT_ROOT": str(workspace),
            "APP_DB_PATH": str(runtime_root / "pipeline_smoke.db"),
            "WORKSPACE_RUNTIME_ROOT_OVERRIDE": str(runtime_root),
        }
    ):
        set_active_workspace(workspace)
        Base.metadata.create_all(get_engine())

        with get_session_local()() as session:
            LibraryScanner(session).scan()
            MemoryService(session).rebuild()
            fake = FakePipelineModelClient(session)
            executor = SmokePipelineTaskExecutor(session, fake)
            run = PipelineRunService(session).create_run(
                start_chapter=1,
                end_chapter=args.chapters,
                mode="full_auto",
                chunk_size=1,
                max_fix_rounds=1,
                dry_run=not args.publish,
            )
            iterations = run_until_idle(session, executor, max_iterations=args.chapters * 12 + 20)
            PipelineRunService(session).refresh_run_status(run["id"])
            stored_run = PipelineRunService(session).get_run(run["id"])
            report = build_report(session, stored_run, iterations, published=args.publish)
            assert_report(report, expected_chapters=args.chapters, published=args.publish)

        out = workspace_runtime_root() / "reports" / "sandbox_pipeline_smoke.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


@contextmanager
def temporary_environment(values: dict[str, str]):
    original = {key: os.environ.get(key) for key in values}
    try:
        os.environ.update(values)
        get_settings.cache_clear()
        reset_engine()
        yield
    finally:
        reset_engine()
        for key, value in original.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        get_settings.cache_clear()


class SmokePipelineTaskExecutor(PipelineTaskExecutor):
    def __init__(self, session, model_client: FakePipelineModelClient) -> None:
        super().__init__(session)
        self.model_client = model_client

    def _run_generate_chapter_draft(self, job: Job) -> dict[str, Any]:
        chapter = self._chapter(job)
        result = WriterService(self.session, model_client=self.model_client).generate_chapter_draft(chapter.id)
        self.machine.transition(
            job,
            "done",
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

    def _run_review_chapter_candidate(self, job: Job) -> dict[str, Any]:
        artifact_id = self._candidate_artifact_id(job)
        result = ReviewerService(self.session, model_client=self.model_client).review_candidate(artifact_id)
        if result["passed"]:
            target = "approved"
            error = None
        elif self._has_only_writer_issues(result["issues"]):
            target = "done"
            error = "Review found writer issues; queued fixer may continue"
        else:
            target = "manual_required"
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
        result = FixerService(self.session, model_client=self.model_client).fix_candidate(artifact_id, review_id=review_id)
        self.machine.transition(
            job,
            "done",
            result_updates={"artifact_id": result["artifact_id"], "review_id": result["review_id"], "no_fix_needed": result["status"] == "no_fix_needed"},
            payload_updates={"execution": "executed"},
            error=None,
        )
        return result

    def _run_publish_chapter_candidate(self, job: Job) -> dict[str, Any]:
        artifact_id = self._candidate_artifact_id(job)
        service = ReviewPublishService(self.session, model_client=self.model_client)
        if bool(job_payload(job).get("dry_run", True)):
            diff = service.diff_artifact(artifact_id)
            result = {
                "artifact_id": artifact_id,
                "dry_run": True,
                "diff_chars": len(diff["diff"]),
                "published": False,
            }
            self.machine.transition(
                job,
                "done",
                result_updates=result,
                payload_updates={"execution": "executed"},
                error=None,
            )
            return result
        result = service.publish_artifact(artifact_id, approved_by_user=True)
        self.machine.transition(
            job,
            "published",
            result_updates=result,
            payload_updates={"execution": "executed"},
            error=None,
        )
        return result

    def _run_summarize_published_chapter(self, job: Job) -> dict[str, Any]:
        chapter = self._chapter(job)
        result = SummarizerService(self.session, model_client=self.model_client).summarize_chapter(chapter.id)
        self.machine.transition(
            job,
            "done",
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


def run_until_idle(session, executor: SmokePipelineTaskExecutor, *, max_iterations: int) -> int:
    iterations = 0
    idle_count = 0
    while iterations < max_iterations and idle_count < 2:
        result = run_next_job(session, executor)
        iterations += 1
        idle_count = idle_count + 1 if result is None else 0
    return iterations


def run_next_job(session, executor: SmokePipelineTaskExecutor) -> dict[str, Any] | None:
    job = session.scalar(
        select(Job)
        .where(Job.status.in_(["queued", "paused_budget"]))
        .order_by(Job.created_at, Job.id)
    )
    if job is None:
        return None
    job.status = "running"
    session.commit()
    job_id = job.id
    try:
        executor.run_job(job_id)
    except Exception:
        session.rollback()
    stored = session.get(Job, job_id)
    if stored is not None:
        executor._refresh_parent(stored)
    return {
        "id": job_id,
        "status": stored.status if stored is not None else "missing",
        "error": stored.error if stored is not None else "Job missing",
    }


def build_report(session, run: dict[str, Any], iterations: int, *, published: bool) -> dict[str, Any]:
    tasks = run["child_tasks"]
    return {
        "run_id": run["id"],
        "run_status": run["status"],
        "published_mode": published,
        "iterations": iterations,
        "task_count": len(tasks),
        "task_status_counts": _counts(task["status"] for task in tasks),
        "task_type_counts": _counts(task["type"] for task in tasks),
        "artifact_count": session.query(Artifact).count(),
        "review_count": session.query(Review).count(),
        "model_call_count": session.query(ModelCall).count(),
        "publish_decision_count": session.query(PublishDecision).count(),
        "event_count": session.query(Event).count(),
        "failed_tasks": [
            {"id": task["id"], "type": task["type"], "status": task["status"], "error": task["error"]}
            for task in tasks
            if task["status"] not in {"done", "approved", "published"}
        ],
        "child_tasks": tasks,
    }


def assert_report(report: dict[str, Any], *, expected_chapters: int, published: bool) -> None:
    expected_tasks = expected_chapters * 6
    if report["task_count"] != expected_tasks:
        raise SmokeError(f"Expected {expected_tasks} tasks, got {report['task_count']}")
    if report["run_status"] != "done":
        raise SmokeError(f"Run did not finish: {report['run_status']}")
    if report["failed_tasks"]:
        raise SmokeError(f"Unexpected failed tasks: {report['failed_tasks']}")
    if report["model_call_count"] < expected_chapters * 3:
        raise SmokeError("Model call records are missing")
    if report["review_count"] < expected_chapters * 2:
        raise SmokeError("Review records are missing")
    if published and report["publish_decision_count"] != expected_chapters:
        raise SmokeError("Published run did not create one publish decision per chapter")
    if not published and report["publish_decision_count"] != 0:
        raise SmokeError("Dry-run created publish decisions")


def create_workspace(root: Path, chapters: int) -> None:
    resolved = root.resolve()
    app_runtime = (Path(__file__).resolve().parents[2] / "runtime").resolve()
    is_pytest_temp = any(part.startswith("pytest-") or part.startswith("pytest-of-") for part in resolved.parts)
    allowed_name = resolved.name.startswith("sandbox_") or resolved.name.endswith("_sandbox")
    if not allowed_name:
        raise SmokeError(f"Refuse to reset non-sandbox workspace: {resolved}")
    if app_runtime not in resolved.parents and resolved != app_runtime and not is_pytest_temp:
        raise SmokeError(f"Refuse to reset workspace outside app runtime: {resolved}")
    if resolved.exists():
        import shutil

        shutil.rmtree(resolved)
    _write(resolved / "settings" / "world.md", "# 设定\n\n主角李燃在训练营中逐步暴露异常能力。")
    outline = "\n\n".join(
        f"# 第{index:03d}章 沙盒章节{index}\n李燃完成第{index}次训练节点，能力表现必须稳步推进。"
        for index in range(1, chapters + 1)
    )
    _write(resolved / "outlines" / "outline.md", outline)
    manuscript = "\n\n".join(
        f"# 第{index:03d}章 沙盒章节{index}\n李燃站在训练场边，等待第{index}次测试开始。"
        for index in range(1, chapters + 1)
    )
    _write(resolved / "chapters" / "book.md", manuscript)


def _chapter_text(chapter_no: int, title: str, *, marker: str) -> str:
    paragraphs = []
    for index in range(1, 21):
        paragraphs.append(
            f"第{index}轮记录里，李燃站在训练场中央，按照章纲完成第{chapter_no}次训练节点。"
            f"他在第{index}次调整时确认呼吸、步点和观察顺序，再把注意力落到测试器的提示灯上。"
            f"这份{marker}的第{index}项描述只服务于沙盒流水线验证，保持既有设定，不新增角色，也不跨章推进。"
            f"旁观者在第{index}次记录中只看见他调整动作，没有得到任何额外世界观信息。"
        )
    return f"# 第{chapter_no:03d}章 {title}\n" + "\n".join(paragraphs)


def _extract_chapter_no(text: str) -> int:
    import re

    for pattern in [r"chapter_no[\"']?\s*[:：]\s*(\d+)", r"第\s*0*(\d+)\s*章"]:
        match = re.search(pattern, text)
        if match:
            return int(match.group(1))
    return 1


def _extract_title(text: str, chapter_no: int) -> str:
    import re

    match = re.search(rf"第\s*0*{chapter_no}\s*章\s*([^\n\"#]+)", text)
    if match:
        return match.group(1).strip() or f"沙盒章节{chapter_no}"
    return f"沙盒章节{chapter_no}"


def _counts(values) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return counts


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
