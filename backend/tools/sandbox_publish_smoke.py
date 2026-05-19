from __future__ import annotations

import argparse
import json
from pathlib import Path

from sqlalchemy import select

from backend.app.db.models import Chapter, PublishDecision, Review
from backend.app.db.session import get_session_local
from backend.app.services.artifacts import ArtifactStore
from backend.app.services.library import LibraryScanner
from backend.app.services.memory import MemoryService
from backend.app.services.review_publish import ReviewPublishService
from backend.app.services.workspace import WorkspaceResolver, set_active_workspace, workspace_runtime_root


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a sandbox publish smoke test without calling a real reviewer model.")
    parser.add_argument("--workspace", default="runtime/sandbox_workspace")
    parser.add_argument("--chapter-no", type=int, default=2)
    args = parser.parse_args()

    set_active_workspace(Path(args.workspace))
    with get_session_local()() as session:
        scan = LibraryScanner(session).scan()
        memory = MemoryService(session).rebuild()
        chapter = session.scalar(select(Chapter).where(Chapter.chapter_no == args.chapter_no, Chapter.active.is_(True)))
        if chapter is None:
            raise SystemExit(f"Chapter {args.chapter_no} not found in sandbox.")
        source_path = WorkspaceResolver().resolve_source_path(chapter.source_file.path)
        before = source_path.read_text(encoding="utf-8-sig")
        chapter_text = before[chapter.range_start : chapter.range_end]
        marker = "\n\n<!-- sandbox_publish_smoke -->\n"
        candidate_text = chapter_text if marker in chapter_text else chapter_text.rstrip() + marker
        artifact = ArtifactStore(session).save_text(
            kind="candidate",
            text=candidate_text,
            metadata={"purpose": "sandbox_publish_smoke"},
            base_chapter=chapter,
        )
        session.add(
            Review(
                artifact_id=artifact.id,
                passed=True,
                issues_json="[]",
                evidence_count=0,
                manual_required=False,
                candidate_hash=artifact.sha256,
                base_source_file_hash=artifact.base_source_file_hash,
                base_chapter_version_id=artifact.base_chapter_version_id,
            )
        )
        session.commit()
        diff = ReviewPublishService(session).diff_artifact(artifact.id)
        published = ReviewPublishService(session).publish_artifact(artifact.id, approved_by_user=True)
        decision = session.scalar(select(PublishDecision).where(PublishDecision.artifact_id == artifact.id))
        report = {
            "scan": scan,
            "memory": memory,
            "artifact_id": artifact.id,
            "chapter_id": chapter.id,
            "diff_contains_marker": "sandbox_publish_smoke" in diff["diff"],
            "published": published,
            "publish_decision_exists": decision is not None,
            "source_contains_marker": "sandbox_publish_smoke" in source_path.read_text(encoding="utf-8-sig"),
        }

    out = workspace_runtime_root() / "logs" / "sandbox_publish_smoke.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["published"].get("published") and report["source_contains_marker"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
