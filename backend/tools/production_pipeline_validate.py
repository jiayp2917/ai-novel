from __future__ import annotations

import argparse
import json
import os
from collections import Counter, defaultdict
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select

from backend.app.core.config import get_settings
from backend.app.db.base import Base
from backend.app.db.models import Artifact, Chapter, Job, ModelCall, PublishDecision, Review
from backend.app.repositories import Repository
from backend.app.db.session import get_engine, get_session_local, reset_engine
from backend.app.services.library import LibraryScanner
from backend.app.services.memory import MemoryService
from backend.app.services.pipeline.fixer import FixerService
from backend.app.services.pipeline.reviewer import ReviewerService
from backend.app.services.pipeline.planner import canonical_json
from backend.app.services.pipeline.writer import WriterService
from backend.app.services.review_publish import ReviewPublishService
from backend.app.services.workspace import set_active_workspace, workspace_runtime_root
from backend.tools.key_env import load_key_file
from backend.tools.model_usage_report import render_report as render_model_usage_report


SUCCESS_STATUSES = {"done", "approved", "published", "summarized"}
FAILURE_STATUSES = {"manual_required", "failed_terminal", "failed_retryable", "paused_budget"}


@dataclass(frozen=True)
class ValidationOptions:
    workspace: Path
    start_chapter: int
    end_chapter: int
    mode: str
    key_file: Path
    max_iterations: int
    max_role_failure_rate: float
    max_consecutive_chapter_failures: int


def main() -> int:
    parser = argparse.ArgumentParser(description="Run production-like pipeline validation in dry-run mode.")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--start-chapter", type=int, required=True)
    parser.add_argument("--end-chapter", type=int, required=True)
    parser.add_argument("--mode", choices=["full_dry_run"], default="full_dry_run")
    parser.add_argument("--key-file", default="key.txt")
    parser.add_argument("--max-iterations", type=int, default=400)
    parser.add_argument("--max-role-failure-rate", type=float, default=0.30)
    parser.add_argument("--max-consecutive-chapter-failures", type=int, default=2)
    args = parser.parse_args()

    options = ValidationOptions(
        workspace=Path(args.workspace).resolve(),
        start_chapter=args.start_chapter,
        end_chapter=args.end_chapter,
        mode=args.mode,
        key_file=Path(args.key_file),
        max_iterations=args.max_iterations,
        max_role_failure_rate=args.max_role_failure_rate,
        max_consecutive_chapter_failures=args.max_consecutive_chapter_failures,
    )
    report = run_validation(options)
    print(json.dumps({"status": report["status"], "stop_reason": report["stop_reason"], "report_json": report["report_json"], "report_md": report["report_md"]}, ensure_ascii=False, indent=2))
    return 0 if report["status"] in {"completed", "stopped"} else 1


def run_validation(options: ValidationOptions) -> dict[str, Any]:
    if options.start_chapter > options.end_chapter:
        raise ValueError("start-chapter must be <= end-chapter")
    load_key_file(options.key_file, override=True)
    runtime_root = options.workspace / "runtime" / "production_validation"
    app_db_path = runtime_root / "app.db"
    stamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    source_hashes_before = _source_hashes(options.workspace)
    report: dict[str, Any]
    with temporary_environment(
        {
            "CONTENT_ROOT": str(options.workspace),
            "APP_DB_PATH": str(app_db_path),
            "WORKSPACE_RUNTIME_ROOT_OVERRIDE": str(runtime_root),
        }
    ):
        set_active_workspace(options.workspace)
        Base.metadata.create_all(get_engine())
        with get_session_local()() as session:
            LibraryScanner(session).scan()
            MemoryService(session).rebuild()
            result = _run_chapter_range(session, options)
            source_hashes_after = _source_hashes(options.workspace)
            calls = list(session.scalars(select(ModelCall).order_by(ModelCall.created_at, ModelCall.id)))
            jobs = list(session.scalars(select(Job).order_by(Job.created_at, Job.id)))
            artifacts = list(session.scalars(select(Artifact).order_by(Artifact.created_at, Artifact.id)))
            reviews = list(session.scalars(select(Review).order_by(Review.created_at, Review.id)))
            decisions = list(session.scalars(select(PublishDecision).order_by(PublishDecision.id)))
            report = build_validation_report(
                options=options,
                run_result=result,
                calls=calls,
                jobs=jobs,
                artifacts=artifacts,
                reviews=reviews,
                decisions=decisions,
                source_hashes_before=source_hashes_before,
                source_hashes_after=source_hashes_after,
            )
            report_dir = workspace_runtime_root() / "reports"
            report_dir.mkdir(parents=True, exist_ok=True)
            json_path = report_dir / f"production_pipeline_validate_{stamp}.json"
            md_path = report_dir / f"production_pipeline_validate_{stamp}.md"
            report["report_json"] = str(json_path)
            report["report_md"] = str(md_path)
            json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            md_path.write_text(render_markdown(report) + "\n\n" + render_model_usage_report(calls, jobs, reviews=reviews, artifacts=artifacts, decisions=decisions), encoding="utf-8")
    return report


