from dataclasses import dataclass, field
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.app.core.config import get_settings
from backend.app.db.base import Base
from backend.app.db.models import Artifact, Event, Job, MemoryItem, PublishDecision, Review
from backend.app.db.session import get_engine, get_session_local, reset_engine
from backend.app.main import app
from backend.app.services.model_client import ChatMessage
from backend.app.services.review_publish import ReviewPublishService
from backend.app.services.revision import RevisionService


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


@dataclass
class FakeRoute:
    role: str = "fixer"
    provider: str = "fake"
    model: str = "fake-model"


@dataclass
class FakeResponse:
    content: str
    model_call_id: int = 99
    route: FakeRoute = field(default_factory=FakeRoute)


class FakeModel:
    def __init__(self, content: str, role: str = "fixer") -> None:
        self.content = content
        self.role = role
        self.messages: list[ChatMessage] = []

    def chat(self, *, role: str, messages: list[ChatMessage], **kwargs) -> FakeResponse:
        self.messages = messages
        return FakeResponse(self.content, route=FakeRoute(role=role))


def test_end_to_end_annotation_revision_review_publish_memory(tmp_path: Path, monkeypatch) -> None:
    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())
    write(content_root / "settings" / "world.md", "# World\nCore fact.")
    write(content_root / "outlines" / "outline.md", "# \u7b2c001\u7ae0 First\nGoal line.")
    original = "# \u7b2c001\u7ae0 First\nAlpha target text."
    revised = "# \u7b2c001\u7ae0 First\nAlpha revised target text."
    write(content_root / "chapters" / "book.md", original)

    client = TestClient(app)
    scan = client.post("/api/library/scan")
    assert scan.status_code == 200
    memory = client.post("/api/memory/rebuild")
    assert memory.status_code == 200
    chapter = client.get("/api/chapters").json()[0]
    start = original.index("target")
    annotation = client.post(
        f"/api/chapters/{chapter['id']}/annotations",
        json={
            "range_start": start,
            "range_end": start + len("target"),
            "type": "logic",
            "severity": "medium",
            "comment": "Revise target wording.",
        },
    )
    assert annotation.status_code == 200

    with get_session_local()() as session:
        revision = RevisionService(session, model_client=FakeModel(revised)).revise_from_annotations(
            chapter_id=chapter["id"],
            annotation_ids=[annotation.json()["id"]],
        )
        assert revision["status"] == "queued"
        job = session.get(Job, revision["job_id"])
        assert job is not None
        job.status = "running"
        session.commit()
        completed = RevisionService(session, model_client=FakeModel(revised)).run_revision_job(revision["job_id"])
        artifact = session.get(Artifact, completed["artifact_id"])
        assert artifact is not None
        service = ReviewPublishService(session, model_client=FakeModel('{"passed": true, "issues": []}', role="reviewer"))
        review = service.review_artifact(artifact.id)
        assert review["passed"] is True
        diff = service.diff_artifact(artifact.id)
        assert "revised target" in diff["diff"]
        published = service.publish_artifact(artifact.id, approved_by_user=True)
        assert published["published"] is True
        assert session.scalar(select(PublishDecision)) is not None
        assert session.scalar(select(Event).where(Event.event_type == "artifact_published")) is not None
        assert session.scalar(select(Review).where(Review.artifact_id == artifact.id)) is not None
        assert session.scalar(select(MemoryItem).where(MemoryItem.kind == "chapter_summary")) is not None

    assert (content_root / "chapters" / "book.md").read_text(encoding="utf-8") == revised
    get_settings.cache_clear()
    reset_engine()
