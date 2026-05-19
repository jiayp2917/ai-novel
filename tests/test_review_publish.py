from dataclasses import dataclass, field
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from backend.app.core.config import get_settings
from backend.app.db.base import Base
from backend.app.db.models import Artifact, Chapter, Event, PublishDecision, Review, SourceFile
from backend.app.schemas import AnnotationRequest
from backend.app.services.annotations import AnnotationService
from backend.app.services.artifacts import ArtifactStore
from backend.app.services.library import LibraryScanner
from backend.app.services.memory import MemoryService
from backend.app.services.model_client import ChatMessage
from backend.app.services.review_publish import ReviewPublishError, ReviewPublishService
from backend.app.utils.hashing import sha256_file


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def seed_project(root: Path) -> str:
    text = "# \u7b2c001\u7ae0 First\nAlpha target text.\n\n# \u7b2c002\u7ae0 Second\nSecond chapter stays."
    write(root / "settings" / "world.md", "# World\nCore rule.")
    write(root / "outlines" / "outline.md", "# \u7b2c001\u7ae0 First\nGoal line")
    write(root / "chapters" / "book.md", text)
    return text


@dataclass
class FakeRoute:
    role: str = "reviewer"
    provider: str = "fake"
    model: str = "fake-reviewer"


@dataclass
class FakeResponse:
    content: str
    model_call_id: int = 77
    route: FakeRoute = field(default_factory=FakeRoute)


class FakeReviewer:
    def __init__(self, content: str) -> None:
        self.content = content
        self.messages: list[ChatMessage] = []

    def chat(self, *, role: str, messages: list[ChatMessage], **kwargs) -> FakeResponse:
        self.messages = messages
        return FakeResponse(self.content)


def setup_candidate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Session, Artifact, Path, str]:
    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    original = seed_project(content_root)
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    get_settings.cache_clear()
    session = make_session()
    LibraryScanner(session, content_root).scan()
    MemoryService(session, content_root).rebuild()
    chapter = session.scalars(select(Chapter).order_by(Chapter.chapter_no)).first()
    assert chapter is not None
    AnnotationService(session).create_for_chapter(
        chapter.id,
        AnnotationRequest(
            range_start=original.index("target"),
            range_end=original.index("target") + len("target"),
            type="logic",
            severity="medium",
            comment="Fix target.",
        ),
    )
    candidate_text = "# \u7b2c001\u7ae0 First\nAlpha revised target text."
    artifact = ArtifactStore(session).save_text(
        kind="candidate",
        text=candidate_text,
        metadata={"test": True},
        base_chapter=chapter,
    )
    session.commit()
    return session, artifact, content_root, original


