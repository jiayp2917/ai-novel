from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy import select

from backend.app.db.models import Artifact, Job, ModelCall, PublishDecision, Review
from backend.app.db.session import get_session_local
from backend.app.services.pipeline.local_rules import (
    TARGET_CHARS_HARD_MAX,
    TARGET_CHARS_HARD_MIN,
    TARGET_CHARS_MAX,
    TARGET_CHARS_MIN,
    count_chinese_chars,
)
from backend.app.services.workspace import workspace_runtime_root


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate a model usage and workflow report from SQLite runtime data.")
    parser.add_argument("--out", default="runtime/logs/model_usage_report.md")
    args = parser.parse_args()

    with get_session_local()() as session:
        calls = list(session.scalars(select(ModelCall).order_by(ModelCall.created_at, ModelCall.id)))
        jobs = list(session.scalars(select(Job).order_by(Job.created_at, Job.id)))
        artifacts = list(session.scalars(select(Artifact).order_by(Artifact.created_at, Artifact.id)))
        reviews = list(session.scalars(select(Review).order_by(Review.created_at, Review.id)))
        decisions = list(session.scalars(select(PublishDecision).order_by(PublishDecision.id)))

    report = render_report(calls, jobs, reviews=reviews, artifacts=artifacts, decisions=decisions)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report, encoding="utf-8")
    print(str(out_path))
    return 0


def render_report(
    calls: list[ModelCall],
    jobs: list[Job],
    *,
    reviews: list[Review] | None = None,
    artifacts: list[Artifact] | None = None,
    decisions: list[PublishDecision] | None = None,
) -> str:
    report_data = collect_model_usage_report(
        calls,
        jobs,
        reviews=reviews,
        artifacts=artifacts,
        decisions=decisions,
        include_raw=True,
    )
    reviews = reviews or []
    artifacts = artifacts or []
    decisions = decisions or []
    raw_metrics = report_data["_raw"]
    by_route = raw_metrics["by_route"]
    artifact_metrics = raw_metrics["artifact_metrics"]
    review_metrics = raw_metrics["review_metrics"]
    publish_metrics = raw_metrics["publish_metrics"]
    job_counts = raw_metrics["job_counts"]

    lines = [
        "# 模型调用与流程统计报告",
        "",
        f"生成时间：{datetime.now(UTC).isoformat()}",
        "",
        "> 说明：本报告基于本地数据库与运行态产物生成，只能表示“日志可见 token/usage 下限”。Kimi、DeepSeek、Qwen、GLM 的真实计费与缓存命中以供应商控制台为准。",
        "",
        "## 任务状态",
        "",
        "| 状态 | 数量 |",
        "|---|---:|",
    ]
    for status, count in sorted(job_counts.items()):
        lines.append(f"| {status} | {count} |")
    if not job_counts:
        lines.append("| 无任务 | 0 |")

    lines.extend(
        [
            "",
            "## 模型调用",
            "",
            "| Role | Provider | Model | Calls | Success Rate | Failed/Budget | Cache | Avg Input | Avg Output | Provider Tokens | Estimate(M tokens) | Avg Elapsed(s) | Usage Source |",
            "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
        ]
    )
    for (role, provider, model), bucket in sorted(by_route.items()):
        calls_count = bucket["calls"]
        usage_sources = ", ".join(f"{name}:{count}" for name, count in bucket["usage_sources"].most_common()) or "-"
        lines.append(
            "| "
            + " | ".join(
                [
                    role,
                    provider,
                    model,
                    str(calls_count),
                    _pct(bucket["success"], calls_count),
                    str(bucket["failed"] + bucket["paused_budget"]),
                    str(bucket["cache_hits"]),
                    f"{bucket['input_chars'] / calls_count:.1f}",
                    f"{bucket['output_chars'] / calls_count:.1f}",
                    f"{bucket['provider_tokens']:.0f}",
                    f"{bucket['estimated_million_tokens']:.6f}",
                    f"{bucket['elapsed_seconds'] / calls_count:.3f}",
                    usage_sources,
                ]
            )
            + " |"
        )
    if not by_route:
        lines.append("| 无调用 | - | - | 0 | 0% | 0 | 0 | 0 | 0 | 0 | 0 | 0 | - |")

    lines.extend(_review_section(review_metrics))
    lines.extend(_artifact_section(artifact_metrics))
    lines.extend(_publish_section(publish_metrics))
    lines.extend(_error_section(by_route))
    lines.extend(_recommendation_section(review_metrics, artifact_metrics))
    return "\n".join(lines) + "\n"


