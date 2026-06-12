import json
import re
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from backend.app.core.file_utils import safe_read_text
from backend.app.db.models import AnnotationInsight, Chapter, MemoryItem, SourceFile
from backend.app.repositories import Repository
from backend.app.services.workspace import WorkspaceResolver
from backend.app.utils.hashing import sha256_text


CHAPTER_CARD_RE = re.compile(r"^\ufeff?[ \t]*#{0,6}[ \t]*\u7b2c[ \t]*0*(\d+)[ \t]*\u7ae0", re.MULTILINE)
MANAGED_KINDS = {
    "core_fact",
    "character_card",
    "timeline_event",
    "clue_register",
    "chapter_card",
    "chapter_summary",
    "rolling_summary",
    "structured_state",
}
PRESERVED_MEMORY_SOURCES = {"confirmed_writing_card", "confirmed_work_profile"}
CHARACTER_HINTS = ("许满", "林浅", "王大雷", "李燃")
CLUE_HINTS = ("伏笔", "线索", "谜", "异常", "未解", "埋下", "提示")


class MemoryService:
    def __init__(self, session: Session, content_root: Path | None = None) -> None:
        self.session = session
        self.workspace = WorkspaceResolver(content_root)
        self.memory_items = Repository(session, MemoryItem)

    def rebuild(self) -> dict[str, int]:
        for item in self.session.scalars(select(MemoryItem).where(MemoryItem.kind.in_(MANAGED_KINDS))):
            if _memory_payload(item).get("source") in PRESERVED_MEMORY_SOURCES:
                continue
            self.session.delete(item)
        counts = {
            "core_facts": 0,
            "character_cards": 0,
            "timeline_events": 0,
            "clue_register": 0,
            "chapter_cards": 0,
            "chapter_summaries": 0,
            "rolling_summary": 0,
            "structured_state": 0,
        }
        counts["core_facts"] = self._rebuild_core_facts()
        counts["chapter_cards"] = self._rebuild_chapter_cards()
        counts["chapter_summaries"] = self._rebuild_chapter_summaries()
        counts["character_cards"] = self._rebuild_character_cards()
        counts["timeline_events"] = self._rebuild_timeline_events()
        counts["clue_register"] = self._rebuild_clue_register()
        counts["rolling_summary"] = self._rebuild_rolling_summary()
        counts["structured_state"] = self._rebuild_structured_state()
        self.session.commit()
        return counts

    def confirm_summary_proposal(self, artifact_id: int) -> dict[str, Any]:
        from backend.app.db.models import Artifact
        from backend.app.services.workspace import workspace_runtime_root
        from backend.app.utils.hashing import sha256_file

        artifact = self.session.get(Artifact, artifact_id)
        if artifact is None:
            raise ValueError("Artifact not found")
        metadata = _artifact_metadata(artifact)
        if metadata.get("purpose") != "chapter_memory_proposal":
            raise ValueError("Artifact is not a chapter memory proposal")
        chapter_no = int(metadata.get("chapter_no") or 0)
        if chapter_no <= 0:
            raise ValueError("Summary proposal is missing chapter_no")
        root = workspace_runtime_root().resolve()
        path = (root / artifact.path).resolve()
        if path != root and root not in path.parents:
            raise ValueError("Artifact path escapes runtime root")
        if sha256_file(path) != artifact.sha256:
            raise ValueError("Artifact file hash mismatch")
        payload = json.loads(safe_read_text(path, encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Summary proposal must be a JSON object")
        payload.update(
            {
                "source": "confirmed_summary_proposal",
                "artifact_id": artifact.id,
                "artifact_sha256": artifact.sha256,
            }
        )
        self._stale_existing("chapter_summary", str(chapter_no), source="confirmed_summary_proposal")
        self._create_memory("chapter_summary", str(chapter_no), payload, artifact.sha256)
        metadata["canonical"] = True
        artifact.metadata_json = json.dumps(metadata, ensure_ascii=False)
        self.session.commit()
        return {"artifact_id": artifact.id, "chapter_no": chapter_no, "memory_kind": "chapter_summary", "confirmed": True}

    def list_memory(self) -> list[MemoryItem]:
        return list(self.session.scalars(select(MemoryItem).order_by(MemoryItem.kind, MemoryItem.scope)))

    def context_preview(self, chapter_id: int) -> dict[str, Any]:
        chapter = self.session.get(Chapter, chapter_id)
        if chapter is None:
            raise ValueError("Chapter not found")
        core_facts = [json.loads(item.content_json) for item in self._items("core_fact", "global", limit=50)]
        chapter_cards = [json.loads(item.content_json) for item in self._items("chapter_card", str(chapter.chapter_no))]
        character_cards = [json.loads(item.content_json) for item in self._items("character_card", "global", limit=20)]
        timeline = [json.loads(item.content_json) for item in self._items("timeline_event", "global", limit=20)]
        clue_register = [json.loads(item.content_json) for item in self._items("clue_register", "global", limit=20)]
        rolling_summary = [json.loads(item.content_json) for item in self._items("rolling_summary", "global", limit=1)]
        structured_state_items = self._items("structured_state", "global")
        insights = list(
            self.session.scalars(
                select(AnnotationInsight).where(AnnotationInsight.enabled.is_(True)).order_by(AnnotationInsight.id).limit(50)
            )
        )
        return {
            "chapter_id": chapter_id,
            "core_facts": core_facts,
            "chapter_card": chapter_cards[0] if chapter_cards else None,
            "character_cards": character_cards,
            "timeline": timeline,
            "clue_register": clue_register,
            "rolling_summary": rolling_summary[0] if rolling_summary else None,
            "structured_state": json.loads(structured_state_items[0].content_json) if structured_state_items else None,
            "annotation_insights": [
                {
                    "id": insight.id,
                    "kind": insight.kind,
                    "content": insight.content,
                    "confidence": insight.confidence,
                }
                for insight in insights
            ],
        }

    def _items(self, kind: str, scope: str, limit: int | None = None) -> list[MemoryItem]:
        statement = (
            select(MemoryItem)
            .where(MemoryItem.kind == kind, MemoryItem.scope == scope, MemoryItem.stale.is_(False))
            .order_by(MemoryItem.id)
        )
        if limit is not None:
            statement = statement.limit(limit)
        return list(
            self.session.scalars(statement)
        )

    def _rebuild_core_facts(self) -> int:
        count = 0
        sources = self.session.scalars(
            select(SourceFile).where(SourceFile.kind == "settings", SourceFile.active.is_(True)).order_by(SourceFile.path)
        )
        for source in sources:
            text = self._read_source(source)
            for line in self._meaningful_lines(text, limit=80):
                payload = {
                    "fact": line,
                    "source_file_id": source.id,
                    "confidence": 0.6,
                    "updated_at": None,
                }
                self._create_memory("core_fact", "global", payload, source.sha256)
                count += 1
        return count

    def _rebuild_chapter_cards(self) -> int:
        count = 0
        sources = self.session.scalars(
            select(SourceFile).where(SourceFile.kind == "outlines", SourceFile.active.is_(True)).order_by(SourceFile.path)
        )
        for source in sources:
            text = self._read_source(source)
            blocks = self._outline_blocks(text)
            for chapter_no, block in blocks:
                payload = {
                    "chapter_no": chapter_no,
                    "goal": self._first_non_heading_line(block),
                    "key_events": self._meaningful_lines(block, limit=8),
                    "characters": [],
                    "constraints": [],
                    "source_file_id": source.id,
                }
                self._create_memory("chapter_card", str(chapter_no), payload, source.sha256)
                count += 1
        return count

    def _rebuild_chapter_summaries(self) -> int:
        count = 0
        chapters = self.session.scalars(select(Chapter).where(Chapter.active.is_(True)).order_by(Chapter.chapter_no))
        for chapter in chapters:
            version = chapter.current_version
            if version is None:
                continue
            source = chapter.source_file
            text = self._read_chapter_text(source, chapter)
            payload = {
                "chapter_no": chapter.chapter_no,
                "summary": self._summarize_text(text),
                "character_state_delta": {},
                "plot_state_delta": {},
                "unresolved_hooks": [],
            }
            self._create_memory("chapter_summary", str(chapter.chapter_no), payload, version.body_hash)
            count += 1
        return count

    def _rebuild_character_cards(self) -> int:
        summaries = [json.loads(item.content_json) for item in self._all_items("chapter_summary")]
        found: dict[str, list[int]] = {}
        for summary in summaries:
            text = json.dumps(summary, ensure_ascii=False)
            chapter_no = int(summary.get("chapter_no") or 0)
            for name in CHARACTER_HINTS:
                if name in text:
                    found.setdefault(name, []).append(chapter_no)
        count = 0
        for name, chapters in sorted(found.items()):
            payload = {
                "name": name,
                "status": "derived_from_summaries",
                "recent_chapters": chapters[-5:],
                "motivation": "",
                "relationships": {},
                "confidence": 0.5,
            }
            self._create_memory("character_card", "global", payload, sha256_text(json.dumps(payload, ensure_ascii=False, sort_keys=True)))
            count += 1
        return count

    def _rebuild_timeline_events(self) -> int:
        count = 0
        summaries = [json.loads(item.content_json) for item in self._all_items("chapter_summary")]
        for summary in summaries[-50:]:
            payload = {
                "chapter_no": summary.get("chapter_no"),
                "event": summary.get("summary", ""),
                "source": "chapter_summary",
            }
            self._create_memory("timeline_event", "global", payload, sha256_text(json.dumps(payload, ensure_ascii=False, sort_keys=True)))
            count += 1
        return count

    def _rebuild_clue_register(self) -> int:
        count = 0
        for item in self._all_items("chapter_card"):
            payload = json.loads(item.content_json)
            text = json.dumps(payload, ensure_ascii=False)
            if not any(hint in text for hint in CLUE_HINTS):
                continue
            clue = {
                "chapter_no": payload.get("chapter_no"),
                "clue": payload.get("goal") or text[:120],
                "status": "unresolved",
                "source": "chapter_card",
            }
            self._create_memory("clue_register", "global", clue, item.source_hash)
            count += 1
        return count

    def _rebuild_rolling_summary(self) -> int:
        summaries = [json.loads(item.content_json) for item in self._all_items("chapter_summary")]
        recent = summaries[-5:]
        payload = {
            "window": [summary.get("chapter_no") for summary in recent],
            "summary": " ".join(str(summary.get("summary", "")) for summary in recent)[:800],
        }
        self._create_memory("rolling_summary", "global", payload, sha256_text(json.dumps(payload, ensure_ascii=False, sort_keys=True)))
        return 1

    def _rebuild_structured_state(self) -> int:
        summaries = [json.loads(item.content_json) for item in self._all_items("chapter_summary")]
        characters = [json.loads(item.content_json) for item in self._all_items("character_card")]
        clues = [json.loads(item.content_json) for item in self._all_items("clue_register")]
        payload = {
            "characters": {card["name"]: card for card in characters if card.get("name")},
            "timeline": [summary["summary"] for summary in summaries],
            "locations": {},
            "power_system": {},
            "unresolved_clues": clues,
        }
        source_hash = sha256_text(json.dumps(payload, ensure_ascii=False, sort_keys=True))
        self._create_memory("structured_state", "global", payload, source_hash)
        return 1

    def _all_items(self, kind: str) -> list[MemoryItem]:
        return list(self.session.scalars(select(MemoryItem).where(MemoryItem.kind == kind).order_by(MemoryItem.scope)))

    def _create_memory(self, kind: str, scope: str, payload: dict[str, Any], source_hash: str) -> None:
        self.memory_items.create(
            {
                "kind": kind,
                "scope": scope,
                "content_json": json.dumps(payload, ensure_ascii=False),
                "source_hash": source_hash,
                "stale": False,
            }
        )

    def _stale_existing(self, kind: str, scope: str, *, source: str) -> None:
        for item in self.session.scalars(
            select(MemoryItem).where(MemoryItem.kind == kind, MemoryItem.scope == scope, MemoryItem.stale.is_(False))
        ):
            if _memory_payload(item).get("source") == source:
                item.stale = True

    def _read_source(self, source: SourceFile) -> str:
        return safe_read_text(self.workspace.resolve_source_path(source.path), encoding="utf-8-sig")

    def _read_chapter_text(self, source: SourceFile, chapter: Chapter) -> str:
        text = self._read_source(source)
        return text[chapter.range_start : chapter.range_end]

    def _meaningful_lines(self, text: str, *, limit: int) -> list[str]:
        lines = []
        for raw in text.splitlines():
            line = raw.strip(" -*\t")
            if not line or line == "placeholder":
                continue
            if line.startswith("#"):
                line = line.lstrip("#").strip()
            lines.append(line)
            if len(lines) >= limit:
                break
        return lines

    def _outline_blocks(self, text: str) -> list[tuple[int, str]]:
        matches = list(CHAPTER_CARD_RE.finditer(text))
        blocks: list[tuple[int, str]] = []
        for index, match in enumerate(matches):
            start = match.start()
            end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
            blocks.append((int(match.group(1)), text[start:end]))
        return blocks

    def _first_non_heading_line(self, text: str) -> str:
        for line in self._meaningful_lines(text, limit=10):
            if not line.startswith("\u7b2c"):
                return line
        lines = self._meaningful_lines(text, limit=1)
        return lines[0] if lines else ""

    def _summarize_text(self, text: str) -> str:
        lines = self._meaningful_lines(text, limit=6)
        joined = " ".join(lines)
        return joined[:300]


def _memory_payload(item: MemoryItem) -> dict[str, Any]:
    try:
        payload = json.loads(item.content_json or "{}")
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _artifact_metadata(artifact) -> dict[str, Any]:
    try:
        payload = json.loads(artifact.metadata_json or "{}")
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}
