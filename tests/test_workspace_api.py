from pathlib import Path
import importlib

from fastapi.testclient import TestClient

from backend.app.core.config import get_settings
from backend.app.db.base import Base
from backend.app.db.models import Chapter, Event
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


def test_workspace_api_accepts_numeric_alias_layout(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("RUNTIME_ROOT", str(tmp_path / "runtime"))
    monkeypatch.setenv("CONTENT_ROOT", str(tmp_path / "empty-content"))
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())

    workspace = tmp_path / "workspace"
    write(workspace / "00-设定" / "设定文档.md", "# 设定")
    write(workspace / "01-大纲" / "00-全文总纲v3.md", "# 总纲")
    write(workspace / "03-章纲" / "01-第一卷.md", "# 第一卷")
    write(workspace / "02-正文" / "01卷" / "第001章.md", "# 第001章 First\nBody")

    client = TestClient(app)
    response = client.post("/api/workspace", json={"path": str(workspace)})

    assert response.status_code == 200
    payload = response.json()
    assert payload["layout"] == "legacy"
    assert payload["detected_counts"]["00-设定"] == 1
    assert payload["detected_counts"]["01-大纲"] == 1
    assert payload["detected_counts"]["03-章纲"] == 1
    assert payload["detected_counts"]["02-正文"] == 1

    scan = client.post("/api/library/scan")
    assert scan.status_code == 200
    assert scan.json()["source_files_seen"] == 4
    assert client.get("/api/chapters").json()[0]["chapter_no"] == 1

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


def test_test_support_can_seed_failed_review_hash_mismatch_and_budget_pause(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "e2e-app.db"))
    monkeypatch.setenv("RUNTIME_ROOT", str(tmp_path / "e2e-runtime"))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(tmp_path / "e2e-runtime"))
    monkeypatch.setenv("ENABLE_TEST_SUPPORT", "true")
    monkeypatch.setenv("CONTENT_ROOT", str(tmp_path / "empty-content"))
    workspace = tmp_path / "sandbox_workspace"
    write(workspace / "content" / "chapters" / "book.md", "# 第001章 First\nBody")
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())
    import backend.app.main as main_module

    app_with_test_support = importlib.reload(main_module).app

    client = TestClient(app_with_test_support)
    assert client.post("/api/workspace", json={"path": str(workspace)}).status_code == 200
    assert client.post("/api/library/scan").status_code == 200
    chapter = client.get("/api/chapters").json()[0]
    failed = client.post(
        "/api/test/seed-reviewed-candidate",
        json={
            "chapter_id": chapter["id"],
            "text": "# 第001章 First\nBody changed",
            "passed": False,
            "manual_required": True,
            "issues": [
                {
                    "chapter": 1,
                    "severity": "blocking",
                    "owner": "admin",
                    "description": "人工判断",
                    "evidence": "测试证据",
                    "fix_instruction": "不要发布",
                }
            ],
        },
    )
    assert failed.status_code == 200
    artifact_id = failed.json()["artifact_id"]
    detail = client.get(f"/api/artifacts/{artifact_id}").json()
    assert detail["latest_review"]["passed"] is False
    assert detail["latest_review"]["manual_required"] is True

    mutation = client.post("/api/test/mutate-chapter-source", json={"chapter_id": chapter["id"], "marker": "\n外部改动"})
    assert mutation.status_code == 200
    publish = client.post(f"/api/artifacts/{artifact_id}/publish", json={"approved_by_user": True})
    assert publish.status_code == 400
    assert publish.json()["detail"] in {"Review did not pass; force requires force_reason", "Source file hash changed; rescan and regenerate candidate"}

    paused = client.post("/api/test/seed-budget-paused-job")
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused_budget"
    run_once = client.post("/api/jobs/run-once")
    assert run_once.status_code == 200
    assert run_once.json()["succeeded"] >= 1

    get_settings.cache_clear()
    reset_engine()