def collect_model_usage_report(
    calls: list[ModelCall],
    jobs: list[Job],
    *,
    reviews: list[Review] | None = None,
    artifacts: list[Artifact] | None = None,
    decisions: list[PublishDecision] | None = None,
    runtime_root: Path | None = None,
    chapter_lookup: dict[int, dict[str, Any]] | None = None,
    include_raw: bool = False,
) -> dict[str, Any]:
    reviews = reviews or []
    artifacts = artifacts or []
    decisions = decisions or []
    runtime_root = runtime_root or _default_runtime_root()
    by_route = _model_call_buckets(calls)
    artifact_metrics = _artifact_metrics(artifacts)
    review_metrics = _review_metrics(reviews, artifacts)
    publish_metrics = _publish_metrics(decisions)
    job_counts = Counter(job.status for job in jobs)

    report = {
        "generated_at": datetime.now(UTC).isoformat(),
        "usage_note": "本地 usage 是日志可见下限；真实消耗以供应商控制台为准。",
        "summary": _summary(calls, jobs, by_route, job_counts),
        "role_usage": _role_usage(by_route),
        "role_quality": {
            "reviewer": _reviewer_quality(review_metrics),
            "writer": _writer_quality(artifacts, runtime_root),
            "fixer": _fixer_quality(reviews, artifacts),
        },
        "context_budget": _context_budget(artifacts, runtime_root, chapter_lookup or {}),
        "recommendations": _recommendations_data(review_metrics, artifact_metrics),
        "publish": {
            "total": publish_metrics["total"],
            "published": publish_metrics["published"],
            "user_approved": publish_metrics["user_approved"],
            "forced": publish_metrics["forced"],
        },
    }
    if include_raw:
        report["_raw"] = {
            "by_route": by_route,
            "artifact_metrics": artifact_metrics,
            "review_metrics": review_metrics,
            "publish_metrics": publish_metrics,
            "job_counts": job_counts,
        }
    return report


def _model_call_buckets(calls: Iterable[ModelCall]) -> dict[tuple[str, str, str], dict[str, Any]]:
    by_route: dict[tuple[str, str, str], dict[str, Any]] = defaultdict(
        lambda: {
            "calls": 0,
            "success": 0,
            "failed": 0,
            "paused_budget": 0,
            "cache_hits": 0,
            "input_chars": 0,
            "output_chars": 0,
            "provider_tokens": 0.0,
            "estimated_million_tokens": 0.0,
            "elapsed_seconds": 0.0,
            "usage_sources": Counter(),
            "errors": Counter(),
        }
    )
    for call in calls:
        bucket = by_route[(call.role, call.provider, call.model)]
        bucket["calls"] += 1
        bucket["success"] += int(call.status == "succeeded")
        bucket["failed"] += int(call.status == "failed")
        bucket["paused_budget"] += int(call.status == "paused_budget")
        bucket["cache_hits"] += int(call.cache_hit)
        bucket["input_chars"] += call.input_chars
        bucket["output_chars"] += call.output_chars
        usage = _loads_json(call.usage_json, {})
        usage_source = str(usage.get("usage_source") or "unknown")
        bucket["usage_sources"][usage_source] += 1
        total_tokens = _number(usage.get("total_tokens"))
        if total_tokens is not None:
            bucket["provider_tokens"] += total_tokens
        bucket["estimated_million_tokens"] += _estimated_million_tokens(call, total_tokens)
        bucket["elapsed_seconds"] += float(_number(usage.get("elapsed_seconds")) or 0)
        if call.error:
            bucket["errors"][_sanitize_error(call.error)] += 1
    return by_route