def _run_chapter_range(session, options: ValidationOptions) -> dict[str, Any]:
    completed: list[int] = []
    stopped = False
    stop_reason = "completed"
    for chapter_no in range(options.start_chapter, options.end_chapter + 1):
        _run_chapter(session, chapter_no)
        completed.append(chapter_no)
        stop_reason = _stop_reason(session, options)
        if stop_reason:
            stopped = True
            break
    return {"completed_chapters": completed, "stopped": stopped, "stop_reason": stop_reason if stopped else "completed"}


def _run_chapter(session, chapter_no: int) -> None:
    chapter = session.scalar(select(Chapter).where(Chapter.chapter_no == chapter_no, Chapter.active.is_(True)))
    if chapter is None:
        _record_validation_job(session, chapter_no, "chapter_missing", "manual_required", error="Chapter not found")
        return
    writer_job = _record_validation_job(session, chapter_no, "generate_chapter_draft", "running", chapter=chapter)
    try:
        draft = WriterService(session).generate_chapter_draft(chapter.id)
        _finish_validation_job(session, writer_job, "done", {"artifact_id": draft["artifact_id"], "model_call_id": draft["model_call_id"]})
    except Exception as exc:
        _finish_validation_job(session, writer_job, "manual_required", {}, error=str(exc))
        return

    review_job = _record_validation_job(session, chapter_no, "review_chapter_candidate", "running", chapter=chapter)
    try:
        review = ReviewerService(session).review_candidate(draft["artifact_id"])
        review_status = "approved" if review["passed"] else "done" if _has_only_writer_issues(review["issues"]) else "manual_required"
        _finish_validation_job(session, review_job, review_status, {"artifact_id": draft["artifact_id"], "review_id": review["review_id"], "model_call_id": review["model_call_id"]})
    except Exception as exc:
        _finish_validation_job(session, review_job, "manual_required", {"artifact_id": draft["artifact_id"]}, error=str(exc))
        return
    if review["passed"]:
        _write_diff(session, chapter_no, draft["artifact_id"], chapter)
        return
    if not _has_only_writer_issues(review["issues"]):
        return

    fix_job = _record_validation_job(session, chapter_no, "fix_chapter_candidate", "running", chapter=chapter)
    try:
        fixed = FixerService(session).fix_candidate(draft["artifact_id"], review_id=review["review_id"])
        if fixed["status"] != "fixed":
            _finish_validation_job(session, fix_job, "manual_required", {"artifact_id": draft["artifact_id"], "review_id": review["review_id"], "no_fix_needed": fixed["status"] == "no_fix_needed"})
            return
        _finish_validation_job(session, fix_job, "done", {"artifact_id": fixed["artifact_id"], "parent_artifact_id": fixed["parent_artifact_id"], "review_id": fixed["review_id"], "model_call_id": fixed["model_call_id"]})
    except Exception as exc:
        _finish_validation_job(session, fix_job, "manual_required", {"artifact_id": draft["artifact_id"], "review_id": review["review_id"]}, error=str(exc))
        return

    rereview_job = _record_validation_job(session, chapter_no, "review_fixed_candidate", "running", chapter=chapter)
    try:
        rereview = ReviewerService(session).review_candidate(fixed["artifact_id"])
        status = "approved" if rereview["passed"] else "manual_required"
        _finish_validation_job(session, rereview_job, status, {"artifact_id": fixed["artifact_id"], "review_id": rereview["review_id"], "model_call_id": rereview["model_call_id"]})
    except Exception as exc:
        _finish_validation_job(session, rereview_job, "manual_required", {"artifact_id": fixed["artifact_id"]}, error=str(exc))
        return
    if rereview["passed"]:
        _write_diff(session, chapter_no, fixed["artifact_id"], chapter)


