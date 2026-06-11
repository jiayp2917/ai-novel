import json
from dataclasses import dataclass, field
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from backend.app.core.config import get_settings
from backend.app.db.base import Base
from backend.app.db.models import Annotation, Artifact, Review, SourceFile
from backend.app.db.session import get_engine, reset_engine
from backend.app.main import app
from backend.app.schemas import AnnotationRequest
from backend.app.services.annotations import AnnotationService
from backend.app.services.library import LibraryScanner
from backend.app.services.model_client import ChatMessage
from backend.app.services.review_publish import ReviewPublishError, ReviewPublishService
from backend.app.services.source_proposal import SourceProposalService
from backend.app.services.writing_cards import WritingCardService


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def seed_sources(root: Path) -> None:
    write(root / "settings" / "world.md", "# World\nOld setting line.")
    write(root / "outlines" / "outline.md", "# \u7b2c001\u7ae0 First\nOld outline.")
    write(root / "chapters" / "book.md", "# \u7b2c001\u7ae0 First\nBody.")


@dataclass
class FakeRoute:
    role: str = "outliner"
    provider: str = "fake"
    model: str = "fake-model"


@dataclass
class FakeResponse:
    content: str
    model_call_id: int = 88
    route: FakeRoute = field(default_factory=FakeRoute)


class FakeModelClient:
    def __init__(self, content: str, role: str = "outliner") -> None:
        self.content = content
        self.role = role
        self.messages: list[ChatMessage] = []

    def chat(self, *, role: str, messages: list[ChatMessage], **kwargs) -> FakeResponse:
        self.messages = messages
        return FakeResponse(self.content, route=FakeRoute(role=role))


def test_source_file_content_and_annotations_api(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("CONTENT_ROOT", str(tmp_path / "content"))
    monkeypatch.setenv("RUNTIME_ROOT", str(tmp_path / "runtime"))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(tmp_path / "runtime"))
    get_settings.cache_clear()
    reset_engine()
    seed_sources(tmp_path / "content")
    Base.metadata.create_all(get_engine())
    client = TestClient(app)
    client.post("/api/library/scan")
    source = next(item for item in client.get("/api/source-files").json() if item["kind"] == "settings")
    content = client.get(f"/api/source-files/{source['id']}")
    assert content.status_code == 200
    assert "Old setting line" in content.json()["text"]

    start = content.json()["text"].index("Old")
    created = client.post(
        f"/api/source-files/{source['id']}/annotations",
        json={
            "range_start": start,
            "range_end": start + len("Old"),
            "type": "setting_conflict",
            "severity": "medium",
            "comment": "Update stale setting.",
        },
    )
    assert created.status_code == 200
    listed = client.get(f"/api/source-files/{source['id']}/annotations")
    assert listed.status_code == 200
    assert listed.json()[0]["chapter_id"] is None
    get_settings.cache_clear()
    reset_engine()


def test_generate_source_proposal_creates_artifact(tmp_path: Path, monkeypatch) -> None:
    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    seed_sources(content_root)
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    get_settings.cache_clear()
    session = make_session()
    LibraryScanner(session, content_root).scan()
    source = session.scalar(select(SourceFile).where(SourceFile.kind == "settings"))
    assert source is not None
    annotation = AnnotationService(session, content_root).create_for_source_file(
        source.id,
        AnnotationRequest(
            range_start=0,
            range_end=7,
            type="setting_conflict",
            severity="medium",
            comment="Improve setting.",
        ),
    )

    result = SourceProposalService(session, model_client=FakeModelClient("# World\nNew setting line.")).generate_proposal(
        source.id,
        annotation_ids=[annotation.id],
    )

    artifact = session.get(Artifact, result["artifact_id"])
    assert artifact is not None
    assert artifact.kind == "proposal"
    assert artifact.base_source_file_id == source.id
    assert (runtime_root / artifact.path).read_text(encoding="utf-8").startswith("# World")
    metadata = json.loads(artifact.metadata_json)
    assert metadata["purpose"] == "source_file_proposal"
    assert metadata["task_type"] == "generate_source_proposal"
    get_settings.cache_clear()


def test_generate_writing_card_creates_proposal_without_writing_outline(tmp_path: Path, monkeypatch) -> None:
    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    seed_sources(content_root)
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    get_settings.cache_clear()
    session = make_session()
    LibraryScanner(session, content_root).scan()
    source = session.scalar(select(SourceFile).where(SourceFile.kind == "outlines"))
    assert source is not None
    original = (content_root / source.path).read_text(encoding="utf-8")

    result = WritingCardService(
        session,
        model_client=FakeModelClient("# 第001章 First 写作卡\n\n- 本章目标：稳定生成。"),
    ).generate_card(source.id, chapter_no=1, generation_mode="stable")

    artifact = session.get(Artifact, result["artifact_id"])
    assert artifact is not None
    assert artifact.kind == "proposal"
    assert artifact.base_source_file_id == source.id
    assert (runtime_root / artifact.path).read_text(encoding="utf-8").startswith("# 第001章 First 写作卡")
    assert (content_root / source.path).read_text(encoding="utf-8") == original
    metadata = json.loads(artifact.metadata_json)
    assert metadata["purpose"] == "chapter_writing_card"
    assert metadata["task_type"] == "generate_chapter_writing_card"
    assert metadata["generation_mode"] == "stable"
    assert metadata["canonical"] is False
    get_settings.cache_clear()


