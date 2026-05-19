from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select

from backend.app.db.models import Artifact, Chapter, ModelCall, Review
from backend.app.db.session import get_session_local
from backend.app.services.workspace import WorkspaceResolver


def main() -> int:
    parser = argparse.ArgumentParser(description="Render a front-end formal test report for selected chapters.")
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--end", type=int, default=10)
    parser.add_argument("--before-hashes", default="")
    parser.add_argument("--min-model-call-id", type=int, default=0)
    parser.add_argument("--out", default=str(Path.home() / "Desktop" / "小说编辑器前端正式测试报告.md"))
    args = parser.parse_args()

    before_hashes = _load_before_hashes(args.before_hashes)
    with get_session_local()() as session:
        chapters = list(
            session.scalars(
                select(Chapter)
                .where(Chapter.chapter_no >= args.start, Chapter.chapter_no <= args.end)
                .order_by(Chapter.chapter_no)
            )
        )
        rows: list[dict[str, Any]] = []
        for chapter in chapters:
            artifacts = list(
                session.scalars(
                    select(Artifact)
                    .where(Artifact.base_chapter_id == chapter.id, Artifact.kind == "candidate")
                    .order_by(Artifact.created_at.desc(), Artifact.id.desc())
                )
            )
            formal_artifacts = [
                artifact
                for artifact in artifacts
                if _metadata(artifact).get("purpose") == "front_end_formal_review_snapshot"
            ]
            artifact = formal_artifacts[0] if formal_artifacts else (artifacts[0] if artifacts else None)
            review = None
            if artifact is not None:
                review = session.scalar(select(Review).where(Review.artifact_id == artifact.id).order_by(Review.id.desc()))
            path = WorkspaceResolver().resolve_source_path(chapter.source_file.path)
            current_hash = _file_hash(path)
            before_hash = before_hashes.get(str(chapter.chapter_no))
            issues = _issues(review)
            rows.append(
                {
                    "chapter_no": chapter.chapter_no,
                    "title": chapter.title,
                    "source_path": chapter.source_file.path,
                    "source_hash_unchanged": before_hash is None or before_hash == current_hash,
                    "artifact_id": artifact.id if artifact is not None else None,
                    "review_id": review.id if review is not None else None,
                    "passed": review.passed if review is not None else None,
                    "manual_required": review.manual_required if review is not None else None,
                    "issue_count": len(issues),
                    "no_evidence_count": sum(1 for issue in issues if not str(issue.get("evidence", "")).strip()),
                    "owners": dict(Counter(str(issue.get("owner", "unknown")) for issue in issues)),
                    "severities": dict(Counter(str(issue.get("severity", "unknown")) for issue in issues)),
                }
            )

        call_query = select(ModelCall).order_by(ModelCall.created_at, ModelCall.id)
        if args.min_model_call_id:
            call_query = call_query.where(ModelCall.id >= args.min_model_call_id)
        calls = list(session.scalars(call_query))

    report = _render(args.start, args.end, rows, calls)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(report, encoding="utf-8")
    print(out)
    return 0


def _metadata(artifact: Artifact) -> dict[str, Any]:
    try:
        data = json.loads(artifact.metadata_json or "{}")
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _issues(review: Review | None) -> list[dict[str, Any]]:
    if review is None:
        return []
    try:
        data = json.loads(review.issues_json or "[]")
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def _file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_before_hashes(path: str) -> dict[str, str]:
    if not path:
        return {}
    p = Path(path)
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    hashes: dict[str, str] = {}
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and "chapter" in item and "sha256" in item:
                hashes[str(item["chapter"])] = str(item["sha256"])
    return hashes


def _render(start: int, end: int, rows: list[dict[str, Any]], calls: list[ModelCall]) -> str:
    route_counter = Counter((call.role, call.provider, call.model, call.status) for call in calls)
    lines = [
        f"# 小说编辑器前端正式测试报告（第 {start}-{end} 章）",
        "",
        f"生成时间：{datetime.now(UTC).isoformat()}",
        "",
        "## 结论",
        "",
        f"- 覆盖章节：{len(rows)}",
        f"- 已生成候选：{sum(1 for row in rows if row['artifact_id'])}",
        f"- 已审核：{sum(1 for row in rows if row['review_id'])}",
        f"- 审核通过：{sum(1 for row in rows if row['passed'] is True)}",
        f"- 需要人工：{sum(1 for row in rows if row['manual_required'] is True)}",
        f"- 源正文 hash 未变化：{sum(1 for row in rows if row['source_hash_unchanged'])}/{len(rows)}",
        "",
        "> token/usage 为本地日志可见下限，真实消耗以供应商控制台为准。",
        "",
        "## 章节结果",
        "",
        "| 章 | 标题 | 源文件未改 | 候选 | 审核 | 通过 | 人工 | 问题 | 无证据 | owner | severity |",
        "|---:|---|---|---:|---:|---|---|---:|---:|---|---|",
    ]
    for row in rows:
        lines.append(
            "| "
            + " | ".join(
                [
                    str(row["chapter_no"]),
                    str(row["title"]).replace("|", "/"),
                    "是" if row["source_hash_unchanged"] else "否",
                    str(row["artifact_id"] or ""),
                    str(row["review_id"] or ""),
                    _yes_no(row["passed"]),
                    _yes_no(row["manual_required"]),
                    str(row["issue_count"]),
                    str(row["no_evidence_count"]),
                    json.dumps(row["owners"], ensure_ascii=False),
                    json.dumps(row["severities"], ensure_ascii=False),
                ]
            )
            + " |"
        )

    lines.extend(
        [
            "",
            "## 模型调用汇总",
            "",
            "| Role | Provider | Model | Status | Calls |",
            "|---|---|---|---|---:|",
        ]
    )
    for (role, provider, model, status), count in sorted(route_counter.items()):
        lines.append(f"| {role} | {provider} | {model} | {status} | {count} |")
    if not route_counter:
        lines.append("| 无 | - | - | - | 0 |")
    return "\n".join(lines) + "\n"


def _yes_no(value: Any) -> str:
    if value is True:
        return "是"
    if value is False:
        return "否"
    return ""


if __name__ == "__main__":
    raise SystemExit(main())
