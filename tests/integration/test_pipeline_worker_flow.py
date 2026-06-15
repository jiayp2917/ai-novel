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
def test_review_task_prepares_snapshot_without_exception_control_flow(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
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
        job = Repository(session, Job).create(
            {
                "type": "review_chapter_candidate",
                "status": "running",
                "payload_json": json.dumps({"chapter_no": 1}, ensure_ascii=False),
                "locked_chapter_id": chapter.id,
                "locked_source_file_id": source.id,
            }
        )
        session.commit()

        result = PipelineTaskExecutor(session).run_job(job.id)

        stored = session.get(Job, job.id)
        assert result["status"] == "artifact_prepared"
        assert isinstance(result["artifact_id"], int)
        assert stored is not None
        assert stored.status == "queued"
        assert json.loads(stored.payload_json)["artifact_id"] == result["artifact_id"]
        assert json.loads(stored.result_json)["artifact_id"] == result["artifact_id"]

    get_settings.cache_clear()
    reset_engine()

def test_worker_queues_pipeline_children_without_running_model_calls(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    client = TestClient(app)
    created = client.post(
        "/api/pipeline/runs",
        json={"start_chapter": 1, "end_chapter": 2, "mode": "review_only"},
    )
    run_id = created.json()["id"]

    with Session(get_engine()) as session:
        result = JobWorker(session).run_once(limit=10)
        run = session.get(Job, run_id)
        assert run is not None
        assert result["started"] == 1
        assert run.status == "context_built"
        child_tasks = [job for job in session.query(Job).filter(Job.type != "pipeline_run").all()]
        assert child_tasks
        assert all(job.status == "queued" for job in child_tasks)
    get_settings.cache_clear()
    reset_engine()

def test_worker_runs_review_only_child_from_snapshot_candidate(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    chapter_file = tmp_path / "content" / "chapters" / "book.md"
    chapter_file.parent.mkdir(parents=True, exist_ok=True)
    chapter_text = "# 第001章 起步\n" + ("许满在操场边完成基础训练。" * 120)
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
                "title": "起步",
                "source_file_id": source.id,
                "range_start": 0,
                "range_end": len(chapter_text),
                "active": True,
            }
        )
        session.commit()
        run = PipelineRunService(session).create_run(
            start_chapter=1,
            end_chapter=1,
            mode="review_only",
            dry_run=True,
        )
        child_id = run["child_tasks"][0]["id"]

        queued = JobWorker(session).run_once(limit=10)
        assert queued["started"] == 1
        child = session.get(Job, child_id)
        assert child is not None
        assert child.status == "queued"
        assert "artifact_id" not in child.payload_json

        executed = JobWorker(session).run_once(limit=1)
        assert executed["started"] == 1
        child = session.get(Job, child_id)
        assert child is not None
        assert child.status == "manual_required"
        assert child.error and "Chapter has no current version" in child.error
        assert session.scalar(select(Artifact)) is None
    get_settings.cache_clear()
    reset_engine()

def test_fixer_requires_writer_issue_evidence_and_instruction(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    chapter_file = tmp_path / "content" / "chapters" / "book.md"
    chapter_text = "# 绗?01绔?璧锋\n正文。"
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
                "title": "璧锋",
                "source_file_id": source.id,
                "range_start": 0,
                "range_end": len(chapter_text),
                "active": True,
            }
        )
        artifact = ArtifactStore(session).save_text(
            kind="candidate",
            text=chapter_text,
            metadata={"task_type": "generate_chapter_draft"},
            base_chapter=chapter,
        )
        review = Review(
            artifact_id=artifact.id,
            passed=False,
            issues_json=json.dumps(
                [
                    {
                        "chapter": 1,
                        "severity": "medium",
                        "type": "style",
                        "description": "缺少证据的作者问题",
                        "evidence": "",
                        "owner": "writer",
                        "fix_instruction": "修正节奏",
                    }
                ],
                ensure_ascii=False,
            ),
            evidence_count=0,
            manual_required=False,
            candidate_hash=artifact.sha256,
            base_source_file_hash=artifact.base_source_file_hash,
            base_chapter_version_id=artifact.base_chapter_version_id,
        )
        session.add(review)
        session.commit()

        result = FixerService(session, model_client=UnexpectedQuickFixModel()).fix_candidate(artifact.id, review_id=review.id)

        assert result["status"] == "manual_required"
        assert result["artifact_id"] == artifact.id
        assert result["review_id"] == review.id
        assert result["issues"][0]["owner"] == "admin"
        assert result["issues"][0]["severity"] == "blocking"
        assert result["issues"][0]["evidence"] == MISSING_EVIDENCE_PREFIX
        assert result["issues"][0]["authorized_for_fixer"] is False
        assert session.scalar(select(Artifact).where(Artifact.id != artifact.id)) is None
    get_settings.cache_clear()
    reset_engine()

