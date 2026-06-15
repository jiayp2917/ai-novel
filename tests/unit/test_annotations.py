from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from backend.app.db.base import Base
from backend.app.db.models import Annotation
from backend.app.schemas import AnnotationRequest, AnnotationUpdate
from backend.app.services.annotations import AnnotationService
from backend.app.services.library import LibraryScanner
from backend.app.utils.hashing import sha256_text


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def seed_chapter(content: Path, text: str = "# 第001章 First\nAlpha target text") -> None:
    write(content / "chapters" / "book.md", text)


def chapter_text(text: str = "# 第001章 First\nAlpha target text") -> str:
    return text


def test_create_annotation_saves_quote_hash_and_context(tmp_path: Path) -> None:
    content = tmp_path / "content"
    seed_chapter(content)
    session = make_session()
    LibraryScanner(session, content).scan()

    service = AnnotationService(session, content)
    text = chapter_text()
    start = text.index("target")
    annotation = service.create_for_chapter(
        1,
        AnnotationRequest(
            range_start=start,
            range_end=start + len("target"),
            type="logic",
            severity="medium",
            comment="Check target.",
        ),
    )

    assert annotation.quote_text == "target"
    assert annotation.quote_hash == sha256_text("target")
    assert annotation.prefix_text.endswith("Alpha ")
    assert annotation.suffix_text.startswith(" text")


def test_update_annotation_changes_status_and_range(tmp_path: Path) -> None:
    content = tmp_path / "content"
    seed_chapter(content)
    session = make_session()
    LibraryScanner(session, content).scan()
    service = AnnotationService(session, content)
    text = chapter_text()
    start = text.index("target")
    annotation = service.create_for_chapter(
        1,
        AnnotationRequest(range_start=start, range_end=start + len("target"), type="logic", severity="medium", comment="Check target."),
    )
    alpha_start = text.index("Alpha")

    updated = service.update(
        annotation.id,
        AnnotationUpdate(range_start=alpha_start, range_end=alpha_start + len("Alpha"), status="ignored"),
    )

    assert updated.quote_text == "Alpha"
    assert updated.status == "ignored"
    assert updated.prefix_text.endswith("First\n")
    assert updated.suffix_text.startswith(" target")


def test_delete_annotation_removes_row(tmp_path: Path) -> None:
    content = tmp_path / "content"
    seed_chapter(content)
    session = make_session()
    LibraryScanner(session, content).scan()
    service = AnnotationService(session, content)
    annotation = service.create_for_chapter(
        1,
        AnnotationRequest(range_start=19, range_end=25, type="logic", severity="medium", comment="Check target."),
    )

    service.delete(annotation.id)

    assert session.scalar(select(Annotation).where(Annotation.id == annotation.id)) is None


def test_relocate_annotation_unique_match(tmp_path: Path) -> None:
    content = tmp_path / "content"
    chapter_path = content / "chapters" / "book.md"
    seed_chapter(content)
    session = make_session()
    LibraryScanner(session, content).scan()
    service = AnnotationService(session, content)
    text = chapter_text()
    start = text.index("target")
    annotation = service.create_for_chapter(
        1,
        AnnotationRequest(range_start=start, range_end=start + len("target"), type="logic", severity="medium", comment="Check target."),
    )

    changed = "# 第001章 First\nMoved words before target and after"
    write(chapter_path, changed)
    LibraryScanner(session, content).scan()
    relocated = service.relocate(annotation.id)

    assert relocated.status == "open"
    assert relocated.range_start == changed.index("target")


def test_relocate_annotation_marks_needs_relocate_when_missing(tmp_path: Path) -> None:
    content = tmp_path / "content"
    chapter_path = content / "chapters" / "book.md"
    seed_chapter(content)
    session = make_session()
    LibraryScanner(session, content).scan()
    service = AnnotationService(session, content)
    text = chapter_text()
    start = text.index("target")
    annotation = service.create_for_chapter(
        1,
        AnnotationRequest(range_start=start, range_end=start + len("target"), type="logic", severity="medium", comment="Check target."),
    )

    write(chapter_path, "# 第001章 First\nMoved words before replacement")
    LibraryScanner(session, content).scan()
    relocated = service.relocate(annotation.id)

    assert relocated.status == "needs_relocate"


def test_relocate_rejects_terminal_status(tmp_path: Path) -> None:
    content = tmp_path / "content"
    seed_chapter(content)
    session = make_session()
    LibraryScanner(session, content).scan()
    service = AnnotationService(session, content)
    text = chapter_text()
    start = text.index("target")
    annotation = service.create_for_chapter(
        1,
        AnnotationRequest(range_start=start, range_end=start + len("target"), type="logic", severity="medium", comment="Check target."),
    )
    service.update(annotation.id, AnnotationUpdate(status="resolved"))

    try:
        service.relocate(annotation.id)
    except ValueError as exc:
        assert "Terminal annotation" in str(exc)
    else:
        raise AssertionError("Expected terminal annotation relocation to fail")
