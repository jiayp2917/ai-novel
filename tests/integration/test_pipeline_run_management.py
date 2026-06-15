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
            "generation_mode": "quality",
        },
    )

    assert created.status_code == 200
    run = created.json()
    assert run["status"] == "queued"
    assert run["summary"]["total_steps"] == 9
    assert run["summary"]["completed_steps"] == 0
    assert run["summary"]["status_label"] == "等待开始"
    assert run["next_step"]["label"] == "下一步"
    assert run["report_summary"]["path"] is None
    assert run["payload"]["chapters"] == [1, 2, 3]
    assert run["payload"]["dry_run"] is True
    assert run["payload"]["generation_mode"] == "quality"
    assert run["payload"]["input_hash"]
    assert len(run["payload"]["child_task_ids"]) == 9
    assert [task["type"] for task in run["child_tasks"][:3]] == [
        "review_chapter_candidate",
        "fix_chapter_candidate",
        "review_chapter_candidate",
    ]
    assert all(task["status"] == "planned" for task in run["child_tasks"])
    assert all(task["payload"]["execution"] == "queued" for task in run["child_tasks"])
    assert all(task["payload"]["generation_mode"] == "quality" for task in run["child_tasks"])

    listed = client.get("/api/pipeline/runs")
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == run["id"]
    limited = client.get("/api/pipeline/runs?limit=1")
    assert limited.status_code == 200
    assert len(limited.json()) == 1

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

