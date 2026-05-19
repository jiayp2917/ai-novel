from pathlib import Path

from backend.app.core.config import get_settings
from backend.app.db.session import reset_engine
from backend.tools.production_pipeline_validate import ValidationOptions, run_validation
from backend.tools.sandbox_pipeline_smoke import FakePipelineModelClient, create_workspace


class FailingReviewerClient(FakePipelineModelClient):
    def _content(self, role: str, prompt: str, *, require_json: bool) -> str:
        if role == "reviewer":
            raise RuntimeError("reviewer unavailable")
        return super()._content(role, prompt, require_json=require_json)


def test_production_pipeline_validate_full_dry_run_with_fake_client(tmp_path, monkeypatch) -> None:
    workspace = tmp_path / "sandbox_workspace"
    create_workspace(workspace, 2)
    key_file = tmp_path / "key.txt"
    key_file.write_text('KIMI_API_KEY="fresh-test-key"', encoding="utf-8")
    monkeypatch.setenv("KIMI_API_KEY", "stale-test-key")
    monkeypatch.setattr("backend.app.services.pipeline.writer.ModelClient", FakePipelineModelClient)
    monkeypatch.setattr("backend.app.services.pipeline.reviewer.ModelClient", FakePipelineModelClient)
    monkeypatch.setattr("backend.app.services.pipeline.fixer.ModelClient", FakePipelineModelClient)

    report = run_validation(
        ValidationOptions(
            workspace=workspace,
            start_chapter=1,
            end_chapter=2,
            mode="full_dry_run",
            key_file=key_file,
            max_iterations=50,
            max_role_failure_rate=0.30,
            max_consecutive_chapter_failures=2,
        )
    )

    assert report["status"] == "completed"
    assert report["dry_run"] is True
    assert report["source_hash_unchanged"] is True
    assert report["published_count"] == 0
    assert report["publish_decision_count"] == 0
    assert report["quality"]["chapter_pass_rate"] == 1.0
    assert report["model_metrics"]["writer"]["calls"] == 2
    assert report["model_metrics"]["reviewer"]["calls"] == 2
    assert __import__("os").environ["KIMI_API_KEY"] == "fresh-test-key"
    assert Path(report["report_json"]).exists()
    assert Path(report["report_md"]).exists()
    get_settings.cache_clear()
    reset_engine()


def test_production_pipeline_validate_stops_on_consecutive_failures(tmp_path, monkeypatch) -> None:
    workspace = tmp_path / "sandbox_workspace"
    create_workspace(workspace, 3)
    monkeypatch.setattr("backend.app.services.pipeline.writer.ModelClient", FakePipelineModelClient)
    monkeypatch.setattr("backend.app.services.pipeline.reviewer.ModelClient", FailingReviewerClient)
    monkeypatch.setattr("backend.app.services.pipeline.fixer.ModelClient", FakePipelineModelClient)

    report = run_validation(
        ValidationOptions(
            workspace=workspace,
            start_chapter=1,
            end_chapter=3,
            mode="full_dry_run",
            key_file=tmp_path / "missing-key.txt",
            max_iterations=50,
            max_role_failure_rate=1.0,
            max_consecutive_chapter_failures=2,
        )
    )

    assert report["status"] == "stopped"
    assert report["stop_reason"] == "consecutive_chapter_failures"
    assert report["completed_chapters"] == [1, 2]
    assert report["source_hash_unchanged"] is True
    assert report["published_count"] == 0
    get_settings.cache_clear()
    reset_engine()