def test_generate_writing_card_rejects_non_outline_source(tmp_path: Path, monkeypatch) -> None:
    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    seed_sources(content_root)
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    get_settings.cache_clear()
    session = make_session()
    LibraryScanner(session, content_root).scan()
    source = session.scalar(select(SourceFile).where(SourceFile.kind == "settings"))
    assert source is not None

    try:
        WritingCardService(session, model_client=FakeModelClient("unused")).generate_card(source.id, chapter_no=1)
    except Exception as exc:
        assert "outline" in str(exc)
    else:
        raise AssertionError("writing cards must reject non-outline sources")
    get_settings.cache_clear()


def test_generate_source_proposal_uses_selected_annotations(tmp_path: Path, monkeypatch) -> None:
    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    seed_sources(content_root)
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    get_settings.cache_clear()
    session = make_session()
    LibraryScanner(session, content_root).scan()
    source = session.scalar(select(SourceFile).where(SourceFile.kind == "settings"))
    assert source is not None
    annotation = AnnotationService(session, content_root).create_for_source_file(
        source.id,
        AnnotationRequest(
            range_start=0,
            range_end=7,
            type="setting_conflict",
            severity="medium",
            comment="Only this selected annotation should be sent.",
        ),
    )
    model = FakeModelClient("# World\nNew setting line.")

    SourceProposalService(session, model_client=model).generate_proposal(source.id, annotation_ids=[annotation.id])

    user_payload = model.messages[-1].content
    assert "Only this selected annotation should be sent." in user_payload
    assert f'"id": {annotation.id}' in user_payload
    get_settings.cache_clear()


def test_source_proposal_ignores_resolved_and_ignored_annotations_by_default(tmp_path: Path, monkeypatch) -> None:
    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    seed_sources(content_root)
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    get_settings.cache_clear()
    session = make_session()
    LibraryScanner(session, content_root).scan()
    source = session.scalar(select(SourceFile).where(SourceFile.kind == "settings"))
    assert source is not None
    service = AnnotationService(session, content_root)
    open_annotation = service.create_for_source_file(
        source.id,
        AnnotationRequest(range_start=0, range_end=7, type="setting_conflict", severity="medium", comment="Active annotation."),
    )
    ignored_annotation = service.create_for_source_file(
        source.id,
        AnnotationRequest(range_start=8, range_end=11, type="setting_conflict", severity="medium", comment="Ignored annotation."),
    )
    ignored_annotation.status = "ignored"
    session.commit()
    model = FakeModelClient("# World\nNew setting line.")

    SourceProposalService(session, model_client=model).generate_proposal(source.id)

    user_payload = model.messages[-1].content
    assert f'"id": {open_annotation.id}' in user_payload
    assert f'"id": {ignored_annotation.id}' not in user_payload
    assert "Ignored annotation." not in user_payload
    get_settings.cache_clear()


def test_source_proposal_rejects_selected_inactive_annotation(tmp_path: Path, monkeypatch) -> None:
    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    seed_sources(content_root)
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    get_settings.cache_clear()
    session = make_session()
    LibraryScanner(session, content_root).scan()
    source = session.scalar(select(SourceFile).where(SourceFile.kind == "settings"))
    assert source is not None
    annotation = AnnotationService(session, content_root).create_for_source_file(
        source.id,
        AnnotationRequest(range_start=0, range_end=7, type="setting_conflict", severity="medium", comment="Inactive annotation."),
    )
    annotation.status = "ignored"
    session.commit()

    try:
        SourceProposalService(session, model_client=FakeModelClient("# World\nNew setting line.")).generate_proposal(
            source.id,
            annotation_ids=[annotation.id],
        )
    except Exception as exc:
        assert "not active" in str(exc)
    else:
        raise AssertionError("selected inactive annotations must be rejected")
    get_settings.cache_clear()


def test_source_proposal_publish_is_rejected_by_default_workflow(tmp_path: Path, monkeypatch) -> None:
    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    seed_sources(content_root)
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    get_settings.cache_clear()
    session = make_session()
    LibraryScanner(session, content_root).scan()
    source = session.scalar(select(SourceFile).where(SourceFile.kind == "settings"))
    assert source is not None
    artifact = SourceProposalService(session, model_client=FakeModelClient("# World\nPublished setting.")).generate_proposal(source.id)
    artifact_obj = session.get(Artifact, artifact["artifact_id"])
    assert artifact_obj is not None
    session.add(
        Review(
            artifact_id=artifact_obj.id,
            passed=True,
            issues_json="[]",
            evidence_count=0,
            manual_required=False,
            candidate_hash=artifact_obj.sha256,
            base_source_file_hash=artifact_obj.base_source_file_hash,
            base_chapter_version_id=None,
        )
    )
    session.commit()

    try:
        ReviewPublishService(session, model_client=FakeModelClient("{}")).publish_artifact(
            artifact_obj.id,
            approved_by_user=True,
        )
    except ReviewPublishError as exc:
        assert "Only chapter artifacts" in str(exc)
    else:
        raise AssertionError("settings proposals must not publish through the default chapter workflow")

    assert (content_root / "settings" / "world.md").read_text(encoding="utf-8") == "# World\nOld setting line."
    get_settings.cache_clear()