def _write_diff(session, chapter_no: int, artifact_id: int, chapter: Chapter) -> None:
    diff_job = _record_validation_job(session, chapter_no, "dry_run_diff", "running", chapter=chapter)
    try:
        diff = ReviewPublishService(session).write_diff_artifact(artifact_id)
        _finish_validation_job(session, diff_job, "done", {"artifact_id": artifact_id, "diff_path": diff["path"], "diff_chars": len(diff["diff"])})
    except Exception as exc:
        _finish_validation_job(session, diff_job, "manual_required", {"artifact_id": artifact_id}, error=str(exc))


def _has_only_writer_issues(issues: list[dict[str, Any]]) -> bool:
    if not issues:
        return False
    return all(isinstance(issue, dict) and issue.get("owner") == "writer" for issue in issues)


def _record_validation_job(session, chapter_no: int, task_type: str, status: str, *, chapter: Chapter | None = None, error: str | None = None) -> Job:
    payload = {"chapter_no": chapter_no, "task_type": task_type, "dry_run": True, "validation": "production_pipeline_validate"}
    job = Repository(session, Job).create(
        {
            "type": task_type,
            "status": status,
            "payload_json": canonical_json(payload),
            "result_json": None,
            "error": error,
            "locked_chapter_id": chapter.id if chapter is not None else None,
            "locked_source_file_id": chapter.source_file_id if chapter is not None else None,
        }
    )
    session.commit()
    return job


def _finish_validation_job(session, job: Job, status: str, result: dict[str, Any], *, error: str | None = None) -> None:
    job.status = status
    job.result_json = canonical_json(result)
    job.error = error
    session.commit()


def _stop_reason(session, options: ValidationOptions) -> str | None:
    jobs = list(session.scalars(select(Job).order_by(Job.id)))
    if any(job.status == "paused_budget" for job in jobs):
        return "budget_paused"
    chapter_status = _chapter_statuses(jobs)
    if _consecutive_failures(chapter_status, options.start_chapter, options.end_chapter) >= options.max_consecutive_chapter_failures:
        return "consecutive_chapter_failures"
    calls = list(session.scalars(select(ModelCall)))
    for role, rate in _role_failure_rates(calls).items():
        if rate > options.max_role_failure_rate:
            return f"role_failure_rate:{role}:{rate:.2f}"
    return None


