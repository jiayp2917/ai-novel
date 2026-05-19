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
    reviews = reviews or []
    artifacts = artifacts or []
    decisions = decisions or []
    by_route = _model_call_buckets(calls)
    artifact_metrics = _artifact_metrics(artifacts)
    review_metrics = _review_metrics(reviews, artifacts)
    publish_metrics = _publish_metrics(decisions)
    job_counts = Counter(job.status for job in jobs)

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


if __name__ == "__main__":
    raise SystemExit(main())
