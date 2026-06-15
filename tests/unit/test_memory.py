from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from backend.app.db.base import Base
from backend.app.db.models import AnnotationInsight, MemoryItem
from backend.app.services.library import LibraryScanner
from backend.app.services.memory import MemoryService


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def seed_content(root: Path) -> None:
    write(root / "settings" / "world.md", "# World\nMain rule stays stable.\nPower has limits.")
    write(root / "outlines" / "outline.md", "第001章\nGoal line\n- Event one\n- Event two")
    write(root / "chapters" / "book.md", "# 第001章 First\nAlpha starts the plot.\nBeta follows.")


def test_rebuild_memory_creates_expected_items(tmp_path: Path) -> None:
    content = tmp_path / "content"
    seed_content(content)
    session = make_session()
    LibraryScanner(session, content).scan()

    counts = MemoryService(session, content).rebuild()
    items = list(session.scalars(select(MemoryItem)))
    kinds = {item.kind for item in items}

    assert counts["core_facts"] >= 2
    assert counts["chapter_cards"] == 1
    assert counts["chapter_summaries"] == 1
    assert counts["structured_state"] == 1
    assert counts["rolling_summary"] == 1
    assert counts["timeline_events"] == 1
    assert {"core_fact", "chapter_card", "chapter_summary", "structured_state"} <= kinds
    assert {"timeline_event", "rolling_summary"} <= kinds


def test_context_preview_uses_short_memory_and_enabled_insights(tmp_path: Path) -> None:
    content = tmp_path / "content"
    seed_content(content)
    session = make_session()
    LibraryScanner(session, content).scan()
    MemoryService(session, content).rebuild()
    session.add(
        AnnotationInsight(
            kind="style_preference",
            content="Avoid repeated phrasing.",
            source_annotation_ids_json="[]",
            enabled=True,
            confidence=0.8,
        )
    )
    session.commit()

    preview = MemoryService(session, content).context_preview(1)

    assert preview["chapter_id"] == 1
    assert preview["core_facts"]
    assert preview["chapter_card"]["chapter_no"] == 1
    assert preview["timeline"]
    assert preview["rolling_summary"]
    assert "clue_register" in preview
    assert preview["structured_state"]["timeline"]
    assert preview["annotation_insights"][0]["content"] == "Avoid repeated phrasing."


def test_rebuild_replaces_existing_memory_items(tmp_path: Path) -> None:
    content = tmp_path / "content"
    seed_content(content)
    session = make_session()
    LibraryScanner(session, content).scan()
    service = MemoryService(session, content)

    first = service.rebuild()
    first_total = sum(first.values())
    second = service.rebuild()
    items = list(session.scalars(select(MemoryItem)))

    assert len(items) == first_total
    assert sum(second.values()) == first_total


def test_rebuild_preserves_unmanaged_memory_kind(tmp_path: Path) -> None:
    content = tmp_path / "content"
    seed_content(content)
    session = make_session()
    LibraryScanner(session, content).scan()
    session.add(
        MemoryItem(
            kind="custom_note",
            scope="manual",
            content_json="{}",
            source_hash="x" * 64,
            stale=False,
        )
    )
    session.commit()

    MemoryService(session, content).rebuild()
    custom = session.scalar(select(MemoryItem).where(MemoryItem.kind == "custom_note"))

    assert custom is not None


def test_scan_marks_relevant_memory_stale_after_source_change(tmp_path: Path) -> None:
    content = tmp_path / "content"
    seed_content(content)
    session = make_session()
    LibraryScanner(session, content).scan()
    MemoryService(session, content).rebuild()

    write(content / "settings" / "world.md", "# World\nChanged rule.")
    LibraryScanner(session, content).scan()
    stale_items = list(session.scalars(select(MemoryItem).where(MemoryItem.stale.is_(True))))

    assert stale_items
    assert {item.kind for item in stale_items} == {"core_fact"}