def test_test_support_routes_are_disabled_by_default(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("RUNTIME_ROOT", str(tmp_path / "runtime"))
    monkeypatch.setenv("CONTENT_ROOT", str(tmp_path / "content"))
    monkeypatch.delenv("ENABLE_TEST_SUPPORT", raising=False)
    get_settings.cache_clear()
    reset_engine()

    import backend.app.main as main_module

    app_without_test_support = importlib.reload(main_module).app
    client = TestClient(app_without_test_support)

    response = client.post("/api/test/seed-budget-paused-job")

    assert response.status_code == 404
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


def test_source_file_create_folder_file_and_normalize_chapter(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("RUNTIME_ROOT", str(tmp_path / "runtime"))
    monkeypatch.setenv("CONTENT_ROOT", str(tmp_path / "empty-content"))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(tmp_path / "runtime"))
    workspace = tmp_path / "workspace"
    (workspace / "02-正文").mkdir(parents=True)
    (workspace / "01-设定").mkdir(parents=True)
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())

    client = TestClient(app)
    assert client.post("/api/workspace", json={"path": str(workspace)}).status_code == 200

    folder = client.post("/api/source-folders/create", json={"root": "chapters", "folder": "06卷"})
    assert folder.status_code == 200
    assert (workspace / "02-正文" / "06卷").is_dir()
    assert "02-正文/06卷" in folder.json()["scan"]["empty_chapter_folders"]

    chapter = client.post(
        "/api/source-files/create",
        json={
            "root": "chapters",
            "folder": "06卷",
            "filename": "第146章.md",
            "template": "chapter",
            "chapter_no": 146,
            "title": "新卷开篇",
            "content": "正文开头。",
        },
    )
    assert chapter.status_code == 200
    assert chapter.json()["chapter_id"] is not None
    assert client.get("/api/chapters").json()[0]["chapter_no"] == 146

    loose = client.post(
        "/api/source-files/create",
        json={
            "root": "chapters",
            "folder": "06卷",
            "filename": "待整理.md",
            "template": "blank",
            "title": "",
            "content": "只有正文，没有章标题。",
        },
    )
    assert loose.status_code == 200
    loose_source_id = loose.json()["source_file_id"]
    assert "02-正文/06卷/待整理.md" in loose.json()["scan"]["unparsed_chapter_files"]

    normalized = client.post(
        f"/api/source-files/{loose_source_id}/normalize-chapter",
        json={"chapter_no": 147, "title": "整理成章"},
    )
    assert normalized.status_code == 400
    assert "规范化会修改这个 Markdown 文件" in normalized.json()["detail"]

    normalized = client.post(
        f"/api/source-files/{loose_source_id}/normalize-chapter",
        json={"chapter_no": 147, "title": "整理成章", "confirm_normalize": True},
    )
    assert normalized.status_code == 200
    assert normalized.json()["chapter_id"] is not None
    assert normalized.json()["backup_path"].startswith("backups/")
    assert [item["chapter_no"] for item in client.get("/api/chapters").json()] == [146, 147]
    assert "# 第147章 整理成章" in (workspace / "02-正文" / "06卷" / "待整理.md").read_text(encoding="utf-8")
    assert (tmp_path / "runtime" / normalized.json()["backup_path"]).exists()
    with get_session_local()() as session:
        event = session.query(Event).filter_by(event_type="source_file_normalized").one()
        assert event.entity_id == loose_source_id

    get_settings.cache_clear()
    reset_engine()


def test_source_file_create_rejects_unsafe_paths_and_duplicates(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("RUNTIME_ROOT", str(tmp_path / "runtime"))
    monkeypatch.setenv("CONTENT_ROOT", str(tmp_path / "empty-content"))
    workspace = tmp_path / "workspace"
    (workspace / "02-正文").mkdir(parents=True)
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())

    client = TestClient(app)
    assert client.post("/api/workspace", json={"path": str(workspace)}).status_code == 200
    created = client.post(
        "/api/source-files/create",
        json={"root": "chapters", "folder": "01卷", "filename": "第001章.md", "template": "chapter", "chapter_no": 1, "title": "起步"},
    )
    assert created.status_code == 200

    duplicate = client.post(
        "/api/source-files/create",
        json={"root": "chapters", "folder": "01卷", "filename": "第001章.md", "template": "chapter", "chapter_no": 2, "title": "重复"},
    )
    assert duplicate.status_code == 400
    assert duplicate.json()["detail"] == "Source file already exists"

    traversal = client.post(
        "/api/source-files/create",
        json={"root": "chapters", "folder": "../runtime", "filename": "bad.md", "template": "blank"},
    )
    assert traversal.status_code == 400

    protected = client.post(
        "/api/source-files/create",
        json={"root": "chapters", "folder": "runtime", "filename": "bad.md", "template": "blank"},
    )
    assert protected.status_code == 400

    get_settings.cache_clear()
    reset_engine()