def _summary(
    calls: list[ModelCall],
    jobs: list[Job],
    by_route: dict[tuple[str, str, str], dict[str, Any]],
    job_counts: Counter[str],
) -> dict[str, Any]:
    total_calls = len(calls)
    succeeded = sum(1 for call in calls if call.status == "succeeded")
    failed = sum(1 for call in calls if call.status == "failed")
    paused_budget = sum(1 for call in calls if call.status == "paused_budget")
    input_chars = sum(call.input_chars for call in calls)
    output_chars = sum(call.output_chars for call in calls)
    provider_tokens = sum(bucket["provider_tokens"] for bucket in by_route.values())
    estimated_million_tokens = sum(bucket["estimated_million_tokens"] for bucket in by_route.values())
    elapsed = sum(bucket["elapsed_seconds"] for bucket in by_route.values())
    return {
        "model_calls": total_calls,
        "success": succeeded,
        "failed": failed,
        "paused_budget": paused_budget,
        "success_rate": _ratio(succeeded, total_calls),
        "input_chars": input_chars,
        "output_chars": output_chars,
        "provider_tokens": provider_tokens,
        "estimated_million_tokens": estimated_million_tokens,
        "avg_elapsed_seconds": elapsed / total_calls if total_calls else 0,
        "jobs": {
            "total": len(jobs),
            "by_status": dict(sorted(job_counts.items())),
        },
    }