def build_validation_report(
    *,
    options: ValidationOptions,
    run_result: dict[str, Any],
    calls: list[ModelCall],
    jobs: list[Job],
    artifacts: list[Artifact],
    reviews: list[Review],
    decisions: list[PublishDecision],
    source_hashes_before: dict[str, str],
    source_hashes_after: dict[str, str],
) -> dict[str, Any]:
    chapter_results = _chapter_results(jobs, reviews)
    role_metrics = _role_metrics(calls)
    review_metrics = _review_metrics(reviews)
    stop_reason = run_result["stop_reason"] if run_result["stopped"] else _final_stop_reason(jobs, calls, options)
    source_hash_unchanged = source_hashes_before == source_hashes_after
    return {
        "status": "completed" if stop_reason == "completed" else "stopped",
        "stop_reason": stop_reason,
        "workspace": str(options.workspace),
        "chapter_range": [options.start_chapter, options.end_chapter],
        "mode": options.mode,
        "dry_run": True,
        "completed_chapters": run_result["completed_chapters"],
        "run_status": "dry_run_completed" if stop_reason == "completed" else "dry_run_stopped",
        "source_hash_unchanged": source_hash_unchanged,
        "source_hash_changed_count": len(_changed_hashes(source_hashes_before, source_hashes_after)),
        "job_status_counts": dict(Counter(job.status for job in jobs)),
        "artifact_count": len(artifacts),
        "review_count": len(reviews),
        "publish_decision_count": len(decisions),
        "published_count": sum(1 for decision in decisions if decision.published_at is not None),
        "chapter_results": chapter_results,
        "quality": {
            "chapter_pass_rate": _safe_rate(sum(1 for item in chapter_results if item["passed"]), len(chapter_results)),
            "manual_required": sum(1 for item in chapter_results if item["manual_required"]),
            "no_evidence_issues": review_metrics["no_evidence_issues"],
            "evidence_issues": review_metrics["evidence_issues"],
            "issue_count": review_metrics["issue_count"],
            "review_pass_rate": _safe_rate(review_metrics["passed"], len(reviews)),
        },
        "model_metrics": role_metrics,
        "route_decision": _route_decision(role_metrics, review_metrics),
        "report_json": None,
        "report_md": None,
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# 生产级流水线验证报告",
        "",
        f"- 工作区：`{report['workspace']}`",
        f"- 章节范围：{report['chapter_range'][0]}-{report['chapter_range'][1]}",
        f"- 状态：{report['status']}",
        f"- 停机原因：{report['stop_reason']}",
        f"- 原始正文 hash 未变化：{report['source_hash_unchanged']}",
        f"- 发布写回数量：{report['published_count']}",
        "",
        "## 质量指标",
        "",
        f"- 章节通过率：{report['quality']['chapter_pass_rate']:.2%}",
        f"- manual_required：{report['quality']['manual_required']}",
        f"- 无证据问题：{report['quality']['no_evidence_issues']}",
        f"- 有证据问题：{report['quality']['evidence_issues']}",
        f"- 审核通过率：{report['quality']['review_pass_rate']:.2%}",
        "",
        "## 模型指标",
        "",
        "| Role | Calls | Success Rate | Failed | Avg Seconds | Visible Tokens Lower Bound |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for role, item in sorted(report["model_metrics"].items()):
        lines.append(
            f"| {role} | {item['calls']} | {item['success_rate']:.2%} | {item['failed']} | "
            f"{item['avg_elapsed_seconds']:.3f} | {item['visible_token_lower_bound']:.0f} |"
        )
    lines.extend(
        [
            "",
            "## 章节结果",
            "",
            "| Chapter | Status | Passed | Manual | Reviews | Issues |",
            "|---:|---|---|---|---:|---:|",
        ]
    )
    for item in report["chapter_results"]:
        lines.append(
            f"| {item['chapter_no']} | {item['status']} | {item['passed']} | {item['manual_required']} | "
            f"{item['review_count']} | {item['issue_count']} |"
        )
    lines.extend(
        [
            "",
            "## 路由结论",
            "",
            report["route_decision"],
            "",
            "> 本地 token/usage 为日志可见下限，真实消耗以供应商控制台为准。",
        ]
    )
    return "\n".join(lines)


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


def _source_hashes(workspace: Path) -> dict[str, str]:
    from backend.tools.workspace_migrate import sha256_file

    roots = ("00-系统", "01-设定", "02-正文", "03-章纲")
    hashes: dict[str, str] = {}
    for root in roots:
        directory = workspace / root
        if not directory.exists():
            continue
        for path in sorted(directory.rglob("*")):
            if path.is_file():
                hashes[path.relative_to(workspace).as_posix()] = sha256_file(path)
    return hashes


def _changed_hashes(before: dict[str, str], after: dict[str, str]) -> dict[str, tuple[str | None, str | None]]:
    keys = set(before) | set(after)
    return {key: (before.get(key), after.get(key)) for key in keys if before.get(key) != after.get(key)}


def _chapter_statuses(jobs: list[Job]) -> dict[int, str]:
    statuses: dict[int, str] = {}
    for job in jobs:
        payload = _loads(job.payload_json, {})
        chapter_no = payload.get("chapter_no")
        if not isinstance(chapter_no, int):
            continue
        if job.status in FAILURE_STATUSES:
            statuses[chapter_no] = job.status
        elif chapter_no not in statuses:
            statuses[chapter_no] = job.status
    return statuses


def _consecutive_failures(chapter_status: dict[int, str], start: int, end: int) -> int:
    longest = 0
    current = 0
    for chapter_no in range(start, end + 1):
        if chapter_status.get(chapter_no) in FAILURE_STATUSES:
            current += 1
            longest = max(longest, current)
        else:
            current = 0
    return longest


def _role_failure_rates(calls: list[ModelCall]) -> dict[str, float]:
    counts: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for call in calls:
        counts[call.role][0] += 1
        counts[call.role][1] += int(call.status != "succeeded")
    return {role: failed / total for role, (total, failed) in counts.items() if total}


def _role_metrics(calls: list[ModelCall]) -> dict[str, dict[str, Any]]:
    buckets: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "calls": 0,
            "success": 0,
            "failed": 0,
            "elapsed": 0.0,
            "tokens": 0.0,
            "input_chars": 0,
            "output_chars": 0,
            "estimated_million_tokens": 0.0,
            "errors": Counter(),
        }
    )
    for call in calls:
        bucket = buckets[call.role]
        bucket["calls"] += 1
        bucket["success"] += int(call.status == "succeeded")
        bucket["failed"] += int(call.status != "succeeded")
        bucket["input_chars"] += call.input_chars
        bucket["output_chars"] += call.output_chars
        bucket["estimated_million_tokens"] += float(call.cost_estimate or 0)
        usage = _loads(call.usage_json, {})
        bucket["elapsed"] += float(_number(usage.get("elapsed_seconds")) or 0)
        bucket["tokens"] += float(_number(usage.get("total_tokens")) or 0)
        if call.error:
            bucket["errors"][_sanitize_error(call.error)] += 1
    return {
        role: {
            "calls": bucket["calls"],
            "success": bucket["success"],
            "failed": bucket["failed"],
            "success_rate": _safe_rate(bucket["success"], bucket["calls"]),
            "avg_elapsed_seconds": bucket["elapsed"] / bucket["calls"] if bucket["calls"] else 0,
            "avg_input_chars": bucket["input_chars"] / bucket["calls"] if bucket["calls"] else 0,
            "avg_output_chars": bucket["output_chars"] / bucket["calls"] if bucket["calls"] else 0,
            "visible_token_lower_bound": bucket["tokens"],
            "estimated_million_tokens": bucket["estimated_million_tokens"],
            "errors": dict(bucket["errors"]),
        }
        for role, bucket in buckets.items()
    }