def test_review_normalizes_missing_evidence_to_manual_required(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, artifact, _, _ = setup_candidate(tmp_path, monkeypatch)
    reviewer = FakeReviewer(
        '{"passed": true, "issues": [{"chapter": 1, "severity": "low", "type": "logic", "description": "guess", "owner": "writer", "fix_instruction": "fix"}]}'
    )

    result = ReviewPublishService(session, model_client=reviewer).review_artifact(artifact.id)

    assert result["passed"] is False
    assert result["manual_required"] is True
    assert result["issues"][0]["owner"] == "admin"
    assert result["issues"][0]["severity"] == "blocking"
    get_settings.cache_clear()


def test_publish_requires_approval_and_passed_review(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, artifact, _, _ = setup_candidate(tmp_path, monkeypatch)
    service = ReviewPublishService(session, model_client=FakeReviewer('{"passed": true, "issues": []}'))
    service.review_artifact(artifact.id)

    with pytest.raises(ReviewPublishError, match="approved_by_user"):
        service.publish_artifact(artifact.id, approved_by_user=False)

    failed_artifact = artifact
    session.add(
        Review(
            artifact_id=failed_artifact.id,
            passed=False,
            issues_json="[]",
            evidence_count=0,
            manual_required=False,
            candidate_hash=failed_artifact.sha256,
            base_source_file_hash=failed_artifact.base_source_file_hash,
            base_chapter_version_id=failed_artifact.base_chapter_version_id,
        )
    )
    session.commit()
    with pytest.raises(ReviewPublishError, match="Review did not pass"):
        service.publish_artifact(failed_artifact.id, approved_by_user=True)
    get_settings.cache_clear()


def test_publish_rejects_tampered_artifact(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, artifact, _, _ = setup_candidate(tmp_path, monkeypatch)
    service = ReviewPublishService(session, model_client=FakeReviewer('{"passed": true, "issues": []}'))
    service.review_artifact(artifact.id)
    (get_settings().runtime_root / artifact.path).write_text("tampered", encoding="utf-8")

    with pytest.raises(ReviewPublishError, match="hash mismatch"):
        service.publish_artifact(artifact.id, approved_by_user=True)
    get_settings.cache_clear()


def test_review_parse_failure_saves_raw_review_artifact(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, artifact, _, _ = setup_candidate(tmp_path, monkeypatch)

    with pytest.raises(ReviewPublishError, match="raw_artifact_id"):
        ReviewPublishService(session, model_client=FakeReviewer("not-json")).review_artifact(artifact.id)

    raw = session.scalar(select(Artifact).where(Artifact.kind == "review"))
    assert raw is not None
    assert (get_settings().runtime_root / raw.path).read_text(encoding="utf-8") == "not-json"
    get_settings.cache_clear()


def test_review_non_object_json_becomes_manual_required(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, artifact, _, _ = setup_candidate(tmp_path, monkeypatch)

    result = ReviewPublishService(session, model_client=FakeReviewer("[]")).review_artifact(artifact.id)

    assert result["passed"] is False
    assert result["manual_required"] is True
    get_settings.cache_clear()


def test_diff_rejects_tampered_artifact(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, artifact, _, _ = setup_candidate(tmp_path, monkeypatch)
    (get_settings().runtime_root / artifact.path).write_text("tampered", encoding="utf-8")

    with pytest.raises(ReviewPublishError, match="hash mismatch"):
        ReviewPublishService(session, model_client=FakeReviewer("{}")).diff_artifact(artifact.id)
    get_settings.cache_clear()


def test_diff_preview_does_not_write_diff_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, artifact, _, _ = setup_candidate(tmp_path, monkeypatch)

    result = ReviewPublishService(session, model_client=FakeReviewer("{}")).diff_artifact(artifact.id)

    assert "revised target" in result["diff"]
    assert result["path"] is None
    assert not (get_settings().runtime_root / "diffs" / f"artifact_{artifact.id}.diff").exists()
    get_settings.cache_clear()


def test_publish_rejects_changed_source_hash(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, artifact, content_root, _ = setup_candidate(tmp_path, monkeypatch)
    service = ReviewPublishService(session, model_client=FakeReviewer('{"passed": true, "issues": []}'))
    service.review_artifact(artifact.id)
    write(content_root / "chapters" / "book.md", "# \u7b2c001\u7ae0 First\nExternal change.")

    with pytest.raises(ReviewPublishError, match="Source file hash changed"):
        service.publish_artifact(artifact.id, approved_by_user=True)
    get_settings.cache_clear()


def test_publish_replaces_only_target_chapter_and_records_audit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, artifact, content_root, _ = setup_candidate(tmp_path, monkeypatch)
    service = ReviewPublishService(session, model_client=FakeReviewer('{"passed": true, "issues": []}'))
    service.review_artifact(artifact.id)

    result = service.publish_artifact(artifact.id, approved_by_user=True)
    published = (content_root / "chapters" / "book.md").read_text(encoding="utf-8")

    assert "Alpha revised target text." in published
    assert "# \u7b2c002\u7ae0 Second\nSecond chapter stays." in published
    assert (get_settings().runtime_root / result["backup_path"]).exists()
    assert (get_settings().runtime_root / result["diff_path"]).exists()
    assert session.scalar(select(PublishDecision)) is not None
    assert session.scalar(select(Event).where(Event.event_type == "artifact_published")) is not None
    get_settings.cache_clear()


def test_publish_rejects_heading_and_title_changes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, artifact, _, _ = setup_candidate(tmp_path, monkeypatch)
    service = ReviewPublishService(session, model_client=FakeReviewer('{"passed": true, "issues": []}'))
    service.review_artifact(artifact.id)
    path = get_settings().runtime_root / artifact.path
    path.write_text("No heading", encoding="utf-8")
    artifact.sha256 = sha256_file(path)
    review = session.scalar(select(Review).where(Review.artifact_id == artifact.id))
    assert review is not None
    review.candidate_hash = artifact.sha256
    session.commit()
    with pytest.raises(ReviewPublishError, match="must start"):
        service.publish_artifact(artifact.id, approved_by_user=True)

    path.write_text("# \u7b2c001\u7ae0 Changed\nBody", encoding="utf-8")
    artifact.sha256 = sha256_file(path)
    review.candidate_hash = artifact.sha256
    session.commit()
    with pytest.raises(ReviewPublishError, match="title changed"):
        service.publish_artifact(artifact.id, approved_by_user=True)
    get_settings.cache_clear()


def test_publish_rejects_artifact_path_escape(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, artifact, _, _ = setup_candidate(tmp_path, monkeypatch)
    artifact.path = "../escape.md"
    session.commit()

    with pytest.raises(ReviewPublishError, match="escapes runtime"):
        ReviewPublishService(session, model_client=FakeReviewer("{}")).diff_artifact(artifact.id)
    get_settings.cache_clear()


def test_publish_rejects_review_binding_mismatch(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, artifact, _, _ = setup_candidate(tmp_path, monkeypatch)
    service = ReviewPublishService(session, model_client=FakeReviewer('{"passed": true, "issues": []}'))
    service.review_artifact(artifact.id)
    review = session.scalar(select(Review).where(Review.artifact_id == artifact.id))
    assert review is not None
    review.candidate_hash = "x" * 64
    session.commit()

    with pytest.raises(ReviewPublishError, match="candidate hash"):
        service.publish_artifact(artifact.id, approved_by_user=True)
    get_settings.cache_clear()


def test_publish_rejects_settings_and_outline_artifacts(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, _, _, _ = setup_candidate(tmp_path, monkeypatch)
    setting = session.scalar(select(SourceFile).where(SourceFile.kind == "settings"))
    assert setting is not None
    artifact = ArtifactStore(session).save_text(
        kind="proposal",
        text="# World\nChanged rule.",
        metadata={"test": True},
        base_source_file=setting,
    )
    session.add(
        Review(
            artifact_id=artifact.id,
            passed=True,
            issues_json="[]",
            evidence_count=0,
            manual_required=False,
            candidate_hash=artifact.sha256,
            base_source_file_hash=artifact.base_source_file_hash,
            base_chapter_version_id=artifact.base_chapter_version_id,
        )
    )
    session.commit()

    with pytest.raises(ReviewPublishError, match="Only chapter artifacts"):
        ReviewPublishService(session, model_client=FakeReviewer("{}")).publish_artifact(artifact.id, approved_by_user=True)
    get_settings.cache_clear()


def test_publish_rejects_chapter_bound_non_candidate_artifacts(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, _, _, _ = setup_candidate(tmp_path, monkeypatch)
    chapter = session.scalar(select(Chapter).where(Chapter.chapter_no == 1))
    assert chapter is not None
    artifact = ArtifactStore(session).save_text(
        kind="proposal",
        text="# 第001章 First\nWrong kind.",
        metadata={"test": True},
        base_chapter=chapter,
    )
    session.add(
        Review(
            artifact_id=artifact.id,
            passed=True,
            issues_json="[]",
            evidence_count=0,
            manual_required=False,
            candidate_hash=artifact.sha256,
            base_source_file_hash=artifact.base_source_file_hash,
            base_chapter_version_id=artifact.base_chapter_version_id,
        )
    )
    session.commit()

    with pytest.raises(ReviewPublishError, match="Only chapter artifacts"):
        ReviewPublishService(session, model_client=FakeReviewer("{}")).publish_artifact(artifact.id, approved_by_user=True)
    get_settings.cache_clear()


def test_artifact_list_api_filters_by_chapter(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    get_settings.cache_clear()
    from backend.app.db.session import get_engine, reset_engine
    from backend.app.main import app

    reset_engine()
    seed_project(content_root)
    Base.metadata.create_all(get_engine())
    client = TestClient(app)
    assert client.post("/api/library/scan").status_code == 200
    chapters = client.get("/api/chapters").json()
    chapter_id = chapters[0]["id"]

    with Session(get_engine()) as session:
        chapter = session.get(Chapter, chapter_id)
        assert chapter is not None
        ArtifactStore(session).save_text(kind="candidate", text="# 第001章 First\nCandidate.", metadata={}, base_chapter=chapter)
        session.commit()

    response = client.get(f"/api/artifacts?base_chapter_id={chapter_id}&kind=candidate")
    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["kind"] == "candidate"
    assert payload[0]["base_chapter_id"] == chapter_id

    detail = client.get(f"/api/artifacts/{payload[0]['id']}")
    assert detail.status_code == 200
    assert detail.json()["id"] == payload[0]["id"]
    assert detail.json()["base_chapter_id"] == chapter_id

    missing = client.get("/api/artifacts/999999")
    assert missing.status_code == 404
    get_settings.cache_clear()
    reset_engine()


def test_publish_rechecks_source_hash_inside_source_lock(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    session, artifact, content_root, _ = setup_candidate(tmp_path, monkeypatch)
    service = ReviewPublishService(session, model_client=FakeReviewer('{"passed": true, "issues": []}'))
    service.review_artifact(artifact.id)
    original_diff = service.write_diff_artifact

    def mutate_before_diff(artifact_id: int) -> dict:
        write(content_root / "chapters" / "book.md", "# \u7b2c001\u7ae0 First\nConcurrent edit.")
        return original_diff(artifact_id)

    service.write_diff_artifact = mutate_before_diff  # type: ignore[method-assign]

    with pytest.raises(ReviewPublishError, match="Source file hash changed before publish write"):
        service.publish_artifact(artifact.id, approved_by_user=True)
    get_settings.cache_clear()


def test_publish_rolls_back_file_and_records_event_when_memory_rebuild_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session, artifact, content_root, original = setup_candidate(tmp_path, monkeypatch)
    service = ReviewPublishService(session, model_client=FakeReviewer('{"passed": true, "issues": []}'))
    service.review_artifact(artifact.id)

    def fail_rebuild(self) -> dict:
        raise RuntimeError("memory failed")

    monkeypatch.setattr("backend.app.services.review_publish.MemoryService.rebuild", fail_rebuild)

    with pytest.raises(RuntimeError, match="memory failed"):
        service.publish_artifact(artifact.id, approved_by_user=True)

    assert (content_root / "chapters" / "book.md").read_text(encoding="utf-8") == original
    assert session.scalar(select(Event).where(Event.event_type == "artifact_publish_rolled_back")) is not None
    get_settings.cache_clear()
