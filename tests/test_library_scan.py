from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from backend.app.db.base import Base
from backend.app.db.models import Annotation, Chapter, ChapterVersion, SourceFile
from backend.app.services.library import LibraryScanner, parse_chapters
from backend.app.services.workspace import WorkspaceResolver, detect_workspace
from backend.app.utils.hashing import sha256_text


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_parse_chapters_supports_padded_and_plain_numbers() -> None:
    text = "# 第001章 First\nbody\n# 第2章 Second\nbody"
    chapters = parse_chapters(text)

    assert [chapter.chapter_no for chapter in chapters] == [1, 2]
    assert chapters[0].title == "First"
    assert chapters[1].title == "Second"


def test_parse_chapters_accepts_utf8_bom() -> None:
    chapters = parse_chapters("\ufeff# 第001章 First\nbody")

    assert len(chapters) == 1
    assert chapters[0].chapter_no == 1


def test_scan_records_source_files_and_chapters(tmp_path: Path) -> None:
    content = tmp_path / "content"
    write(content / "settings" / "world.md", "# World\nFacts")
    write(content / "outlines" / "outline.md", "# Outline\nPlan")
    write(content / "chapters" / "book.md", "# 第001章 First\nAlpha\n\n# 第2章 Second\nBeta")

    session = make_session()
    summary = LibraryScanner(session, content).scan()

    source_files = list(session.scalars(select(SourceFile).order_by(SourceFile.path)))
    chapters = list(session.scalars(select(Chapter).order_by(Chapter.chapter_no)))
    versions = list(session.scalars(select(ChapterVersion)))

    assert summary["source_files_seen"] == 3
    assert [source.kind for source in source_files] == ["chapters", "outlines", "settings"]
    assert [chapter.chapter_no for chapter in chapters] == [1, 2]
    assert len(versions) == 2


def test_repeated_scan_is_idempotent(tmp_path: Path) -> None:
    content = tmp_path / "content"
    write(content / "settings" / "world.md", "# World\nFacts")
    write(content / "outlines" / "outline.md", "# Outline\nPlan")
    write(content / "chapters" / "book.md", "# 绗?01绔?First\nAlpha")

    session = make_session()
    first = LibraryScanner(session, content).scan()
    second = LibraryScanner(session, content).scan()

    assert first["source_files_created"] == 3
    assert second["source_files_created"] == 0
    assert second["source_files_seen"] == 3