def _review_metrics(reviews: list[Review]) -> dict[str, int]:
    metrics = {"passed": 0, "issue_count": 0, "evidence_issues": 0, "no_evidence_issues": 0}
    for review in reviews:
        metrics["passed"] += int(review.passed)
        issues = _loads(review.issues_json, [])
        if not isinstance(issues, list):
            continue
        for issue in issues:
            if not isinstance(issue, dict):
                continue
            metrics["issue_count"] += 1
            if str(issue.get("evidence") or "").strip():
                metrics["evidence_issues"] += 1
            else:
                metrics["no_evidence_issues"] += 1
    return metrics


def _chapter_results(jobs: list[Job], reviews: list[Review]) -> list[dict[str, Any]]:
    by_chapter: dict[int, list[Job]] = defaultdict(list)
    for job in jobs:
        payload = _loads(job.payload_json, {})
        chapter_no = payload.get("chapter_no")
        if isinstance(chapter_no, int):
            by_chapter[chapter_no].append(job)
    reviews_by_artifact: dict[int, list[Review]] = defaultdict(list)
    for review in reviews:
        reviews_by_artifact[review.artifact_id].append(review)
    results = []
    for chapter_no, chapter_jobs in sorted(by_chapter.items()):
        artifact_ids = []
        for job in chapter_jobs:
            merged = {**_loads(job.payload_json, {}), **_loads(job.result_json or "{}", {})}
            raw = merged.get("artifact_id")
            if isinstance(raw, int):
                artifact_ids.append(raw)
        chapter_reviews = [review for artifact_id in artifact_ids for review in reviews_by_artifact.get(artifact_id, [])]
        issue_count = 0
        for review in chapter_reviews:
            issues = _loads(review.issues_json, [])
            issue_count += len(issues) if isinstance(issues, list) else 0
        failed = any(job.status in FAILURE_STATUSES for job in chapter_jobs)
        passed = bool(chapter_reviews) and chapter_reviews[-1].passed and not failed
        results.append(
            {
                "chapter_no": chapter_no,
                "status": "failed" if failed else "passed" if passed else "incomplete",
                "passed": passed,
                "manual_required": any(job.status == "manual_required" for job in chapter_jobs) or any(review.manual_required for review in chapter_reviews),
                "review_count": len(chapter_reviews),
                "issue_count": issue_count,
            }
        )
    return results


