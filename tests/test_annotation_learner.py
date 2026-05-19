from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from backend.app.core.config import get_settings
from backend.app.db.base import Base
from backend.app.db.models import Annotation, AnnotationInsight, Chapter
from backend.app.db.session import get_engine, get_session_local, reset_engine
from backend.app.main import app
from backend.app.schemas import AnnotationRequest
from backend.app.services.annotation_learner import AnnotationLearner
from backend.app.services.annotations import AnnotationService
from backend.app.services.library import LibraryScanner


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def seed_annotation(session: Session, root: Path, *, annotation_type: str = "style", status: str = "resolved") -> Annotation:
    text = "# \u7b2c001\u7ae0 First\nAlpha target text."
    write(root / "chapters" / "book.md", text)
    write(root / "settings" / "world.md", "# World")
    write(root / "outlines" / "outline.md", "# \u7b2c001\u7ae0 First")
    LibraryScanner(session, root).scan()
    chapter = session.scalars(select(Chapter)).first()
    assert chapter is not None
    annotation = AnnotationService(session, root).create_for_chapter(
        chapter.id,
        AnnotationRequest(
            range_start=text.index("target"),
            range_end=text.index("target") + len("target"),
            type=annotation_type,
            severity="medium",
            comment="Avoid flat repeated phrasing.",
            example_rewrite="Use sharper, scene-specific phrasing.",
        ),
    )
    annotation.status = status
    session.commit()
    return annotation


def test_annotation_learner_creates_short_rules_and_marks_learned(tmp_path: Path) -> None:
    session = make_session()
    annotation = seed_annotation(session, tmp_path / "content")

    result = AnnotationLearner(session).learn([annotation.id])
    insights = list(session.scalars(select(AnnotationInsight).order_by(AnnotationInsight.kind)))

    assert result["created"] == 2
    assert {insight.kind for insight in insights} == {"rewrite_example", "style_preference"}
    assert session.get(Annotation, annotation.id).status == "learned"


def test_annotation_learner_deduplicates_existing_insights(tmp_path: Path) -> None:
    session = make_session()
    annotation = seed_annotation(session, tmp_path / "content")
    learner = AnnotationLearner(session)

    first = learner.learn([annotation.id])
    session.get(Annotation, annotation.id).status = "resolved"
    session.commit()
    second = learner.learn([annotation.id])

    assert first["created"] == 2
    assert second["created"] == 0
    assert session.query(AnnotationInsight).count() == 2


def test_annotation_learner_rejects_unresolved_annotation(tmp_path: Path) -> None:
    session = make_session()
    annotation = seed_annotation(session, tmp_path / "content", status="open")

    with pytest.raises(ValueError, match="not resolved"):
        AnnotationLearner(session).learn([annotation.id])


def test_annotation_insight_api_list_and_update(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("CONTENT_ROOT", str(tmp_path / "content"))
    monkeypatch.setenv("RUNTIME_ROOT", str(tmp_path / "runtime"))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(tmp_path / "runtime"))
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())
    client = TestClient(app)
    with get_session_local()() as session:
        annotation = seed_annotation(session, tmp_path / "content")
        annotation.status = "resolved"
        session.commit()

    learned = client.post("/api/annotations/learn", json={"annotation_ids": [1]})
    assert learned.status_code == 200
    insights = client.get("/api/annotation-insights")
    assert insights.status_code == 200
    insight_id = insights.json()[0]["id"]
    patched = client.patch(f"/api/annotation-insights/{insight_id}", json={"enabled": False, "confidence": 0.4})
    assert patched.status_code == 200
    assert patched.json()["enabled"] is False
    assert patched.json()["confidence"] == 0.4
    get_settings.cache_clear()
    reset_engine()