def test_pipeline_run_operations_are_limited_to_valid_statuses(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    client = TestClient(app)

    created = client.post(
        "/api/pipeline/runs",
        json={"start_chapter": 1, "end_chapter": 1, "mode": "review_only"},
    )
    assert created.status_code == 200
    run_id = created.json()["id"]

    assert client.post(f"/api/pipeline/runs/{run_id}/resume").status_code == 400
    assert client.post(f"/api/pipeline/runs/{run_id}/retry").status_code == 400

    paused = client.post(f"/api/pipeline/runs/{run_id}/pause")
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"

    resumed = client.post(f"/api/pipeline/runs/{run_id}/resume")
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "queued"

    cancelled = client.post(f"/api/pipeline/runs/{run_id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "failed_terminal"

    assert client.post(f"/api/pipeline/runs/{run_id}/pause").status_code == 400
    assert client.post(f"/api/pipeline/runs/{run_id}/resume").status_code == 400
    assert client.post(f"/api/pipeline/runs/{run_id}/retry").status_code == 400
    assert client.post(f"/api/pipeline/runs/{run_id}/cancel").status_code == 400
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
    assert deleted.json()["deleted"] is True
    assert deleted.json()["run_id"] == run["id"]
    assert deleted.json()["deleted_child_tasks"] == 2
    assert deleted.json()["report_path"] == f"reports/pipeline_run_{run['id']}.json"
    report_path = tmp_path / "runtime" / deleted.json()["report_path"]
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["run_id"] == run["id"]
    assert "runtime" in report["note"]

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
    assert deleted.json()["deleted"] is True
    assert deleted.json()["run_id"] == run["id"]
    assert deleted.json()["deleted_child_tasks"] == 1
    get_settings.cache_clear()
    reset_engine()

def test_pipeline_run_delete_allows_terminal_run_with_unstarted_children(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    client = TestClient(app)

    created = client.post(
        "/api/pipeline/runs",
        json={"start_chapter": 1, "end_chapter": 2, "mode": "review_only"},
    )
    assert created.status_code == 200
    run = created.json()

    with Session(get_engine()) as session:
        parent = session.get(Job, run["id"])
        assert parent is not None
        parent.status = "failed_terminal"
        parent.error = "Cancelled by user"
        session.commit()

    deleted = client.post(f"/api/pipeline/runs/{run['id']}/delete")
    assert deleted.status_code == 200
    assert deleted.json()["deleted"] is True
    assert deleted.json()["run_id"] == run["id"]
    assert deleted.json()["deleted_child_tasks"] == 2
    with Session(get_engine()) as session:
        assert session.query(Job).count() == 0
    get_settings.cache_clear()
    reset_engine()

def test_pipeline_run_delete_rejects_terminal_run_with_retryable_child(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    client = TestClient(app)

    created = client.post(
        "/api/pipeline/runs",
        json={"start_chapter": 1, "end_chapter": 1, "mode": "review_only"},
    )
    assert created.status_code == 200
    run = created.json()

    with Session(get_engine()) as session:
        parent = session.get(Job, run["id"])
        assert parent is not None
        child_id = json.loads(parent.payload_json)["child_task_ids"][0]
        child = session.get(Job, child_id)
        assert child is not None
        parent.status = "failed_terminal"
        child.status = "failed_retryable"
        child.error = "模型返回格式错误"
        session.commit()

    refreshed = client.get(f"/api/pipeline/runs/{run['id']}")
    assert refreshed.status_code == 200
    assert refreshed.json()["summary"]["can_delete"] is False
    assert "仍有运行中、暂停或可重试" in refreshed.json()["summary"]["delete_block_reason"]
    deleted = client.post(f"/api/pipeline/runs/{run['id']}/delete")
    assert deleted.status_code == 400
    assert "active child tasks" in deleted.json()["detail"]
    get_settings.cache_clear()
    reset_engine()

def test_pipeline_run_delete_preserves_artifacts_reviews_model_calls_and_publish_records(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    client = TestClient(app)
    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    chapter_file = content_root / "chapters" / "book.md"
    chapter_file.parent.mkdir(parents=True, exist_ok=True)
    chapter_file.write_text("# 第001章 First\nBody.", encoding="utf-8")

    created = client.post(
        "/api/pipeline/runs",
        json={"start_chapter": 1, "end_chapter": 1, "mode": "review_only"},
    )
    assert created.status_code == 200
    run = created.json()

    with Session(get_engine()) as session:
        source = Repository(session, SourceFile).create(
            {"path": "chapters/book.md", "kind": "chapters", "sha256": "source-hash", "mtime": 1.0, "size": 21, "active": True}
        )
        chapter = Repository(session, Chapter).create(
            {"chapter_no": 1, "title": "First", "source_file_id": source.id, "range_start": 0, "range_end": 21, "active": True}
        )
        artifact = ArtifactStore(session).save_text(kind="candidate", text="# 第001章 First\nCandidate.", metadata={}, base_chapter=chapter)
        diff_path = runtime_root / "diffs" / "artifact.diff"
        backup_path = runtime_root / "backups" / "book.md"
        diff_path.parent.mkdir(parents=True, exist_ok=True)
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        diff_path.write_text("diff", encoding="utf-8")
        backup_path.write_text("backup", encoding="utf-8")
        session.add_all(
            [
                Review(
                    artifact_id=artifact.id,
                    passed=True,
                    issues_json="[]",
                    evidence_count=0,
                    manual_required=False,
                    candidate_hash=artifact.sha256,
                    base_source_file_hash=artifact.base_source_file_hash,
                    base_chapter_version_id=artifact.base_chapter_version_id,
                ),
                ModelCall(
                    role="reviewer",
                    provider="fake",
                    model="fake",
                    prompt_hash="a" * 64,
                    input_chars=10,
                    output_chars=5,
                    usage_json="{}",
                    cache_hit=False,
                    status="succeeded",
                ),
                PublishDecision(
                    artifact_id=artifact.id,
                    approved_by_user=True,
                    force=False,
                    source_hash_before="a" * 64,
                    candidate_hash=artifact.sha256,
                    diff_path="diffs/artifact.diff",
                    backup_path="backups/book.md",
                    published_at=None,
                ),
            ]
        )
        parent = session.get(Job, run["id"])
        assert parent is not None
        child_id = json.loads(parent.payload_json)["child_task_ids"][0]
        child = session.get(Job, child_id)
        assert child is not None
        child.result_json = json.dumps({"artifact_id": artifact.id, "model_call_id": 1}, ensure_ascii=False)
        parent.status = "failed_terminal"
        session.commit()
        artifact_id = artifact.id

    deleted = client.post(f"/api/pipeline/runs/{run['id']}/delete")
    assert deleted.status_code == 200

    with Session(get_engine()) as session:
        assert session.get(Artifact, artifact_id) is not None
        assert session.scalar(select(Review).where(Review.artifact_id == artifact_id)) is not None
        assert session.scalar(select(ModelCall)) is not None
        assert session.scalar(select(PublishDecision).where(PublishDecision.artifact_id == artifact_id)) is not None
        assert diff_path.exists()
        assert backup_path.exists()
        assert (runtime_root / deleted.json()["report_path"]).exists()
    get_settings.cache_clear()
    reset_engine()

def test_pipeline_run_pause_and_cancel_preserve_finished_child_tasks(tmp_path, monkeypatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    with Session(get_engine()) as session:
        run = PipelineRunService(session).create_run(
            start_chapter=1,
            end_chapter=1,
            mode="full_auto",
            dry_run=True,
        )
        child_ids = [task["id"] for task in run["child_tasks"]]
        finished_statuses = ["done", "approved", "published", "summarized"]
        for child_id, status in zip(child_ids[:4], finished_statuses):
            child = session.get(Job, child_id)
            assert child is not None
            child.status = status
        session.commit()

        paused = PipelineRunService(session).pause(run["id"])

        assert paused["status"] == "paused"
        paused_statuses = {task["id"]: task["status"] for task in paused["child_tasks"]}
        for child_id, status in zip(child_ids[:4], finished_statuses):
            assert paused_statuses[child_id] == status
        assert all(paused_statuses[child_id] == "paused" for child_id in child_ids[4:])

        cancelled = PipelineRunService(session).cancel(run["id"])

        assert cancelled["status"] == "failed_terminal"
        cancelled_statuses = {task["id"]: task["status"] for task in cancelled["child_tasks"]}
        for child_id, status in zip(child_ids[:4], finished_statuses):
            assert cancelled_statuses[child_id] == status
        assert all(cancelled_statuses[child_id] == "failed_terminal" for child_id in child_ids[4:])
    get_settings.cache_clear()
    reset_engine()
