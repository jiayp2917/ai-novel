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


def test_scan_reports_unparsed_chapter_files_and_empty_folders(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    write(workspace / "02-正文" / "06卷" / "随笔.md", "这里还没有标准章节标题。")
    (workspace / "02-正文" / "07卷").mkdir(parents=True)

    session = make_session()
    summary = LibraryScanner(session, workspace).scan()

    assert summary["chapter_source_files_seen"] == 1
    assert summary["chapters_seen"] == 0
    assert summary["unparsed_chapter_files"] == ["02-正文/06卷/随笔.md"]
    assert "02-正文/07卷" in summary["empty_chapter_folders"]


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


def test_chapter_versions_api_lists_current_version_first(tmp_path: Path, monkeypatch) -> None:
    from fastapi.testclient import TestClient

    content = tmp_path / "content"
    chapter_path = content / "chapters" / "book.md"
    write(chapter_path, "# \u7b2c001\u7ae0 First\nAlpha")
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("CONTENT_ROOT", str(content))
    monkeypatch.setenv("RUNTIME_ROOT", str(tmp_path / "runtime"))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(tmp_path / "runtime"))
    from backend.app.core.config import get_settings
    from backend.app.db.session import get_engine, reset_engine
    from backend.app.main import app

    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())
    client = TestClient(app)

    assert client.post("/api/library/scan").status_code == 200
    write(chapter_path, "# \u7b2c001\u7ae0 First\nAlpha changed")
    assert client.post("/api/library/scan").status_code == 200
    chapter = client.get("/api/chapters").json()[0]

    response = client.get(f"/api/chapters/{chapter['id']}/versions")

    assert response.status_code == 200
    versions = response.json()
    assert len(versions) == 2
    assert versions[0]["is_current"] is True
    assert versions[0]["body_hash"] != versions[1]["body_hash"]
    assert versions[0]["can_preview"] is True
    assert versions[1]["can_publish"] is True
    get_settings.cache_clear()
    reset_engine()


def test_chapter_version_content_and_publish_restore_previous_text(tmp_path: Path, monkeypatch) -> None:
    from fastapi.testclient import TestClient

    content = tmp_path / "content"
    chapter_path = content / "chapters" / "book.md"
    write(chapter_path, "# \u7b2c001\u7ae0 First\nAlpha")
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("CONTENT_ROOT", str(content))
    monkeypatch.setenv("RUNTIME_ROOT", str(tmp_path / "runtime"))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(tmp_path / "runtime"))
    from backend.app.core.config import get_settings
    from backend.app.db.session import get_engine, reset_engine
    from backend.app.main import app

    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())
    client = TestClient(app)

    assert client.post("/api/library/scan").status_code == 200
    write(chapter_path, "# \u7b2c001\u7ae0 First\nBeta")
    assert client.post("/api/library/scan").status_code == 200
    chapter = client.get("/api/chapters").json()[0]
    versions = client.get(f"/api/chapters/{chapter['id']}/versions").json()
    previous = next(version for version in versions if not version["is_current"])

    content_response = client.get(f"/api/chapters/{chapter['id']}/versions/{previous['id']}/content")
    publish_response = client.post(
        f"/api/chapters/{chapter['id']}/versions/{previous['id']}/publish",
        json={"approved_by_user": True},
    )

    assert content_response.status_code == 200
    assert "Alpha" in content_response.json()["text"]
    assert publish_response.status_code == 200
    assert publish_response.json()["published"] is True
    assert "Alpha" in chapter_path.read_text(encoding="utf-8")
    assert (get_settings().runtime_root / publish_response.json()["backup_path"]).exists()
    assert (get_settings().runtime_root / publish_response.json()["diff_path"]).exists()
    get_settings.cache_clear()
    reset_engine()


def test_scan_refreshes_unchanged_chapter_version_when_same_file_changes(tmp_path: Path) -> None:
    content = tmp_path / "content"
    chapter_path = content / "chapters" / "book.md"
    write(chapter_path, "# 第001章 First\nAlpha\n\n# 第2章 Second\nBeta")
    session = make_session()
    LibraryScanner(session, content).scan()

    chapter_one = session.scalar(select(Chapter).where(Chapter.chapter_no == 1))
    first_version = chapter_one.current_version
    assert first_version is not None
    first_versions = session.query(ChapterVersion).filter(ChapterVersion.chapter_id == chapter_one.id).count()
    write(chapter_path, "# 第001章 First\nAlpha\n\n# 第2章 Second\nBeta changed")
    LibraryScanner(session, content).scan()
    session.refresh(chapter_one)

    second_versions = session.query(ChapterVersion).filter(ChapterVersion.chapter_id == chapter_one.id).count()
    assert first_versions == 1
    assert second_versions == 2
    assert chapter_one.current_version is not None
    assert chapter_one.current_version.body_hash == first_version.body_hash
    assert chapter_one.current_version.source_file_hash != first_version.source_file_hash
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


def test_scan_refreshes_unchanged_chapter_version_when_same_file_hash_changes(tmp_path: Path) -> None:
    content = tmp_path / "content"
    chapter_path = content / "chapters" / "book.md"
    original = "# 第001章 First\nAlpha text.\n\n# 第002章 Second\nSecond unchanged."
    write(chapter_path, original)
    session = make_session()
    LibraryScanner(session, content).scan()
    chapter_two = session.scalar(select(Chapter).where(Chapter.chapter_no == 2))
    assert chapter_two is not None
    old_version = chapter_two.current_version
    assert old_version is not None

    changed = "# 第001章 First\nAlpha changed.\n\n# 第002章 Second\nSecond unchanged."
    write(chapter_path, changed)
    LibraryScanner(session, content).scan()
    session.refresh(chapter_two)

    assert chapter_two.current_version_id != old_version.id
    assert chapter_two.current_version is not None
    assert chapter_two.current_version.body_hash == old_version.body_hash
    assert chapter_two.current_version.source_file_hash != old_version.source_file_hash
