from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.core.config import get_settings
from backend.app.db.base import Base
from backend.app.db.models import Chapter
from backend.app.db.session import get_engine, get_session_local, reset_engine
from backend.app.main import app
from backend.app.services.artifacts import ArtifactStore
from backend.app.services.workspace import workspace_runtime_root


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_workspace_api_switches_to_legacy_layout(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("RUNTIME_ROOT", str(tmp_path / "runtime"))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(tmp_path / "runtime"))
    monkeypatch.setenv("CONTENT_ROOT", str(tmp_path / "empty-content"))
    get_settings.cache_clear()
    reset_engine()


def test_configured_workspace_overrides_content_root(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("RUNTIME_ROOT", str(tmp_path / "runtime"))
    content_root = tmp_path / "content-root"
    switched = tmp_path / "switched"
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    write(content_root / "02-正文" / "01卷" / "第001章.md", "# 第001章 Content\nBody")
    write(switched / "02-正文" / "01卷" / "第002章.md", "# 第002章 Switched\nBody")
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())

    client = TestClient(app)
    response = client.post("/api/workspace", json={"path": str(switched)})

    assert response.status_code == 200
    assert response.json()["root"] == str(switched.resolve())
    assert client.get("/api/workspace").json()["root"] == str(switched.resolve())

    scan = client.post("/api/library/scan")
    assert scan.status_code == 200
    chapters = client.get("/api/chapters").json()
    assert [chapter["chapter_no"] for chapter in chapters] == [2]

    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())

    workspace = tmp_path / "workspace"
    write(workspace / "00-系统" / "system.md", "# System")
    write(workspace / "02-正文" / "01卷" / "第001章.md", "# 第001章 First\nBody")

    client = TestClient(app)
    response = client.post("/api/workspace", json={"path": str(workspace)})

    assert response.status_code == 200
    payload = response.json()
    assert payload["layout"] == "legacy"
    assert payload["detected_counts"]["00-系统"] == 1
    assert payload["detected_counts"]["02-正文"] == 1

    scan = client.post("/api/library/scan")
    assert scan.status_code == 200
    assert scan.json()["chapters_seen"] == 1

    health = client.get("/health").json()
    assert health["workspace"]["runtime_root"] == str((workspace / "runtime").resolve())
    assert health["workspace"]["app_runtime_root"] == str((tmp_path / "runtime").resolve())

    get_settings.cache_clear()
    reset_engine()


def test_artifacts_default_to_active_workspace_runtime(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(tmp_path / "artifact-runtime"))
    monkeypatch.setenv("CONTENT_ROOT", str(tmp_path / "empty-content"))
    workspace = tmp_path / "workspace"
    write(workspace / "02-正文" / "01卷" / "第001章.md", "# 第001章 First\nBody")
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())

    client = TestClient(app)
    assert client.post("/api/workspace", json={"path": str(workspace)}).status_code == 200
    assert client.post("/api/library/scan").status_code == 200

    with get_session_local()() as session:
        chapter = session.query(Chapter).filter_by(chapter_no=1).one()
        artifact = ArtifactStore(session).save_text(
            kind="candidate",
            text="# 第001章 First\nCandidate",
            metadata={"test": True},
            base_chapter=chapter,
        )
        session.commit()

    runtime = workspace_runtime_root()
    assert runtime == (tmp_path / "artifact-runtime").resolve()
    assert (runtime / artifact.path).exists()

    get_settings.cache_clear()
    reset_engine()


def test_workspace_runtime_defaults_to_workspace_when_runtime_env_absent(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.delenv("RUNTIME_ROOT", raising=False)
    monkeypatch.setenv("CONTENT_ROOT", str(tmp_path / "empty-content"))
    workspace = tmp_path / "workspace"
    write(workspace / "02-正文" / "01卷" / "第001章.md", "# 第001章 First\nBody")
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())

    client = TestClient(app)
    response = client.post("/api/workspace", json={"path": str(workspace)})

    assert response.status_code == 200
    assert response.json()["runtime_root"] == str((workspace / "runtime").resolve())

    get_settings.cache_clear()
    reset_engine()


def test_runtime_root_env_does_not_override_workspace_runtime(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("RUNTIME_ROOT", str(tmp_path / "app-runtime"))
    monkeypatch.setenv("CONTENT_ROOT", str(tmp_path / "empty-content"))
    monkeypatch.delenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", raising=False)
    workspace = tmp_path / "workspace"
    write(workspace / "02-正文" / "01卷" / "第001章.md", "# 第001章 First\nBody")
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())

    client = TestClient(app)
    response = client.post("/api/workspace", json={"path": str(workspace)})

    assert response.status_code == 200
    assert response.json()["app_runtime_root"] == str((tmp_path / "app-runtime").resolve())
    assert response.json()["runtime_root"] == str((workspace / "runtime").resolve())

    get_settings.cache_clear()
    reset_engine()