def _final_stop_reason(jobs: list[Job], calls: list[ModelCall], options: ValidationOptions) -> str:
    if any(job.status == "paused_budget" for job in jobs):
        return "budget_paused"
    chapter_status = _chapter_statuses(jobs)
    if _consecutive_failures(chapter_status, options.start_chapter, options.end_chapter) >= options.max_consecutive_chapter_failures:
        return "consecutive_chapter_failures"
    for role, rate in _role_failure_rates(calls).items():
        if rate > options.max_role_failure_rate:
            return f"role_failure_rate:{role}:{rate:.2f}"
    return "completed"


def _route_decision(role_metrics: dict[str, dict[str, Any]], review_metrics: dict[str, int]) -> str:
    if not role_metrics:
        return "样本不足：未产生模型调用，不调整模型路由。"
    auth_failed_roles = [
        role
        for role, metrics in role_metrics.items()
        if any(_is_auth_error(error) for error in metrics.get("errors", {}))
    ]
    if auth_failed_roles:
        return f"{', '.join(sorted(auth_failed_roles))} 出现 API 认证失败；这是 key/base_url 连接问题，不作为模型质量证据，不调整模型路由。"
    reviewer = role_metrics.get("reviewer")
    if reviewer and reviewer["success_rate"] < 0.7:
        return "reviewer 成功率低于 70%，建议单独评估 DeepSeek 与 Qwen/GLM 复核链，不在本轮直接改路由。"
    if review_metrics["issue_count"] and review_metrics["no_evidence_issues"] / review_metrics["issue_count"] > 0.2:
        return "无证据问题占比超过 20%，建议收紧 reviewer prompt 或增加交叉复核，不在本轮直接改路由。"
    writer = role_metrics.get("writer")
    if writer and writer["success_rate"] < 0.7:
        return "writer 成功率低于 70%，建议复测 Kimi 与 GLM 写作候选，不在本轮直接改路由。"
    return "当前样本未显示某模型明显优于默认岗位模型，保持现有模型路由。"


def _safe_rate(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0


def _loads(raw: str | None, fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return fallback


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _sanitize_error(error: str) -> str:
    return error.replace("\n", " ")[:240]


def _is_auth_error(error: str) -> bool:
    lowered = error.lower()
    return "401" in lowered or "incorrect_api_key" in lowered or "invalid api key" in lowered or "unauthorized" in lowered


if __name__ == "__main__":
    raise SystemExit(main())
