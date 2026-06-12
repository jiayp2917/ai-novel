import json
from dataclasses import dataclass, field
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from backend.app.core.config import get_settings
from backend.app.db.base import Base
from backend.app.db.models import Artifact, Chapter, ChapterVersion, Job, MemoryItem
from backend.app.db.session import get_engine, reset_engine
from backend.app.main import app
from backend.app.services.annotations import AnnotationService
from backend.app.services.context_builder import ContextBuilder
from backend.app.services.library import LibraryScanner
from backend.app.services.memory import MemoryService
from backend.app.services.model_client import ChatMessage
from backend.app.services.revision import RevisionService
from backend.app.schemas import AnnotationRequest
from backend.app.utils.hashing import sha256_file


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def seed_project(root: Path) -> None:
    write(root / "settings" / "world.md", "# World\nCore rule.\n" + ("Long fact.\n" * 20))
    write(root / "outlines" / "outline.md", "# \u7b2c001\u7ae0 First\nGoal line\n- Event")
    write(root / "chapters" / "book.md", "# \u7b2c001\u7ae0 First\nAlpha target text.\nBeta follows.")


def create_annotation(session: Session) -> int:
    chapter = session.scalars(select(Chapter)).first()
    assert chapter is not None
    text = "# \u7b2c001\u7ae0 First\nAlpha target text.\nBeta follows."
    start = text.index("target")
    annotation = AnnotationService(session).create_for_chapter(
        chapter.id,
        AnnotationRequest(
            range_start=start,
            range_end=start + len("target"),
            type="logic",
            severity="medium",
            comment="Fix this local issue.",
        ),
    )
    return annotation.id


@dataclass
class FakeRoute:
    role: str = "fixer"
    provider: str = "fake"
    model: str = "fake-model"


@dataclass
class FakeResponse:
    content: str
    model_call_id: int = 123
    route: FakeRoute = field(default_factory=FakeRoute)


class FakeModelClient:
    def __init__(self, content: str) -> None:
        self.content = content
        self.messages: list[ChatMessage] = []

    def chat(self, *, role: str, messages: list[ChatMessage], **kwargs) -> FakeResponse:
        self.messages = messages
        return FakeResponse(self.content)