def _role_usage(by_route: dict[tuple[str, str, str], dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for (role, provider, model), bucket in sorted(by_route.items()):
        calls_count = bucket["calls"]
        rows.append(
            {
                "role": role,
                "provider": provider,
                "model": model,
                "calls": calls_count,
                "success": bucket["success"],
                "failed": bucket["failed"],
                "paused_budget": bucket["paused_budget"],
                "success_rate": _ratio(bucket["success"], calls_count),
                "cache_hits": bucket["cache_hits"],
                "input_chars": bucket["input_chars"],
                "output_chars": bucket["output_chars"],
                "avg_input_chars": bucket["input_chars"] / calls_count if calls_count else 0,
                "avg_output_chars": bucket["output_chars"] / calls_count if calls_count else 0,
                "provider_tokens": bucket["provider_tokens"],
                "estimated_million_tokens": bucket["estimated_million_tokens"],
                "avg_elapsed_seconds": bucket["elapsed_seconds"] / calls_count if calls_count else 0,
                "usage_sources": dict(bucket["usage_sources"]),
                "errors": [
                    {"message": message, "count": count}
                    for message, count in bucket["errors"].most_common(5)
                ],
            }
        )
    return rows


def _reviewer_quality(metrics: dict[str, Any]) -> dict[str, Any]:
    issue_count = metrics["issue_count"]
    return {
        "reviews": metrics["total"],
        "passed": metrics["passed"],
        "pass_rate": _ratio(metrics["passed"], metrics["total"]),
        "manual_required": metrics["manual_required"],
        "issues": issue_count,
        "evidence_issues": metrics["evidence_issue_count"],
        "no_evidence_issues": metrics["no_evidence_issue_count"],
        "evidence_rate": _ratio(metrics["evidence_issue_count"], issue_count),
        "local_rule_issues": metrics["source_counts"].get("local_rule", 0),
        "json_parse_failed": metrics["parse_failed"],
        "owner_counts": dict(metrics["owner_counts"]),
        "severity_counts": dict(metrics["severity_counts"]),
        "source_counts": dict(metrics["source_counts"]),
    }


def _writer_quality(artifacts: list[Artifact], runtime_root: Path) -> dict[str, Any]:
    candidates = [
        artifact
        for artifact in artifacts
        if artifact.kind == "candidate" and _metadata(artifact).get("task_type") == "generate_chapter_draft"
    ]
    passed = 0
    too_short = 0
    too_long = 0
    unknown = 0
    counts: list[dict[str, Any]] = []
    for artifact in candidates:
        count = _artifact_chinese_count(artifact, runtime_root)
        if count is None:
            unknown += 1
            counts.append({"artifact_id": artifact.id, "base_chapter_id": artifact.base_chapter_id, "chinese_chars": None, "status": "unknown"})
            continue
        if count < TARGET_CHARS_HARD_MIN:
            too_short += 1
            status = "too_short"
        elif count > TARGET_CHARS_HARD_MAX:
            too_long += 1
            status = "too_long"
        else:
            passed += 1
            status = "passed"
        counts.append({"artifact_id": artifact.id, "base_chapter_id": artifact.base_chapter_id, "chinese_chars": count, "status": status})
    known = len(candidates) - unknown
    return {
        "candidate_count": len(candidates),
        "known_count": known,
        "unknown_count": unknown,
        "word_count_passed": passed,
        "word_count_failed": too_short + too_long,
        "word_count_pass_rate": _ratio(passed, known),
        "too_short": too_short,
        "too_long": too_long,
        "target_min": TARGET_CHARS_MIN,
        "target_max": TARGET_CHARS_MAX,
        "hard_min": TARGET_CHARS_HARD_MIN,
        "hard_max": TARGET_CHARS_HARD_MAX,
        "samples": counts[-20:],
    }


def _fixer_quality(reviews: list[Review], artifacts: list[Artifact]) -> dict[str, Any]:
    review_by_artifact: dict[int, list[Review]] = defaultdict(list)
    for review in reviews:
        review_by_artifact[review.artifact_id].append(review)
    for artifact_reviews in review_by_artifact.values():
        artifact_reviews.sort(key=lambda review: (review.created_at, review.id or 0))

    fix_artifacts = [
        artifact
        for artifact in artifacts
        if artifact.kind == "candidate" and _metadata(artifact).get("task_type") == "fix_chapter_candidate"
    ]
    reviewed = 0
    passed = 0
    failed = 0
    waiting = 0
    unknown = 0
    samples: list[dict[str, Any]] = []
    for artifact in fix_artifacts:
        artifact_reviews = review_by_artifact.get(artifact.id, [])
        metadata = _metadata(artifact)
        if artifact_reviews:
            reviewed += 1
            latest = artifact_reviews[-1]
            if latest.passed:
                passed += 1
                status = "passed"
            else:
                failed += 1
                status = "failed"
            review_id = latest.id
        else:
            waiting += 1
            status = "waiting_review"
            review_id = None
        if metadata.get("parent_artifact_id") is None:
            unknown += 1
        samples.append(
            {
                "artifact_id": artifact.id,
                "base_chapter_id": artifact.base_chapter_id,
                "parent_artifact_id": metadata.get("parent_artifact_id"),
                "review_id": review_id,
                "status": status,
            }
        )
    return {
        "fixed_candidate_count": len(fix_artifacts),
        "reviewed_count": reviewed,
        "passed": passed,
        "failed": failed,
        "waiting_review": waiting,
        "unknown_count": unknown,
        "rereview_pass_rate": _ratio(passed, reviewed),
        "samples": samples[-20:],
    }


def _context_budget(artifacts: list[Artifact], runtime_root: Path, chapter_lookup: dict[int, dict[str, Any]]) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    total_reports = 0
    degraded_count = 0
    for artifact in artifacts:
        metadata = _metadata(artifact)
        reports = _context_reports_from_artifact(artifact, metadata, runtime_root)
        for report in reports:
            total_reports += 1
            degraded = report.get("context_degraded") is True or bool(report.get("dropped_sections"))
            if not degraded:
                continue
            degraded_count += 1
            chapter_id = _int_or_none(report.get("chapter_id")) or artifact.base_chapter_id
            chapter_info = chapter_lookup.get(chapter_id or -1, {})
            records.append(
                {
                    "artifact_id": artifact.id,
                    "base_chapter_id": artifact.base_chapter_id,
                    "chapter_id": chapter_id,
                    "chapter_no": chapter_info.get("chapter_no"),
                    "chapter_title": chapter_info.get("title"),
                    "task_type": report.get("task_type") or metadata.get("task_type") or artifact.kind,
                    "budget": report.get("budget"),
                    "input_chars": report.get("input_chars"),
                    "selected_sections": _section_summary(report.get("selected_sections")),
                    "dropped_sections": _section_summary(report.get("dropped_sections")),
                    "reason": "超过本次 AI 输入预算，系统按优先级移除了低优先级上下文片段",
                    "created_at": artifact.created_at.isoformat() if artifact.created_at else None,
                }
            )
    records.sort(key=lambda item: (item.get("created_at") or "", item["artifact_id"]), reverse=True)
    return {
        "context_reports": total_reports,
        "degraded_count": degraded_count,
        "affected_chapters": records[:20],
    }


def _recommendations_data(review_metrics: dict[str, Any], artifact_metrics: dict[str, Any]) -> list[str]:
    recommendations = [
        "路由调整必须依赖足够样本；单次探测成功不等于岗位适配。",
        "本地 token/usage 是日志可见下限，真实消耗以供应商控制台为准。",
    ]
    if review_metrics["no_evidence_issue_count"]:
        recommendations.append("存在无证据问题，自动修复链路应继续转人工/admin，不进入 fixer。")
    if review_metrics["parse_failed"]:
        recommendations.append("存在审核 JSON 解析失败，应优先收紧 reviewer 提示词和结构化输出约束。")
    if artifact_metrics["context_degraded"]:
        recommendations.append("存在上下文裁剪记录，扩大生产批次前应检查被裁剪片段是否影响当前章节。")
    return recommendations


def _review_metrics(reviews: list[Review], artifacts: list[Artifact]) -> dict[str, Any]:
    issue_count = 0
    evidence_issue_count = 0
    no_evidence_issue_count = 0
    owner_counts: Counter[str] = Counter()
    severity_counts: Counter[str] = Counter()
    source_counts: Counter[str] = Counter()
    review_by_artifact: dict[int, list[Review]] = defaultdict(list)
    for review in reviews:
        review_by_artifact[review.artifact_id].append(review)
        issues = _loads_json(review.issues_json, [])
        for issue in issues:
            if not isinstance(issue, dict):
                continue
            issue_count += 1
            evidence = str(issue.get("evidence", "")).strip()
            if _has_evidence(evidence):
                evidence_issue_count += 1
            else:
                no_evidence_issue_count += 1
            owner_counts[str(issue.get("owner") or "unknown")] += 1
            severity_counts[str(issue.get("severity") or "unknown")] += 1
            source_counts[str(issue.get("source") or "model_review")] += 1

    parse_failed = sum(1 for artifact in artifacts if artifact.kind == "review" and _metadata(artifact).get("parse_failed") is True)
    fix_artifacts = [artifact for artifact in artifacts if _metadata(artifact).get("task_type") == "fix_chapter_candidate"]
    fixed_reviewed = 0
    fixed_passed = 0
    for artifact in fix_artifacts:
        artifact_reviews = review_by_artifact.get(artifact.id, [])
        if artifact_reviews:
            fixed_reviewed += 1
            fixed_passed += int(artifact_reviews[-1].passed)

    return {
        "total": len(reviews),
        "passed": sum(1 for review in reviews if review.passed),
        "manual_required": sum(1 for review in reviews if review.manual_required),
        "issue_count": issue_count,
        "evidence_issue_count": evidence_issue_count,
        "no_evidence_issue_count": no_evidence_issue_count,
        "owner_counts": owner_counts,
        "severity_counts": severity_counts,
        "source_counts": source_counts,
        "parse_failed": parse_failed,
        "fixed_reviewed": fixed_reviewed,
        "fixed_passed": fixed_passed,
    }


def _artifact_metrics(artifacts: list[Artifact]) -> dict[str, Any]:
    by_route: dict[tuple[str, str, str], dict[str, Any]] = defaultdict(
        lambda: {
            "artifacts": 0,
            "kinds": Counter(),
            "task_types": Counter(),
            "context_reports": 0,
            "context_degraded": 0,
            "context_input_chars": 0,
            "dropped_sections": 0,
        }
    )
    global_context_reports = 0
    global_context_degraded = 0
    for artifact in artifacts:
        metadata = _metadata(artifact)
        context_report = metadata.get("context_report") if isinstance(metadata.get("context_report"), dict) else None
        role = str(metadata.get("role") or metadata.get("task_type") or artifact.kind)
        provider = str(metadata.get("provider") or "-")
        model = str(metadata.get("model") or "-")
        bucket = by_route[(role, provider, model)]
        bucket["artifacts"] += 1
        bucket["kinds"][artifact.kind] += 1
        bucket["task_types"][str(metadata.get("task_type") or "-")] += 1

        has_report = False
        degraded = metadata.get("context_degraded") is True
        if context_report is not None:
            has_report = True
            degraded = degraded or context_report.get("context_degraded") is True
            bucket["context_reports"] += 1
            bucket["context_input_chars"] += int(_number(context_report.get("input_chars")) or 0)
            dropped = context_report.get("dropped_sections")
            bucket["dropped_sections"] += len(dropped) if isinstance(dropped, list) else 0
        elif artifact.kind == "context_report":
            has_report = True
            degraded = degraded or metadata.get("context_degraded") is True
            bucket["context_reports"] += 1

        if has_report:
            global_context_reports += 1
        if degraded:
            bucket["context_degraded"] += 1
            global_context_degraded += 1

    return {
        "by_route": by_route,
        "context_reports": global_context_reports,
        "context_degraded": global_context_degraded,
    }


def _publish_metrics(decisions: list[PublishDecision]) -> dict[str, int]:
    return {
        "total": len(decisions),
        "published": sum(1 for decision in decisions if decision.published_at is not None),
        "forced": sum(1 for decision in decisions if decision.force),
        "user_approved": sum(1 for decision in decisions if decision.approved_by_user),
    }


def _review_section(metrics: dict[str, Any]) -> list[str]:
    total = metrics["total"]
    issue_count = metrics["issue_count"]
    lines = [
        "",
        "## 审核质量指标",
        "",
        "| Metric | Value |",
        "|---|---:|",
        f"| Reviews | {total} |",
        f"| Passed | {metrics['passed']} ({_pct(metrics['passed'], total)}) |",
        f"| Manual Required | {metrics['manual_required']} |",
        f"| Issues | {issue_count} |",
        f"| Evidence Issue Rate | {_pct(metrics['evidence_issue_count'], issue_count)} |",
        f"| No Evidence Issues | {metrics['no_evidence_issue_count']} |",
        f"| Local Rule Issues | {metrics['source_counts'].get('local_rule', 0)} |",
        f"| Review JSON Parse Failed | {metrics['parse_failed']} |",
        f"| Fixed Candidate Re-review Pass Rate | {_pct(metrics['fixed_passed'], metrics['fixed_reviewed'])} |",
        "",
        "### Issue Owner",
        "",
        "| Owner | Count |",
        "|---|---:|",
    ]
    for owner, count in sorted(metrics["owner_counts"].items()):
        lines.append(f"| {owner} | {count} |")
    if not metrics["owner_counts"]:
        lines.append("| 无问题 | 0 |")
    lines.extend(["", "### Issue Severity", "", "| Severity | Count |", "|---|---:|"])
    for severity, count in sorted(metrics["severity_counts"].items()):
        lines.append(f"| {severity} | {count} |")
    if not metrics["severity_counts"]:
        lines.append("| 无问题 | 0 |")
    return lines


def _artifact_section(metrics: dict[str, Any]) -> list[str]:
    lines = [
        "",
        "## 产物与上下文预算",
        "",
        f"- Context reports: {metrics['context_reports']}",
        f"- Context degraded: {metrics['context_degraded']}",
        "",
        "| Role/Task | Provider | Model | Artifacts | Kinds | Task Types | Context Reports | Context Degraded | Avg Context Chars | Dropped Sections |",
        "|---|---|---|---:|---|---|---:|---:|---:|---:|",
    ]
    by_route = metrics["by_route"]
    for (role, provider, model), bucket in sorted(by_route.items()):
        reports = bucket["context_reports"]
        kinds = ", ".join(f"{name}:{count}" for name, count in bucket["kinds"].most_common()) or "-"
        task_types = ", ".join(f"{name}:{count}" for name, count in bucket["task_types"].most_common()) or "-"
        lines.append(
            "| "
            + " | ".join(
                [
                    role,
                    provider,
                    model,
                    str(bucket["artifacts"]),
                    kinds,
                    task_types,
                    str(reports),
                    str(bucket["context_degraded"]),
                    f"{(bucket['context_input_chars'] / reports) if reports else 0:.1f}",
                    str(bucket["dropped_sections"]),
                ]
            )
            + " |"
        )
    if not by_route:
        lines.append("| 无产物 | - | - | 0 | - | - | 0 | 0 | 0 | 0 |")
    return lines


def _publish_section(metrics: dict[str, int]) -> list[str]:
    return [
        "",
        "## 发布门",
        "",
        "| Metric | Value |",
        "|---|---:|",
        f"| Publish Decisions | {metrics['total']} |",
        f"| Published | {metrics['published']} |",
        f"| User Approved | {metrics['user_approved']} |",
        f"| Forced | {metrics['forced']} |",
    ]


def _error_section(by_route: dict[tuple[str, str, str], dict[str, Any]]) -> list[str]:
    errors = []
    for (role, provider, model), bucket in sorted(by_route.items()):
        for error, count in bucket["errors"].most_common(5):
            errors.append((role, provider, model, error, count))
    lines = ["", "## 主要错误", "", "| Role | Provider | Model | Error | Count |", "|---|---|---|---|---:|"]
    for role, provider, model, error, count in errors:
        lines.append(f"| {role} | {provider} | {model} | {error.replace('|', '/')} | {count} |")
    if not errors:
        lines.append("| 无 | - | - | - | 0 |")
    return lines


def _recommendation_section(review_metrics: dict[str, Any], artifact_metrics: dict[str, Any]) -> list[str]:
    lines = [
        "",
        "## 判读提示",
        "",
        "- 路由调整必须依赖足够样本；单次探测成功不等于岗位适配。",
        "- reviewer 若无证据问题或 JSON 解析失败偏高，应优先收紧提示词和 JSON 输出约束，而不是直接换模型。",
        "- context_degraded 偏高表示输入预算不足或上下文选择过宽，应先压缩记忆切片。",
        "- 本地日志 token/usage 是可见下限，真实消耗以供应商控制台为准。",
    ]
    if review_metrics["no_evidence_issue_count"]:
        lines.append("- 当前存在无证据问题，自动修复链路应继续转人工/admin，不能进入 fixer。")
    if artifact_metrics["context_degraded"]:
        lines.append("- 当前存在上下文降级记录，建议检查对应 context_report artifact 后再扩大生产批次。")
    return lines


def _metadata(artifact: Artifact) -> dict[str, Any]:
    return _loads_json(artifact.metadata_json, {})


def _default_runtime_root() -> Path:
    try:
        return workspace_runtime_root()
    except Exception:
        return Path("runtime")


def _artifact_chinese_count(artifact: Artifact, runtime_root: Path) -> int | None:
    path = _safe_artifact_path(runtime_root, artifact.path)
    if path is None or not path.exists() or not path.is_file():
        return None
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    return count_chinese_chars(text)


def _context_reports_from_artifact(artifact: Artifact, metadata: dict[str, Any], runtime_root: Path) -> list[dict[str, Any]]:
    reports: list[dict[str, Any]] = []
    inline_report = metadata.get("context_report")
    if isinstance(inline_report, dict):
        reports.append(inline_report)
    if artifact.kind == "context_report":
        path = _safe_artifact_path(runtime_root, artifact.path)
        if path is not None and path.exists() and path.is_file():
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                payload = None
            if isinstance(payload, dict):
                reports.append(payload)
        elif metadata.get("context_degraded") is True:
            reports.append(metadata)
    return reports


def _safe_artifact_path(runtime_root: Path, relative_path: str) -> Path | None:
    root = runtime_root.resolve()
    try:
        path = (root / relative_path).resolve()
    except OSError:
        return None
    if path == root or root in path.parents:
        return path
    return None


def _section_summary(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    sections: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        sections.append(
            {
                "name": str(item.get("name") or "unknown"),
                "chars": int(_number(item.get("chars")) or 0),
            }
        )
    return sections


def _int_or_none(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _loads_json(raw: str | None, fallback: Any) -> Any:
    try:
        payload = json.loads(raw or "")
    except (TypeError, json.JSONDecodeError):
        return fallback
    if isinstance(fallback, dict):
        return payload if isinstance(payload, dict) else fallback
    if isinstance(fallback, list):
        return payload if isinstance(payload, list) else fallback
    return payload


def _number(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _estimated_million_tokens(call: ModelCall, total_tokens: float | None) -> float:
    if call.cost_estimate is not None:
        return float(call.cost_estimate)
    if total_tokens is not None:
        return total_tokens / 1_000_000
    return 0.0


def _sanitize_error(error: str, *, limit: int = 180) -> str:
    text = error.split("; call_id=", 1)[0]
    text = re.sub(r"Bearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [REDACTED]", text)
    text = re.sub(r"sk-[A-Za-z0-9_-]{8,}", "sk-[REDACTED]", text)
    text = re.sub(r"[A-Za-z0-9]{24,}\.[A-Za-z0-9._-]{8,}", "[REDACTED]", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > limit:
        return text[: limit - 3] + "..."
    return text


def _has_evidence(evidence: str) -> bool:
    if not evidence:
        return False
    return evidence.strip() != "无法确认：缺少证据"


def _pct(part: int | float, whole: int | float) -> str:
    if not whole:
        return "0%"
    return f"{(float(part) / float(whole) * 100):.1f}%"


def _ratio(part: int | float, whole: int | float) -> float:
    if not whole:
        return 0.0
    return float(part) / float(whole)


if __name__ == "__main__":
    raise SystemExit(main())
