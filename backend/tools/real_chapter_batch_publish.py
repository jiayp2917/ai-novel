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
from backend.app.db.models import Artifact, Chapter, ModelCall, PublishDecision, Review
from backend.app.db.session import get_engine, get_session_local, reset_engine
from backend.app.services.library import LibraryScanner
from backend.app.services.memory import MemoryService
from backend.app.services.pipeline.fixer import FixerService
from backend.app.services.pipeline.reviewer import ReviewerService
from backend.app.services.pipeline.writer import WriterService
from backend.app.services.review_publish import ReviewPublishService
from backend.app.services.source_files import SourceFileManager
from backend.app.services.workspace import set_active_workspace, workspace_runtime_root


@dataclass(frozen=True)
class ChapterSeed:
    no: int
    title: str


CHAPTERS_001_005 = (
    ChapterSeed(1, "问灵大考开始"),
    ChapterSeed(2, "下品灵根"),
    ChapterSeed(3, "测试人偶"),
    ChapterSeed(4, "数据不属于它"),
    ChapterSeed(5, "建议练基础"),
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate, review, diff, and publish a small real chapter batch through project services.")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--start-chapter", type=int, default=1)
    parser.add_argument("--end-chapter", type=int, default=5)
    parser.add_argument("--folder", default="01卷")
    parser.add_argument("--create-missing", action="store_true")
    parser.add_argument("--publish", action="store_true")
    parser.add_argument("--force-model", action="store_true")
    parser.add_argument("--app-db-path", default=None)
    args = parser.parse_args()

    workspace = Path(args.workspace).resolve()
    if args.start_chapter != 1 or args.end_chapter != 5:
        raise SystemExit("This controlled tool is currently limited to chapters 001-005.")
    if not args.publish:
        raise SystemExit("Refusing to run without --publish; this tool is for explicit user-authorized publish batches.")

    env = {
        "CONTENT_ROOT": str(workspace),
    }
    if args.app_db_path:
        env["APP_DB_PATH"] = str(Path(args.app_db_path).resolve())

    with temporary_environment(env):
        set_active_workspace(workspace)
        Base.metadata.create_all(get_engine())
        with get_session_local()() as session:
            initial_scan = LibraryScanner(session).scan()
            created = []
            if args.create_missing:
                created = ensure_chapters(session, folder=args.folder)
            scan = LibraryScanner(session).scan()
            MemoryService(session).rebuild()
            results = [run_chapter(session, seed.no, force_model=args.force_model) for seed in CHAPTERS_001_005]
            report = build_report(session, workspace, initial_scan, created, scan, results)
            out_dir = workspace_runtime_root() / "reports"
            out_dir.mkdir(parents=True, exist_ok=True)
            out_path = out_dir / "real_chapter_batch_001_005.json"
            out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 0 if all(item.get("published") for item in results) else 1


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


def ensure_chapters(session, *, folder: str) -> list[dict[str, Any]]:
    manager = SourceFileManager(session)
    created: list[dict[str, Any]] = []
    for seed in CHAPTERS_001_005:
        chapter = session.scalar(select(Chapter).where(Chapter.chapter_no == seed.no, Chapter.active.is_(True)))
        if chapter is not None:
            continue
        source = manager.create_file(
            root_key="chapters",
            folder=folder,
            filename=f"{seed.no:03d}-{seed.title}.md",
            template="chapter",
            title=seed.title,
            chapter_no=seed.no,
            content=f"（第{seed.no:03d}章占位正文，等待 AI 候选通过审核后经发布门写回。）",
        )
        created.append(
            {
                "chapter_no": seed.no,
                "path": source.path,
                "source_file_id": source.source_file_id,
                "chapter_id": source.chapter_id,
            }
        )
    return created


def run_chapter(session, chapter_no: int, *, force_model: bool) -> dict[str, Any]:
    chapter = session.scalar(select(Chapter).where(Chapter.chapter_no == chapter_no, Chapter.active.is_(True)))
    if chapter is None:
        return {"chapter_no": chapter_no, "published": False, "status": "chapter_missing"}
    if chapter.current_version is None:
        return {"chapter_no": chapter_no, "chapter_id": chapter.id, "published": False, "status": "chapter_has_no_current_version"}

    result: dict[str, Any] = {
        "chapter_no": chapter_no,
        "chapter_id": chapter.id,
        "source_file_id": chapter.source_file_id,
        "status": "started",
    }
    try:
        draft = WriterService(session).generate_chapter_draft(chapter.id, force=force_model)
        artifact_id = draft["artifact_id"]
        result.update({"artifact_id": artifact_id, "writer_model_call_id": draft.get("model_call_id")})

        review = ReviewerService(session).review_candidate(artifact_id, force=force_model)
        result.update(
            {
                "review_id": review["review_id"],
                "review_passed": review["passed"],
                "manual_required": review["manual_required"],
                "review_issue_count": len(review["issues"]),
                "review_model_call_id": review.get("model_call_id"),
            }
        )
        publish_artifact_id = artifact_id

        if not review["passed"] and only_writer_issues(review["issues"]):
            fixed = FixerService(session).fix_candidate(artifact_id, review_id=review["review_id"])
            result["fix_status"] = fixed["status"]
            if fixed["status"] == "fixed":
                publish_artifact_id = fixed["artifact_id"]
                result["fixed_artifact_id"] = fixed["artifact_id"]
                rereview = ReviewerService(session).review_candidate(publish_artifact_id, force=force_model)
                result.update(
                    {
                        "review_id": rereview["review_id"],
                        "review_passed": rereview["passed"],
                        "manual_required": rereview["manual_required"],
                        "review_issue_count": len(rereview["issues"]),
                        "rereview_model_call_id": rereview.get("model_call_id"),
                    }
                )
                review = rereview

        if not review["passed"]:
            result["status"] = "review_not_passed"
            result["published"] = False
            return result

        diff = ReviewPublishService(session).write_diff_artifact(publish_artifact_id)
        published = ReviewPublishService(session).publish_artifact(publish_artifact_id, approved_by_user=True)
        result.update(
            {
                "artifact_id": publish_artifact_id,
                "diff_path": diff["path"],
                "diff_chars": len(diff["diff"]),
                "published": bool(published.get("published")),
                "publish_decision_id": published.get("publish_decision_id"),
                "backup_path": published.get("backup_path"),
                "published_diff_path": published.get("diff_path"),
                "status": "published" if published.get("published") else "publish_failed",
            }
        )
        return result
    except Exception as exc:
        session.rollback()
        result.update({"status": "failed", "published": False, "error": str(exc)})
        return result


def only_writer_issues(issues: list[dict[str, Any]]) -> bool:
    return bool(issues) and all(issue.get("owner") == "writer" for issue in issues if isinstance(issue, dict))


def build_report(
    session,
    workspace: Path,
    initial_scan: dict[str, Any],
    created: list[dict[str, Any]],
    scan: dict[str, Any],
    results: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "workspace": str(workspace),
        "runtime_report": str(workspace_runtime_root() / "reports" / "real_chapter_batch_001_005.json"),
        "chapter_range": [1, 5],
        "created_chapter_sources": created,
        "initial_scan": initial_scan,
        "scan_after_binding": scan,
        "results": results,
        "published_count": sum(1 for item in results if item.get("published")),
        "artifact_count": session.query(Artifact).count(),
        "review_count": session.query(Review).count(),
        "model_call_count": session.query(ModelCall).count(),
        "publish_decision_count": session.query(PublishDecision).count(),
    }


if __name__ == "__main__":
    raise SystemExit(main())
