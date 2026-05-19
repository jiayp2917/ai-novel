from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session

from backend.app.db.base import Base
from backend.app.db.models import (
    Annotation,
    AnnotationInsight,
    Artifact,
    Event,
    Job,
    MemoryItem,
    ModelCall,
    PublishDecision,
    Review,
)
from backend.app.repositories import Repository
from backend.app.schemas import ChapterCreate, ChapterVersionCreate, SourceFileCreate
from backend.app.services.catalog import CatalogService


HASH = "a" * 64


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def test_all_stage_two_tables_are_declared() -> None:
    session = make_session()
    table_names = set(inspect(session.bind).get_table_names())

    assert {
        "source_files",
        "chapters",
        "chapter_versions",
        "annotations",
        "annotation_insights",
        "memory_items",
        "jobs",
        "artifacts",
        "reviews",
        "publish_decisions",
        "model_calls",
        "events",
    } <= table_names


def test_catalog_service_creates_chapter_and_version() -> None:
    session = make_session()
    service = CatalogService(session)

    source_file = service.create_source_file(
        SourceFileCreate(
            path="content/chapters/chapter-001.md",
            kind="chapters",
            sha256=HASH,
            mtime=1.0,
            size=120,
        )
    )
    chapter = service.create_chapter(
        ChapterCreate(
            chapter_no=1,
            title="Chapter 001 Test",
            source_file_id=source_file.id,
            range_start=0,
            range_end=120,
        )
    )
    version = service.create_chapter_version(
        ChapterVersionCreate(
            chapter_id=chapter.id,
            source_file_id=source_file.id,
            body_hash="b" * 64,
            source_file_hash=source_file.sha256,
            title=chapter.title,
            range_start=0,
            range_end=120,
        )
    )
    service.chapters.update(chapter, {"current_version_id": version.id})

    session.commit()
    stored = service.chapters.get(chapter.id)

    assert stored is not None
    assert stored.current_version_id == version.id
    assert stored.source_file.path == "content/chapters/chapter-001.md"


def test_repository_crud_for_review_rows() -> None:
    session = make_session()
    artifact = Repository(session, Artifact).create(
        {
            "kind": "candidate",
            "path": "runtime/artifacts/candidate.md",
            "sha256": HASH,
            "metadata_json": "{}",
        }
    )
    review = Repository(session, Review).create(
        {
            "artifact_id": artifact.id,
            "passed": True,
            "issues_json": "[]",
            "evidence_count": 0,
            "manual_required": False,
        }
    )

    repo = Repository(session, Review)
    repo.update(review, {"passed": False, "manual_required": True})

    assert repo.get(review.id).passed is False
    assert repo.get(review.id).manual_required is True

    repo.delete(review)
    assert repo.get(review.id) is None


def test_supporting_tables_can_create_rows() -> None:
    session = make_session()

    insight = Repository(session, AnnotationInsight).create(
        {
            "kind": "style_preference",
            "content": "Prefer short sentences.",
            "source_annotation_ids_json": "[]",
            "enabled": True,
            "confidence": 0.9,
        }
    )
    memory_item = Repository(session, MemoryItem).create(
        {
            "kind": "core_fact",
            "scope": "global",
            "content_json": "{}",
            "source_hash": HASH,
        }
    )
    job = Repository(session, Job).create(
        {
            "type": "scan",
            "status": "queued",
            "payload_json": "{}",
        }
    )
    model_call = Repository(session, ModelCall).create(
        {
            "role": "reviewer",
            "provider": "deepseek",
            "model": "deepseek-v4-pro",
            "prompt_hash": HASH,
            "input_chars": 10,
            "output_chars": 20,
            "usage_json": "{}",
            "cache_hit": False,
            "status": "succeeded",
        }
    )
    event = Repository(session, Event).create(
        {
            "event_type": "created",
            "entity_type": "job",
            "entity_id": job.id,
            "payload_json": "{}",
        }
    )

    assert insight.id > 0
    assert memory_item.id > 0
    assert model_call.id > 0
    assert event.entity_id == job.id


def test_annotation_and_publish_decision_rows() -> None:
    session = make_session()
    service = CatalogService(session)
    source_file = service.create_source_file(
        SourceFileCreate(
            path="content/chapters/001.md",
            kind="chapters",
            sha256=HASH,
            mtime=1.0,
            size=100,
        )
    )
    chapter = service.create_chapter(
        ChapterCreate(
            chapter_no=1,
            title="Chapter 001",
            source_file_id=source_file.id,
            range_start=0,
            range_end=100,
        )
    )
    version = service.create_chapter_version(
        ChapterVersionCreate(
            chapter_id=chapter.id,
            source_file_id=source_file.id,
            body_hash="b" * 64,
            source_file_hash=HASH,
            title=chapter.title,
            range_start=0,
            range_end=100,
        )
    )
    artifact = Repository(session, Artifact).create(
        {
            "kind": "candidate",
            "path": "runtime/artifacts/candidate.md",
            "sha256": "c" * 64,
            "base_source_file_id": source_file.id,
            "base_source_file_hash": source_file.sha256,
            "base_chapter_id": chapter.id,
            "base_chapter_version_id": version.id,
            "metadata_json": "{}",
        }
    )

    annotation = Repository(session, Annotation).create(
        {
            "chapter_id": chapter.id,
            "chapter_version_id": version.id,
            "source_file_id": source_file.id,
            "source_file_hash_at_create": source_file.sha256,
            "chapter_body_hash_at_create": version.body_hash,
            "range_start": 0,
            "range_end": 4,
            "quote_text": "test",
            "quote_hash": "d" * 64,
            "prefix_text": "",
            "suffix_text": "",
            "type": "logic",
            "severity": "medium",
            "comment": "Needs to be clearer.",
            "status": "open",
        }
    )
    decision = Repository(session, PublishDecision).create(
        {
            "artifact_id": artifact.id,
            "approved_by_user": True,
            "force": False,
            "source_hash_before": source_file.sha256,
            "candidate_hash": artifact.sha256,
            "diff_path": "runtime/diffs/001.diff",
            "backup_path": "runtime/backups/001.md",
        }
    )

    assert annotation.chapter_version_id == version.id
    assert decision.candidate_hash == artifact.sha256