def test_context_builder_creates_report_when_budget_degraded(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    seed_project(content_root)
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    monkeypatch.setenv("MAX_INPUT_CHARS_PER_CALL", "180")
    get_settings.cache_clear()
    session = make_session()
    LibraryScanner(session, content_root).scan()
    MemoryService(session, content_root).rebuild()
    annotation_id = create_annotation(session)

    result = ContextBuilder(session).build(chapter_id=1, annotation_ids=[annotation_id], task_type="revise_from_annotations")

    assert result.report["context_degraded"] is True
    assert result.report["task_profile"]["include_core_facts"] is True
    assert result.report_artifact_id is not None
    artifact = session.get(Artifact, result.report_artifact_id)
    assert artifact is not None
    assert artifact.kind == "context_report"
    assert "Task type: revise_from_annotations" in result.context
    get_settings.cache_clear()


def test_context_builder_uses_smaller_profile_for_summary_tasks(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    seed_project(content_root)
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    monkeypatch.setenv("MAX_INPUT_CHARS_PER_CALL", "20000")
    get_settings.cache_clear()
    session = make_session()
    LibraryScanner(session, content_root).scan()
    MemoryService(session, content_root).rebuild()

    result = ContextBuilder(session).build(chapter_id=1, annotation_ids=[], task_type="summarize_published_chapter")

    section_names = {section["name"] for section in result.report["selected_sections"]}
    assert "chapter_text" in section_names
    assert "core_facts" not in section_names
    assert "structured_state" not in section_names
    assert result.report["task_profile"]["include_core_facts"] is False
    get_settings.cache_clear()


def test_context_builder_includes_structured_short_memory_for_review_tasks(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    seed_project(content_root)
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    monkeypatch.setenv("MAX_INPUT_CHARS_PER_CALL", "20000")
    get_settings.cache_clear()
    session = make_session()
    LibraryScanner(session, content_root).scan()
    MemoryService(session, content_root).rebuild()

    result = ContextBuilder(session).build(chapter_id=1, annotation_ids=[], task_type="review_chapter_candidate")

    section_names = {section["name"] for section in result.report["selected_sections"]}
    assert {"skills", "chapter_card", "rolling_summary", "core_facts", "structured_state", "timeline"} <= section_names
    assert "## rolling_summary" in result.context
    assert "## skills" in result.context
    assert "evidence_guard" in result.context
    assert "hallucination_guard" in result.context
    skill_paths = {skill["path"] for skill in result.report["skills"]}
    assert {"review/evidence_guard.md", "review/hallucination_guard.md"} <= skill_paths
    assert all(skill["sha256"] for skill in result.report["skills"])
    get_settings.cache_clear()


def test_context_builder_loads_fix_skills_for_revision_tasks(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    seed_project(content_root)
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    monkeypatch.setenv("MAX_INPUT_CHARS_PER_CALL", "20000")
    get_settings.cache_clear()
    session = make_session()
    LibraryScanner(session, content_root).scan()
    MemoryService(session, content_root).rebuild()

    result = ContextBuilder(session).build(chapter_id=1, annotation_ids=[], task_type="revise_from_annotations")

    assert "## skills" in result.context
    assert "no_new_setting" in result.context
    assert "patch_rules" in result.context
    skill_paths = {skill["path"] for skill in result.report["skills"]}
    assert {"fix/no_new_setting.md", "fix/patch_rules.md"} <= skill_paths
    get_settings.cache_clear()


def test_revision_creates_candidate_artifact_without_writing_source(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    seed_project(content_root)
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    monkeypatch.setenv("MAX_INPUT_CHARS_PER_CALL", "20000")
    get_settings.cache_clear()
    session = make_session()
    LibraryScanner(session, content_root).scan()
    MemoryService(session, content_root).rebuild()
    annotation_id = create_annotation(session)
    original = (content_root / "chapters" / "book.md").read_text(encoding="utf-8")
    revised = "# \u7b2c001\u7ae0 First\nAlpha revised target text.\nBeta follows."

    result = RevisionService(session, model_client=FakeModelClient(revised)).revise_from_annotations(
        chapter_id=1,
        annotation_ids=[annotation_id],
    )

    assert result["status"] == "queued"
    job = session.get(Job, result["job_id"])
    assert job is not None
    job.status = "running"
    session.commit()
    run_result = RevisionService(session, model_client=FakeModelClient(revised)).run_revision_job(result["job_id"])
    artifact = session.get(Artifact, run_result["artifact_id"])
    assert artifact is not None
    artifact_path = runtime_root / artifact.path
    assert artifact_path.read_text(encoding="utf-8") == revised
    assert artifact.sha256 == sha256_file(artifact_path)
    assert (content_root / "chapters" / "book.md").read_text(encoding="utf-8") == original
    job = session.get(Job, result["job_id"])
    assert job is not None
    assert job.status == "succeeded"
    get_settings.cache_clear()


def test_revision_api_queues_job_without_model_call(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    content_root = tmp_path / "content"
    seed_project(content_root)
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(tmp_path / "runtime"))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(tmp_path / "runtime"))
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())
    with Session(get_engine()) as session:
        LibraryScanner(session, content_root).scan()
        annotation_id = create_annotation(session)
        chapter = session.scalars(select(Chapter)).first()
        assert chapter is not None
        chapter_id = chapter.id

    client = TestClient(app)
    response = client.post(
        f"/api/chapters/{chapter_id}/revise-from-annotations",
        json={"annotation_ids": [annotation_id]},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "queued"
    with Session(get_engine()) as session:
        job = session.get(Job, response.json()["job_id"])
        assert job is not None
        assert job.status == "queued"
    get_settings.cache_clear()
    reset_engine()


def test_draft_candidate_api_creates_artifact_without_writing_source(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    seed_project(content_root)
    original = (content_root / "chapters" / "book.md").read_text(encoding="utf-8")
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())
    with Session(get_engine()) as session:
        LibraryScanner(session, content_root).scan()
        chapter = session.scalars(select(Chapter)).first()
        assert chapter is not None
        chapter_id = chapter.id

    client = TestClient(app)
    draft = "# 第001章 First\nEdited draft text."
    response = client.post(f"/api/chapters/{chapter_id}/draft-candidate", json={"text": draft})

    assert response.status_code == 200
    assert isinstance(response.json()["version_id"], int)
    with Session(get_engine()) as session:
        artifact = session.get(Artifact, response.json()["artifact_id"])
        version = session.get(ChapterVersion, response.json()["version_id"])
        assert artifact is not None
        assert version is not None
        assert artifact.kind == "candidate"
        assert artifact.base_chapter_id == chapter_id
        assert version.chapter_id == chapter_id
        assert version.text_snapshot_path is not None
        metadata = json.loads(artifact.metadata_json)
        assert metadata["source"] == "manual_editor_draft"
        assert metadata["requires_ai_review"] is False
        assert (runtime_root / artifact.path).read_text(encoding="utf-8") == draft
        assert (runtime_root / version.text_snapshot_path).read_text(encoding="utf-8") == draft
    assert (content_root / "chapters" / "book.md").read_text(encoding="utf-8") == original
    get_settings.cache_clear()


def test_context_builder_prefers_confirmed_writing_card_and_includes_work_profile(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    seed_project(content_root)
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    monkeypatch.setenv("MAX_INPUT_CHARS_PER_CALL", "20000")
    get_settings.cache_clear()
    session = make_session()
    LibraryScanner(session, content_root).scan()
    MemoryService(session, content_root).rebuild()
    session.add_all(
        [
            MemoryItem(
                kind="chapter_card",
                scope="1",
                content_json=json.dumps(
                    {
                        "source": "confirmed_writing_card",
                        "chapter_no": 1,
                        "card_markdown": "confirmed card enters writer context",
                        "artifact_id": 77,
                        "artifact_sha256": "a" * 64,
                        "generation_mode": "stable",
                    },
                    ensure_ascii=False,
                ),
                source_hash="a" * 64,
                stale=False,
            ),
            MemoryItem(
                kind="work_profile",
                scope="global",
                content_json=json.dumps(
                    {
                        "source": "confirmed_work_profile",
                        "profile_markdown": "confirmed work profile context",
                        "artifact_id": 88,
                        "artifact_sha256": "b" * 64,
                    },
                    ensure_ascii=False,
                ),
                source_hash="b" * 64,
                stale=False,
            ),
        ]
    )
    session.commit()

    result = ContextBuilder(session).build(
        chapter_id=1,
        annotation_ids=[],
        task_type="generate_chapter_draft",
        generation_mode="stable",
    )

    assert "confirmed card enters writer context" in result.context
    assert "confirmed work profile context" in result.context
    assert result.report["generation_mode"] == "stable"
    assert result.report["writing_card"]["artifact_id"] == 77
    assert any(source["kind"] == "work_profile" for source in result.report["memory_sources"])
    get_settings.cache_clear()
    reset_engine()


def test_delete_chapter_version_removes_non_current_snapshot(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    seed_project(content_root)
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())
    with Session(get_engine()) as session:
        LibraryScanner(session, content_root).scan()
        chapter = session.scalars(select(Chapter)).first()
        assert chapter is not None
        chapter_id = chapter.id

    client = TestClient(app)
    draft = "# 第001章 First\nVersion to delete."
    created = client.post(f"/api/chapters/{chapter_id}/draft-candidate", json={"text": draft})
    assert created.status_code == 200
    version_id = created.json()["version_id"]
    with Session(get_engine()) as session:
        version = session.get(ChapterVersion, version_id)
        assert version is not None
        assert version.text_snapshot_path is not None
        snapshot_path = runtime_root / version.text_snapshot_path
        assert snapshot_path.exists()

    deleted = client.delete(f"/api/chapters/{chapter_id}/versions/{version_id}")

    assert deleted.status_code == 200
    assert deleted.json()["deleted"] is True
    with Session(get_engine()) as session:
        assert session.get(ChapterVersion, version_id) is None
    assert not snapshot_path.exists()
    get_settings.cache_clear()
    reset_engine()


def test_delete_current_chapter_version_is_rejected(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    seed_project(content_root)
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())
    with Session(get_engine()) as session:
        LibraryScanner(session, content_root).scan()
        chapter = session.scalars(select(Chapter)).first()
        assert chapter is not None
        chapter_id = chapter.id
        current_version_id = chapter.current_version_id

    client = TestClient(app)
    deleted = client.delete(f"/api/chapters/{chapter_id}/versions/{current_version_id}")

    assert deleted.status_code == 400
    assert "Current chapter version cannot be deleted" in deleted.json()["detail"]
    with Session(get_engine()) as session:
        assert session.get(ChapterVersion, current_version_id) is not None
    get_settings.cache_clear()
    reset_engine()


def test_draft_proposal_api_creates_artifact_without_writing_source(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    seed_project(content_root)
    original = (content_root / "settings" / "world.md").read_text(encoding="utf-8")
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())
    with Session(get_engine()) as session:
        LibraryScanner(session, content_root).scan()
        source = session.scalars(select(Artifact)).first()
        assert source is None
        from backend.app.db.models import SourceFile

        setting = session.scalars(select(SourceFile).where(SourceFile.kind == "settings")).first()
        assert setting is not None
        source_file_id = setting.id

    client = TestClient(app)
    draft = "# World\nEdited setting proposal."
    response = client.post(f"/api/source-files/{source_file_id}/draft-proposal", json={"text": draft})

    assert response.status_code == 200
    with Session(get_engine()) as session:
        artifact = session.get(Artifact, response.json()["artifact_id"])
        assert artifact is not None
        assert artifact.kind == "proposal"
        assert artifact.base_source_file_id == source_file_id
        assert (runtime_root / artifact.path).read_text(encoding="utf-8") == draft
    assert (content_root / "settings" / "world.md").read_text(encoding="utf-8") == original
    get_settings.cache_clear()
    reset_engine()


def test_revision_rejects_duplicate_running_job(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    content_root = tmp_path / "content"
    runtime_root = tmp_path / "runtime"
    seed_project(content_root)
    monkeypatch.setenv("CONTENT_ROOT", str(content_root))
    monkeypatch.setenv("RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(runtime_root))
    get_settings.cache_clear()
    session = make_session()
    LibraryScanner(session, content_root).scan()
    chapter = session.scalars(select(Chapter)).first()
    assert chapter is not None
    session.add(
        Job(
            type="revise_from_annotations",
            status="running",
            payload_json="{}",
            locked_chapter_id=chapter.id,
            locked_source_file_id=chapter.source_file_id,
        )
    )
    session.commit()

    with pytest.raises(ValueError, match="running revision job"):
        RevisionService(session, model_client=FakeModelClient("x")).revise_from_annotations(
            chapter_id=chapter.id,
            annotation_ids=[],
        )
    get_settings.cache_clear()


def test_revision_api_route_registered(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("CONTENT_ROOT", str(tmp_path / "content"))
    monkeypatch.setenv("RUNTIME_ROOT", str(tmp_path / "runtime"))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(tmp_path / "runtime"))
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())
    routes = {route.path for route in app.routes}
    assert "/api/chapters/{chapter_id}/revise-from-annotations" in routes
    get_settings.cache_clear()
    reset_engine()