def test_scan_supports_legacy_workspace_layout(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    write(workspace / "00-系统" / "system.md", "# System\nRules")
    write(workspace / "01-设定" / "setting.md", "# Setting\nFacts")
    write(workspace / "03-章纲" / "第01-02章.md", "## 第1章：First\nGoal\n\n## 第2章：Second\nGoal")
    write(workspace / "02-正文" / "01卷" / "第001章.md", "# 第001章 First\nAlpha")
    write(workspace / "02-正文" / "01卷" / "第002章.md", "# 第002章 Second\nBeta")

    session = make_session()
    summary = LibraryScanner(session, workspace).scan()
    sources = list(session.scalars(select(SourceFile).order_by(SourceFile.path)))
    chapters = list(session.scalars(select(Chapter).order_by(Chapter.chapter_no)))

    assert detect_workspace(workspace).layout == "legacy"
    assert summary["source_files_seen"] == 5
    assert [source.kind for source in sources] == ["settings", "settings", "chapters", "chapters", "outlines"]
    assert [source.path for source in sources][0].startswith("00-系统/")
    assert [chapter.chapter_no for chapter in chapters] == [1, 2]


def test_workspace_resolver_blocks_path_traversal(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    write(workspace / "content" / "settings" / "world.md", "# World")
    resolver = WorkspaceResolver(workspace)

    assert resolver.resolve_source_path("content/settings/world.md").exists()
    try:
        resolver.resolve_source_path("../outside.md")
    except ValueError as exc:
        assert "escapes" in str(exc)
    else:
        raise AssertionError("path traversal should be rejected")


def test_scan_creates_new_version_when_chapter_changes(tmp_path: Path) -> None:
    content = tmp_path / "content"
    chapter_path = content / "chapters" / "book.md"
    write(chapter_path, "# 第001章 First\nAlpha")
    session = make_session()
    LibraryScanner(session, content).scan()

    first_count = session.query(ChapterVersion).count()
    write(chapter_path, "# 第001章 First\nAlpha changed")
    LibraryScanner(session, content).scan()

    chapter = session.scalar(select(Chapter).where(Chapter.chapter_no == 1))
    versions = list(session.scalars(select(ChapterVersion).where(ChapterVersion.chapter_id == chapter.id)))

    assert first_count == 1
    assert len(versions) == 2
    assert chapter.current_version_id == versions[-1].id


def test_scan_does_not_version_unchanged_chapter_when_same_file_changes(tmp_path: Path) -> None:
    content = tmp_path / "content"
    chapter_path = content / "chapters" / "book.md"
    write(chapter_path, "# 第001章 First\nAlpha\n\n# 第2章 Second\nBeta")
    session = make_session()
    LibraryScanner(session, content).scan()

    chapter_one = session.scalar(select(Chapter).where(Chapter.chapter_no == 1))
    first_versions = session.query(ChapterVersion).filter(ChapterVersion.chapter_id == chapter_one.id).count()
    write(chapter_path, "# 第001章 First\nAlpha\n\n# 第2章 Second\nBeta changed")
    LibraryScanner(session, content).scan()

    second_versions = session.query(ChapterVersion).filter(ChapterVersion.chapter_id == chapter_one.id).count()
    assert first_versions == 1
    assert second_versions == 1
    assert chapter_one.range_start == 0


def test_unchanged_later_chapter_keeps_current_range_when_prior_chapter_changes(tmp_path: Path) -> None:
    content = tmp_path / "content"
    chapter_path = content / "chapters" / "book.md"
    write(chapter_path, "# 第001章 First\nAlpha\n\n# 第2章 Second\nBeta")
    session = make_session()
    LibraryScanner(session, content).scan()

    write(chapter_path, "# 第001章 First\nAlpha expanded line\n\n# 第2章 Second\nBeta")
    LibraryScanner(session, content).scan()
    chapter_two = session.scalar(select(Chapter).where(Chapter.chapter_no == 2))
    full_text = chapter_path.read_text(encoding="utf-8")

    assert full_text[chapter_two.range_start : chapter_two.range_end].startswith("# 第2章 Second")


def test_scan_deactivates_missing_files_and_chapters(tmp_path: Path) -> None:
    content = tmp_path / "content"
    chapter_path = content / "chapters" / "book.md"
    write(chapter_path, "# 第001章 First\nAlpha")
    session = make_session()
    LibraryScanner(session, content).scan()

    chapter_path.unlink()
    summary = LibraryScanner(session, content).scan()
    source_file = session.scalar(select(SourceFile))
    chapter = session.scalar(select(Chapter))

    assert summary["source_files_deactivated"] == 1
    assert summary["chapters_deactivated"] == 1
    assert source_file.active is False
    assert chapter.active is False


def test_scan_marks_annotation_needs_relocate_when_quote_missing(tmp_path: Path) -> None:
    content = tmp_path / "content"
    chapter_path = content / "chapters" / "book.md"
    original = "# 第001章 First\nAlpha target text"
    write(chapter_path, original)
    session = make_session()
    LibraryScanner(session, content).scan()
    chapter = session.scalar(select(Chapter).where(Chapter.chapter_no == 1))
    version = chapter.current_version
    source = chapter.source_file

    session.add(
        Annotation(
            chapter_id=chapter.id,
            chapter_version_id=version.id,
            source_file_id=source.id,
            source_file_hash_at_create=source.sha256,
            chapter_body_hash_at_create=version.body_hash,
            range_start=original.index("target"),
            range_end=original.index("target") + len("target"),
            quote_text="target",
            quote_hash=sha256_text("target"),
            prefix_text="Alpha ",
            suffix_text=" text",
            type="logic",
            severity="medium",
            comment="Check target.",
            status="open",
        )
    )
    session.commit()

    write(chapter_path, "# 第001章 First\nAlpha replacement text")
    LibraryScanner(session, content).scan()

    annotation = session.scalar(select(Annotation))
    assert annotation.status == "needs_relocate"


def test_scan_relocates_annotation_when_quote_is_unique(tmp_path: Path) -> None:
    content = tmp_path / "content"
    chapter_path = content / "chapters" / "book.md"
    original = "# 第001章 First\nAlpha target text"
    write(chapter_path, original)
    session = make_session()
    LibraryScanner(session, content).scan()
    chapter = session.scalar(select(Chapter).where(Chapter.chapter_no == 1))
    version = chapter.current_version
    source = chapter.source_file

    session.add(
        Annotation(
            chapter_id=chapter.id,
            chapter_version_id=version.id,
            source_file_id=source.id,
            source_file_hash_at_create=source.sha256,
            chapter_body_hash_at_create=version.body_hash,
            range_start=original.index("target"),
            range_end=original.index("target") + len("target"),
            quote_text="target",
            quote_hash=sha256_text("target"),
            prefix_text="",
            suffix_text="",
            type="logic",
            severity="medium",
            comment="Check target.",
            status="open",
        )
    )
    session.commit()

    changed = "# 第001章 First\nMoved words before target and after"
    write(chapter_path, changed)
    LibraryScanner(session, content).scan()

    annotation = session.scalar(select(Annotation))
    assert annotation.status == "open"
    assert annotation.range_start == changed.index("target")


def test_scan_does_not_relocate_terminal_annotation_status(tmp_path: Path) -> None:
    content = tmp_path / "content"
    chapter_path = content / "chapters" / "book.md"
    original = "# 第001章 First\nAlpha target text"
    write(chapter_path, original)
    session = make_session()
    LibraryScanner(session, content).scan()
    chapter = session.scalar(select(Chapter).where(Chapter.chapter_no == 1))
    version = chapter.current_version
    source = chapter.source_file

    session.add(
        Annotation(
            chapter_id=chapter.id,
            chapter_version_id=version.id,
            source_file_id=source.id,
            source_file_hash_at_create=source.sha256,
            chapter_body_hash_at_create=version.body_hash,
            range_start=original.index("target"),
            range_end=original.index("target") + len("target"),
            quote_text="target",
            quote_hash=sha256_text("target"),
            prefix_text="",
            suffix_text="",
            type="logic",
            severity="medium",
            comment="Check target.",
            status="resolved",
        )
    )
    session.commit()

    write(chapter_path, "# 第001章 First\nMoved target text")
    LibraryScanner(session, content).scan()

    annotation = session.scalar(select(Annotation))
    assert annotation.status == "resolved"
