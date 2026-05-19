from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.core.config import get_settings
from backend.app.db.base import Base
from backend.app.db.session import get_engine, reset_engine
from backend.app.main import app


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_annotation_api_crud_and_relocate(tmp_path: Path, monkeypatch) -> None:
    db_path = tmp_path / "app.db"
    content_root = tmp_path / "content"
    original = "# \u7b2c001\u7ae0 First\nAlpha target text"
    changed = "# \u7b2c001\u7ae0 First\nMoved words before target and after"
    write(content_root / "chapters" / "book.md", original)

    monkeypatch.setenv("APP_DB_PATH", str(db_path))
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())

    client = TestClient(app)
    scan = client.post("/api/library/scan")
    assert scan.status_code == 200

    chapters = client.get("/api/chapters").json()
    chapter_id = chapters[0]["id"]
    start = original.index("target")

    content = client.get(f"/api/chapters/{chapter_id}/content")
    assert content.status_code == 200
    assert content.json()["text"] == original
    assert content.json()["offset_unit"] == "python_code_point"

    created = client.post(
        f"/api/chapters/{chapter_id}/annotations",
        json={
            "range_start": start,
            "range_end": start + len("target"),
            "type": "logic",
            "severity": "medium",
            "comment": "Check target.",
        },
    )
    assert created.status_code == 200
    annotation = created.json()
    assert annotation["quote_text"] == "target"

    listed = client.get(f"/api/chapters/{chapter_id}/annotations")
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    patched = client.patch(f"/api/annotations/{annotation['id']}", json={"status": "ignored"})
    assert patched.status_code == 200
    assert patched.json()["status"] == "ignored"

    write(content_root / "chapters" / "book.md", changed)
    client.post("/api/library/scan")
    rejected = client.post(f"/api/annotations/{annotation['id']}/relocate")
    assert rejected.status_code == 400
    client.patch(f"/api/annotations/{annotation['id']}", json={"status": "open"})
    relocated = client.post(f"/api/annotations/{annotation['id']}/relocate")
    assert relocated.status_code == 200
    assert relocated.json()["status"] == "open"

    deleted = client.delete(f"/api/annotations/{annotation['id']}")
    assert deleted.status_code == 200
    assert client.get(f"/api/chapters/{chapter_id}/annotations").json() == []

    get_settings.cache_clear()
    reset_engine()