def test_pipeline_run_full_auto_expands_generation_review_fix_and_summary(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    client = TestClient(app)

    created = client.post(
        "/api/pipeline/runs",
        json={
            "start_chapter": 1,
            "end_chapter": 2,
            "mode": "full_auto",
            "chunk_size": 1,
            "max_fix_rounds": 2,
            "dry_run": True,
        },
    )

    assert created.status_code == 200
    run = created.json()
    assert len(run["child_tasks"]) == 12
    assert [task["type"] for task in run["child_tasks"][:6]] == [
        "generate_chapter_draft",
        "review_chapter_candidate",
        "fix_chapter_candidate",
        "review_chapter_candidate",
        "publish_chapter_candidate",
        "summarize_published_chapter",
    ]
    assert run["child_tasks"][1]["payload"]["depends_on_job_id"] == run["child_tasks"][0]["id"]
    assert run["child_tasks"][4]["payload"]["depends_on_job_id"] == run["child_tasks"][3]["id"]
    assert all(task["payload"]["parent_run_id"] == run["id"] for task in run["child_tasks"])
    get_settings.cache_clear()
    reset_engine()

def test_pipeline_run_marks_downstream_manual_when_dependency_needs_manual(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    with Session(get_engine()) as session:
        run = PipelineRunService(session).create_run(
            start_chapter=1,
            end_chapter=1,
            mode="full_auto",
            dry_run=True,
        )
        generate_task = next(task for task in run["child_tasks"] if task["type"] == "generate_chapter_draft")
        generate_job = session.get(Job, generate_task["id"])
        assert generate_job is not None
        PipelineStateMachine(session).transition(generate_job, PipelineState.QUEUED)
        generate_job.status = "running"
        session.commit()
        PipelineStateMachine(session).transition(generate_job, PipelineState.DONE)
        review_task = next(task for task in run["child_tasks"] if task["type"] == "review_chapter_candidate")
        review_job = session.get(Job, review_task["id"])
        assert review_job is not None
        PipelineStateMachine(session).transition(review_job, PipelineState.MANUAL_REQUIRED, error="manual review stop")

        refreshed = PipelineRunService(session).refresh_run_status(run["id"])

        assert refreshed.status == "manual_required"
        result = json.loads(refreshed.result_json or "{}")
        assert result["child_status_counts"]["manual_required"] >= 1
    get_settings.cache_clear()
    reset_engine()

def test_pipeline_executor_refreshes_parent_after_child_failure(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    with Session(get_engine()) as session:
        run = PipelineRunService(session).create_run(
            start_chapter=1,
            end_chapter=1,
            mode="full_auto",
            dry_run=True,
        )
        generate_task = next(task for task in run["child_tasks"] if task["type"] == "generate_chapter_draft")
        generate_job = session.get(Job, generate_task["id"])
        assert generate_job is not None
        PipelineStateMachine(session).transition(generate_job, PipelineState.QUEUED)
        generate_job.status = "running"
        session.commit()

        with pytest.raises(Exception, match="Chapter not found"):
            PipelineTaskExecutor(session).run_job(generate_job.id)

        refreshed = PipelineRunService(session).get_run(run["id"])
        assert refreshed["status"] == "manual_required"
        statuses = {task["type"]: task["status"] for task in refreshed["child_tasks"]}
        assert statuses["generate_chapter_draft"] == "manual_required"
        assert all(
            task["status"] == "manual_required"
            for task in refreshed["child_tasks"]
            if task["type"] != "generate_chapter_draft"
        )
        result = session.get(Job, run["id"])
        assert result is not None
        payload = json.loads(result.result_json or "{}")
        assert payload["child_status_counts"]["manual_required"] == 6
    get_settings.cache_clear()
    reset_engine()
