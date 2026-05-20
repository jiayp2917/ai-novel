import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.config import get_settings
from backend.app.db.base import Base
from backend.app.db.models import Artifact, Chapter, Job, SourceFile
from backend.app.db.session import get_engine, reset_engine
from backend.app.main import app
from backend.app.repositories import Repository
from backend.app.services.pipeline.runs import PipelineRunService
from backend.app.services.pipeline.state_machine import PipelineState, PipelineStateMachine
from backend.app.services.worker import JobWorker
from backend.tools.sandbox_pipeline_smoke import main as sandbox_pipeline_main
from backend.tools.sandbox_pipeline_smoke import create_workspace, SmokeError


def setup_app_db(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("CONTENT_ROOT", str(tmp_path / "content"))
    monkeypatch.setenv("RUNTIME_ROOT", str(tmp_path / "runtime"))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(tmp_path / "runtime"))
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())


def test_pipeline_run_api_create_list_pause_resume_cancel(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    client = TestClient(app)

    created = client.post(
        "/api/pipeline/runs",
        json={
            "start_chapter": 1,
            "end_chapter": 3,
            "mode": "review_fix",
            "chunk_size": 2,
            "max_fix_rounds": 2,
            "dry_run": True,
        },
    )

    assert created.status_code == 200
    run = created.json()
    assert run["status"] == "queued"
    assert run["payload"]["chapters"] == [1, 2, 3]
    assert run["payload"]["dry_run"] is True
    assert run["payload"]["input_hash"]
    assert len(run["payload"]["child_task_ids"]) == 9
    assert [task["type"] for task in run["child_tasks"][:3]] == [
        "review_chapter_candidate",
        "fix_chapter_candidate",
        "review_chapter_candidate",
    ]
    assert all(task["status"] == "planned" for task in run["child_tasks"])
    assert all(task["payload"]["execution"] == "queued" for task in run["child_tasks"])

    listed = client.get("/api/pipeline/runs")
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == run["id"]

    paused = client.post(f"/api/pipeline/runs/{run['id']}/pause")
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"
    assert all(task["status"] == "paused" for task in paused.json()["child_tasks"])

    resumed = client.post(f"/api/pipeline/runs/{run['id']}/resume")
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "queued"
    resumed_tasks = resumed.json()["child_tasks"]
    assert [task["status"] for task in resumed_tasks] == [
        "queued",
        "paused",
        "paused",
        "queued",
        "paused",
        "paused",
        "queued",
        "paused",
        "paused",
    ]

    cancelled = client.post(f"/api/pipeline/runs/{run['id']}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "failed_terminal"
    assert cancelled.json()["error"] == "Cancelled by user"
    assert all(task["status"] == "failed_terminal" for task in cancelled.json()["child_tasks"])
    get_settings.cache_clear()
    reset_engine()


def test_pipeline_run_api_rejects_invalid_mode_and_retry_from_queued(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    client = TestClient(app)

    invalid = client.post(
        "/api/pipeline/runs",
        json={"start_chapter": 1, "end_chapter": 2, "mode": "unknown"},
    )
    assert invalid.status_code == 400

    created = client.post(
        "/api/pipeline/runs",
        json={"start_chapter": 1, "end_chapter": 2, "mode": "review_only"},
    )
    assert created.status_code == 200
    retry = client.post(f"/api/pipeline/runs/{created.json()['id']}/retry")
    assert retry.status_code == 400
    assert "not retryable" in retry.json()["detail"]
    get_settings.cache_clear()
    reset_engine()


def test_pipeline_run_delete_requires_terminal_state_and_removes_task_records(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    client = TestClient(app)

    created = client.post(
        "/api/pipeline/runs",
        json={"start_chapter": 1, "end_chapter": 2, "mode": "review_only"},
    )
    assert created.status_code == 200
    run = created.json()

    active_delete = client.delete(f"/api/pipeline/runs/{run['id']}")
    assert active_delete.status_code == 400
    assert "stopped or completed" in active_delete.json()["detail"]
    active_post_delete = client.post(f"/api/pipeline/runs/{run['id']}/delete")
    assert active_post_delete.status_code == 400
    assert "stopped or completed" in active_post_delete.json()["detail"]

    cancelled = client.post(f"/api/pipeline/runs/{run['id']}/cancel")
    assert cancelled.status_code == 200
    deleted = client.post(f"/api/pipeline/runs/{run['id']}/delete")
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True, "run_id": run["id"], "deleted_child_tasks": 2}

    missing = client.get(f"/api/pipeline/runs/{run['id']}")
    assert missing.status_code == 404
    with Session(get_engine()) as session:
      assert session.query(Job).count() == 0
    get_settings.cache_clear()
    reset_engine()


def test_pipeline_run_delete_method_remains_supported(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    client = TestClient(app)

    created = client.post(
        "/api/pipeline/runs",
        json={"start_chapter": 1, "end_chapter": 1, "mode": "review_only"},
    )
    assert created.status_code == 200
    run = created.json()
    cancelled = client.post(f"/api/pipeline/runs/{run['id']}/cancel")
    assert cancelled.status_code == 200

    deleted = client.delete(f"/api/pipeline/runs/{run['id']}")
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True, "run_id": run["id"], "deleted_child_tasks": 1}
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


def test_sandbox_pipeline_smoke_runs_three_chapter_dry_run(tmp_path, monkeypatch) -> None:
    workspace = tmp_path / "runtime" / "sandbox_pipeline_workspace"
    monkeypatch.setattr(
        "sys.argv",
        [
            "sandbox_pipeline_smoke",
            "--workspace",
            str(workspace),
            "--chapters",
            "3",
            "--reset",
        ],
    )

    assert sandbox_pipeline_main() == 0

    report_path = workspace / "runtime" / "reports" / "sandbox_pipeline_smoke.json"
    assert report_path.exists()
    report = __import__("json").loads(report_path.read_text(encoding="utf-8"))
    assert report["run_status"] == "done"
    assert report["task_count"] == 18
    assert report["publish_decision_count"] == 0
    assert report["model_call_count"] >= 9
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


def test_sandbox_pipeline_smoke_refuses_to_reset_plain_runtime(tmp_path) -> None:
    with pytest.raises(SmokeError, match="non-sandbox"):
        create_workspace(tmp_path / "runtime", 1)
