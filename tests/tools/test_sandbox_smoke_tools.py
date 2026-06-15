import json

import pytest

from backend.app.core.config import get_settings
from backend.app.db.session import reset_engine
from backend.tools.sandbox_pipeline_smoke import SmokeError, create_workspace
from backend.tools.sandbox_pipeline_smoke import main as sandbox_pipeline_main
from backend.tools.sandbox_publish_smoke import _is_sandbox_workspace


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
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["run_status"] == "done"
    assert report["task_count"] == 18
    assert report["publish_decision_count"] == 0
    assert report["model_call_count"] >= 9
    get_settings.cache_clear()
    reset_engine()


def test_sandbox_pipeline_smoke_refuses_to_reset_plain_runtime(tmp_path) -> None:
    with pytest.raises(SmokeError, match="non-sandbox"):
        create_workspace(tmp_path / "runtime", 1)


def test_sandbox_publish_smoke_workspace_guard_requires_sandbox_name(tmp_path) -> None:
    assert _is_sandbox_workspace(tmp_path / "sandbox_workspace") is True
    assert _is_sandbox_workspace(tmp_path / "runtime" / "sandbox_publish_workspace") is True
    assert _is_sandbox_workspace(tmp_path / "real_novel_workspace") is False
