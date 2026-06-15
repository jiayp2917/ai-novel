import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.config import get_settings
from backend.app.db.base import Base
from backend.app.db.models import Artifact, Chapter, ChapterVersion, Job, ModelCall, PublishDecision, Review, SourceFile
from backend.app.db.session import get_engine, reset_engine
from backend.app.main import app
from backend.app.repositories import Repository
from backend.app.services.artifacts import ArtifactStore
from backend.app.services.pipeline.findings import MISSING_EVIDENCE_PREFIX
from backend.app.services.pipeline.fixer import FixerService
from backend.app.services.pipeline.executor import PipelineTaskExecutor
from backend.app.services.pipeline.runs import DIRECT_PUBLISH_ERROR, PipelineRunError, PipelineRunService
from backend.app.services.pipeline.state_machine import PipelineState, PipelineStateMachine
from backend.app.services.worker import JobWorker

class UnexpectedQuickFixModel:
    def chat(self, **kwargs):
        raise AssertionError("quick_fix should not be called for issues that lack evidence or fix instructions")

def setup_app_db(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("CONTENT_ROOT", str(tmp_path / "content"))
    monkeypatch.setenv("RUNTIME_ROOT", str(tmp_path / "runtime"))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(tmp_path / "runtime"))
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())
def test_pipeline_run_api_rejects_direct_publish_without_advanced_flag(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    monkeypatch.delenv("ALLOW_PIPELINE_DIRECT_PUBLISH", raising=False)
    monkeypatch.delenv("ENABLE_TEST_SUPPORT", raising=False)
    get_settings.cache_clear()
    client = TestClient(app)

    response = client.post(
        "/api/pipeline/runs",
        json={"start_chapter": 1, "end_chapter": 1, "mode": "full_auto", "dry_run": False},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "自动流水线当前只允许预演，不直接写回正文。请到 AI 工作台确认写回。"
    get_settings.cache_clear()
    reset_engine()

def test_pipeline_run_api_allows_direct_publish_with_advanced_flag(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    monkeypatch.setenv("ALLOW_PIPELINE_DIRECT_PUBLISH", "true")
    get_settings.cache_clear()
    client = TestClient(app)

    response = client.post(
        "/api/pipeline/runs",
        json={"start_chapter": 1, "end_chapter": 1, "mode": "full_auto", "dry_run": False},
    )

    assert response.status_code == 200
    assert response.json()["payload"]["dry_run"] is False
    get_settings.cache_clear()
    reset_engine()

def test_pipeline_run_service_rejects_direct_publish_without_advanced_flag(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    monkeypatch.delenv("ALLOW_PIPELINE_DIRECT_PUBLISH", raising=False)
    monkeypatch.delenv("ENABLE_TEST_SUPPORT", raising=False)
    get_settings.cache_clear()

    with Session(get_engine()) as session:
        with pytest.raises(PipelineRunError, match=DIRECT_PUBLISH_ERROR):
            PipelineRunService(session).create_run(
                start_chapter=1,
                end_chapter=1,
                mode="full_auto",
                dry_run=False,
            )

    get_settings.cache_clear()
    reset_engine()

def test_pipeline_executor_blocks_non_dry_run_publish_without_advanced_flag(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    monkeypatch.delenv("ALLOW_PIPELINE_DIRECT_PUBLISH", raising=False)
    monkeypatch.delenv("ENABLE_TEST_SUPPORT", raising=False)
    get_settings.cache_clear()
    chapter_text = "# 第001章 First\nBody."
    chapter_file = tmp_path / "content" / "chapters" / "book.md"
    chapter_file.parent.mkdir(parents=True, exist_ok=True)
    chapter_file.write_text(chapter_text, encoding="utf-8")

    with Session(get_engine()) as session:
        source = Repository(session, SourceFile).create(
            {
                "path": "chapters/book.md",
                "kind": "chapters",
                "sha256": "source-hash",
                "mtime": 1.0,
                "size": len(chapter_text),
                "active": True,
            }
        )
        chapter = Repository(session, Chapter).create(
            {
                "chapter_no": 1,
                "title": "First",
                "source_file_id": source.id,
                "range_start": 0,
                "range_end": len(chapter_text),
                "active": True,
            }
        )
        version = ChapterVersion(
            chapter_id=chapter.id,
            source_file_id=source.id,
            body_hash="b" * 64,
            source_file_hash=source.sha256,
            title=chapter.title,
            range_start=chapter.range_start,
            range_end=chapter.range_end,
        )
        session.add(version)
        session.flush()
        chapter.current_version_id = version.id
        artifact = ArtifactStore(session).save_text(
            kind="candidate",
            text="# 第001章 First\nChanged body.",
            metadata={"task_type": "pipeline_publish_guard"},
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
        job = Repository(session, Job).create(
            {
                "type": "publish_chapter_candidate",
                "status": "running",
                "payload_json": json.dumps({"chapter_no": 1, "artifact_id": artifact.id, "dry_run": False}, ensure_ascii=False),
                "locked_chapter_id": chapter.id,
                "locked_source_file_id": source.id,
            }
        )
        session.commit()

        result = PipelineTaskExecutor(session).run_job(job.id)

        assert result["manual_required"] is True
        assert result["published"] is False
        stored = session.get(Job, job.id)
        assert stored is not None
        assert stored.status == "manual_required"
        assert stored.error == DIRECT_PUBLISH_ERROR
        assert session.scalar(select(PublishDecision)) is None
        assert chapter_file.read_text(encoding="utf-8") == chapter_text

    get_settings.cache_clear()
    reset_engine()

def test_final_review_writer_issues_stop_before_publish(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    chapter_text = "# 第001章 First\nBody."
    chapter_file = tmp_path / "content" / "chapters" / "book.md"
    chapter_file.parent.mkdir(parents=True, exist_ok=True)
    chapter_file.write_text(chapter_text, encoding="utf-8")

    class WriterIssueReviewer:
        def __init__(self, session):
            self.session = session

        def review_candidate(self, artifact_id):
            return {
                "artifact_id": artifact_id,
                "review_id": 99,
                "passed": False,
                "manual_required": False,
                "model_call_id": 100,
                "issues": [
                    {
                        "owner": "writer",
                        "severity": "medium",
                        "evidence": "Body.",
                        "fix_instruction": "expand",
                    }
                ],
            }

    monkeypatch.setattr("backend.app.services.pipeline.executor.ReviewerService", WriterIssueReviewer)

    with Session(get_engine()) as session:
        source = Repository(session, SourceFile).create(
            {
                "path": "chapters/book.md",
                "kind": "chapters",
                "sha256": "source-hash",
                "mtime": 1.0,
                "size": len(chapter_text),
                "active": True,
            }
        )
        chapter = Repository(session, Chapter).create(
            {
                "chapter_no": 1,
                "title": "First",
                "source_file_id": source.id,
                "range_start": 0,
                "range_end": len(chapter_text),
                "active": True,
            }
        )
        artifact = ArtifactStore(session).save_text(
            kind="candidate",
            text=chapter_text,
            metadata={},
            base_chapter=chapter,
        )
        run = PipelineRunService(session).create_run(
            start_chapter=1,
            end_chapter=1,
            mode="full_auto",
            dry_run=True,
        )
        final_review = run["child_tasks"][3]
        review_job = session.get(Job, final_review["id"])
        assert review_job is not None
        review_job.status = "running"
        review_job.payload_json = json.dumps(
            {**json.loads(review_job.payload_json), "artifact_id": artifact.id},
            ensure_ascii=False,
        )
        session.commit()

        PipelineTaskExecutor(session).run_job(review_job.id)

        refreshed = PipelineRunService(session).get_run(run["id"])
        final_review_after = next(task for task in refreshed["child_tasks"] if task["id"] == review_job.id)
        publish_after = next(task for task in refreshed["child_tasks"] if task["type"] == "publish_chapter_candidate")
        assert final_review_after["status"] == "manual_required"
        assert final_review_after["error"] == "Review did not pass"
        assert publish_after["status"] == "manual_required"
        assert publish_after["error"] == f"Dependency requires manual handling: {review_job.id}"
    get_settings.cache_clear()
    reset_engine()
