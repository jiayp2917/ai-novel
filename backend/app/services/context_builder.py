import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.file_utils import safe_read_text
from backend.app.core.config import get_settings
from backend.app.db.models import Annotation, AnnotationInsight, Chapter, MemoryItem
from backend.app.services.artifacts import ArtifactStore
from backend.app.services.annotations import InvalidRequestError, NotFoundError
from backend.app.services.skills import SkillLoader, skill_summary
from backend.app.services.workspace import WorkspaceResolver


SECTION_PRIORITY = {
    "task_instruction": 0,
    "skills": 1,
    "annotations": 2,
    "chapter_card": 3,
    "chapter_text": 4,
    "rolling_summary": 5,
    "character_cards": 6,
    "clue_register": 7,
    "timeline": 8,
    "core_facts": 9,
    "structured_state": 10,
    "annotation_insights": 11,
}


@dataclass(frozen=True)
class ContextBuildResult:
    context: str
    report: dict[str, Any]
    report_artifact_id: int | None


class ContextBuilder:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.settings = get_settings()
        self.workspace = WorkspaceResolver()

    def build(self, *, chapter_id: int, annotation_ids: list[int], task_type: str) -> ContextBuildResult:
        chapter = self.session.get(Chapter, chapter_id)
        if chapter is None or not chapter.active:
            raise NotFoundError("Chapter not found")
        if chapter.current_version is None:
            raise InvalidRequestError("Chapter has no current version")

        annotations = self._annotations(chapter_id, annotation_ids)
        skills = SkillLoader().load_for_task(task_type)
        sections = self._sections(chapter, annotations, task_type, skills)
        selected, dropped = self._select_sections(sections)
        context = "\n\n".join(section["text"] for section in selected)
        report = {
            "chapter_id": chapter_id,
            "task_type": task_type,
            "budget": self.settings.max_input_chars_per_call,
            "input_chars": len(context),
            "context_degraded": bool(dropped),
            "selected_sections": [
                {"name": section["name"], "chars": len(section["text"])} for section in selected
            ],
            "dropped_sections": [
                {"name": section["name"], "chars": len(section["text"])} for section in dropped
            ],
            "annotation_ids": [annotation.id for annotation in annotations],
            "task_profile": self._task_profile(task_type),
            "skills": [skill_summary(skill) for skill in skills],
        }
        artifact_id = None
        if dropped:
            artifact = ArtifactStore(self.session).save_json(
                kind="context_report",
                payload=report,
                metadata={"task_type": task_type, "context_degraded": True},
                base_chapter=chapter,
            )
            artifact_id = artifact.id
        return ContextBuildResult(context=context, report=report, report_artifact_id=artifact_id)

    def _annotations(self, chapter_id: int, annotation_ids: list[int]) -> list[Annotation]:
        if annotation_ids:
            annotations = list(
                self.session.scalars(
                    select(Annotation).where(Annotation.id.in_(annotation_ids), Annotation.chapter_id == chapter_id)
                )
            )
            if len(annotations) != len(set(annotation_ids)):
                raise InvalidRequestError("Some annotations do not belong to this chapter")
            return annotations
        return list(
            self.session.scalars(
                select(Annotation)
                .where(Annotation.chapter_id == chapter_id, Annotation.status.in_(["open", "needs_relocate"]))
                .order_by(Annotation.range_start, Annotation.id)
            )
        )

    def _sections(self, chapter: Chapter, annotations: list[Annotation], task_type: str, skills) -> list[dict[str, str | int]]:
        profile = self._task_profile(task_type)
        sections = [
            self._section("annotations", self._annotation_text(annotations)),
            self._section("chapter_card", self._memory_text("chapter_card", str(chapter.chapter_no), limit=1)),
            self._section("task_instruction", f"Task type: {task_type}. Keep the chapter heading unchanged."),
        ]
        if skills:
            sections.append(self._section("skills", self._skills_text(skills)))
        if profile["include_chapter_text"]:
            sections.append(self._section("chapter_text", self._chapter_text(chapter)))
        if profile["include_rolling_summary"]:
            sections.append(self._section("rolling_summary", self._memory_text("rolling_summary", "global", limit=1)))
        if profile["include_character_cards"]:
            sections.append(self._section("character_cards", self._memory_text("character_card", "global", limit=20)))
        if profile["include_clues"]:
            sections.append(self._section("clue_register", self._memory_text("clue_register", "global", limit=20)))
        if profile["include_timeline"]:
            sections.append(self._section("timeline", self._memory_text("timeline_event", "global", limit=20)))
        if profile["include_core_facts"]:
            sections.append(self._section("core_facts", self._memory_text("core_fact", "global", limit=50)))
        if profile["include_structured_state"]:
            sections.append(self._section("structured_state", self._memory_text("structured_state", "global", limit=1)))
        if profile["include_annotation_insights"]:
            sections.append(self._section("annotation_insights", self._insights_text()))
        return sections

    def _skills_text(self, skills) -> str:
        return "\n\n".join(
            f"[{skill.name} v{skill.version} | {skill.path} | {skill.sha256[:12]}]\n{skill.content}"
            for skill in skills
        )

    def _task_profile(self, task_type: str) -> dict[str, bool]:
        if task_type in {"summarize_published_chapter", "rebuild_structured_memory"}:
            return {
                "include_chapter_text": True,
                "include_rolling_summary": False,
                "include_character_cards": False,
                "include_clues": False,
                "include_timeline": False,
                "include_core_facts": False,
                "include_structured_state": False,
                "include_annotation_insights": False,
            }
        if task_type in {"review_chapter_candidate", "review_outline_proposal"}:
            return {
                "include_chapter_text": True,
                "include_rolling_summary": True,
                "include_character_cards": True,
                "include_clues": True,
                "include_timeline": True,
                "include_core_facts": True,
                "include_structured_state": True,
                "include_annotation_insights": True,
            }
        return {
            "include_chapter_text": True,
            "include_rolling_summary": True,
            "include_character_cards": True,
            "include_clues": True,
            "include_timeline": False,
            "include_core_facts": True,
            "include_structured_state": True,
            "include_annotation_insights": True,
        }

    def _section(self, name: str, body: str) -> dict[str, str | int]:
        return {
            "name": name,
            "priority": SECTION_PRIORITY.get(name, 9),
            "text": f"## {name}\n{body.strip()}",
        }

    def _select_sections(self, sections: list[dict[str, str | int]]) -> tuple[list[dict[str, str | int]], list[dict[str, str | int]]]:
        budget = self.settings.max_input_chars_per_call
        selected: list[dict[str, str | int]] = []
        dropped: list[dict[str, str | int]] = []
        used = 0
        for section in sorted(sections, key=lambda item: int(item["priority"])):
            text = str(section["text"])
            if not text.strip():
                continue
            next_used = used + len(text) + 2
            if next_used <= budget:
                selected.append(section)
                used = next_used
            else:
                dropped.append(section)
        selected.sort(key=lambda item: int(item["priority"]))
        return selected, dropped

    def _annotation_text(self, annotations: list[Annotation]) -> str:
        if not annotations:
            return "No annotations selected."
        payload = [
            {
                "id": annotation.id,
                "type": annotation.type,
                "severity": annotation.severity,
                "status": annotation.status,
                "quote": annotation.quote_text,
                "comment": annotation.comment,
                "example_rewrite": annotation.example_rewrite,
            }
            for annotation in annotations
        ]
        return json.dumps(payload, ensure_ascii=False, indent=2)

    def _chapter_text(self, chapter: Chapter) -> str:
        text = safe_read_text(self.workspace.resolve_source_path(chapter.source_file.path), encoding="utf-8-sig")
        return text[chapter.range_start : chapter.range_end]

    def _memory_text(self, kind: str, scope: str, *, limit: int) -> str:
        items = list(
            self.session.scalars(
                select(MemoryItem)
                .where(MemoryItem.kind == kind, MemoryItem.scope == scope, MemoryItem.stale.is_(False))
                .order_by(MemoryItem.id)
                .limit(limit)
            )
        )
        return "\n".join(item.content_json for item in items)

    def _insights_text(self) -> str:
        insights = list(
            self.session.scalars(
                select(AnnotationInsight).where(AnnotationInsight.enabled.is_(True)).order_by(AnnotationInsight.id).limit(50)
            )
        )
        payload = [
            {
                "kind": insight.kind,
                "content": insight.content,
                "confidence": insight.confidence,
            }
            for insight in insights
        ]
        return json.dumps(payload, ensure_ascii=False, indent=2)
