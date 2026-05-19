from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.file_utils import safe_read_text
from backend.app.db.models import Annotation, Chapter, SourceFile
from backend.app.repositories import Repository
from backend.app.schemas import AnnotationRequest, AnnotationUpdate
from backend.app.services.workspace import WorkspaceResolver
from backend.app.utils.hashing import sha256_text


RELOCATABLE_STATUSES = {"open", "needs_relocate"}
TERMINAL_STATUSES = {"resolved", "ignored", "learned"}
CONTEXT_CHARS = 30


class NotFoundError(ValueError):
    pass


class InvalidRequestError(ValueError):
    pass


@dataclass(frozen=True)
class RelocationResult:
    status: str
    range_start: int | None = None
    range_end: int | None = None


def relocate_quote(text: str, quote_text: str, prefix_text: str = "", suffix_text: str = "") -> RelocationResult:
    matches: list[int] = []
    start = text.find(quote_text)
    while start != -1:
        matches.append(start)
        start = text.find(quote_text, start + 1)

    if len(matches) == 1:
        start = matches[0]
        return RelocationResult("open", start, start + len(quote_text))

    if len(matches) > 1:
        scored: list[int] = []
        for start in matches:
            prefix_ok = not prefix_text or text[max(0, start - len(prefix_text)) : start] == prefix_text
            end = start + len(quote_text)
            suffix_ok = not suffix_text or text[end : end + len(suffix_text)] == suffix_text
            if prefix_ok and suffix_ok:
                scored.append(start)
        if len(scored) == 1:
            start = scored[0]
            return RelocationResult("open", start, start + len(quote_text))

    return RelocationResult("needs_relocate")


def relocate_annotations_for_chapter(
    session: Session,
    *,
    chapter_id: int,
    body_hash: str,
    text: str,
) -> int:
    annotations = list(session.scalars(select(Annotation).where(Annotation.chapter_id == chapter_id)))
    changed = 0
    for annotation in annotations:
        if annotation.status not in RELOCATABLE_STATUSES:
            continue
        if annotation.chapter_body_hash_at_create == body_hash:
            if annotation.status == "needs_relocate":
                annotation.status = "open"
                changed += 1
            continue
        result = relocate_quote(text, annotation.quote_text, annotation.prefix_text, annotation.suffix_text)
        if result.status == "open" and result.range_start is not None and result.range_end is not None:
            annotation.range_start = result.range_start
            annotation.range_end = result.range_end
            annotation.status = "open"
        else:
            annotation.status = "needs_relocate"
        changed += 1
    return changed


class AnnotationService:
    def __init__(self, session: Session, content_root: Path | None = None) -> None:
        self.session = session
        self.annotations = Repository(session, Annotation)
        self.workspace = WorkspaceResolver(content_root)

    def create_for_chapter(self, chapter_id: int, payload: AnnotationRequest) -> Annotation:
        chapter = self._get_active_chapter(chapter_id)
        version = chapter.current_version
        if version is None:
            raise InvalidRequestError("Chapter has no current version")
        text = self._chapter_text(chapter)
        if payload.range_start < 0 or payload.range_end <= payload.range_start or payload.range_end > len(text):
            raise InvalidRequestError("Invalid annotation range")
        quote_text = text[payload.range_start : payload.range_end]
        prefix_start = max(0, payload.range_start - CONTEXT_CHARS)
        suffix_end = min(len(text), payload.range_end + CONTEXT_CHARS)
        annotation = self.annotations.create(
            {
                "chapter_id": chapter.id,
                "chapter_version_id": version.id,
                "source_file_id": chapter.source_file_id,
                "source_file_hash_at_create": chapter.source_file.sha256,
                "chapter_body_hash_at_create": version.body_hash,
                "range_start": payload.range_start,
                "range_end": payload.range_end,
                "quote_text": quote_text,
                "quote_hash": sha256_text(quote_text),
                "prefix_text": text[prefix_start : payload.range_start],
                "suffix_text": text[payload.range_end : suffix_end],
                "type": payload.type,
                "severity": payload.severity,
                "comment": payload.comment,
                "example_rewrite": payload.example_rewrite,
                "status": "open",
            }
        )
        self.session.commit()
        return annotation

    def create_for_source_file(self, source_file_id: int, payload: AnnotationRequest) -> Annotation:
        source_file = self._get_active_source_file(source_file_id)
        text = self._source_text(source_file)
        if payload.range_start < 0 or payload.range_end <= payload.range_start or payload.range_end > len(text):
            raise InvalidRequestError("Invalid annotation range")
        quote_text = text[payload.range_start : payload.range_end]
        prefix_start = max(0, payload.range_start - CONTEXT_CHARS)
        suffix_end = min(len(text), payload.range_end + CONTEXT_CHARS)
        annotation = self.annotations.create(
            {
                "chapter_id": None,
                "chapter_version_id": None,
                "source_file_id": source_file.id,
                "source_file_hash_at_create": source_file.sha256,
                "chapter_body_hash_at_create": source_file.sha256,
                "range_start": payload.range_start,
                "range_end": payload.range_end,
                "quote_text": quote_text,
                "quote_hash": sha256_text(quote_text),
                "prefix_text": text[prefix_start : payload.range_start],
                "suffix_text": text[payload.range_end : suffix_end],
                "type": payload.type,
                "severity": payload.severity,
                "comment": payload.comment,
                "example_rewrite": payload.example_rewrite,
                "status": "open",
            }
        )
        self.session.commit()
        return annotation

    def list_for_chapter(self, chapter_id: int) -> list[Annotation]:
        self._get_active_chapter(chapter_id)
        return list(
            self.session.scalars(
                select(Annotation).where(Annotation.chapter_id == chapter_id).order_by(Annotation.range_start, Annotation.id)
            )
        )

    def list_for_source_file(self, source_file_id: int) -> list[Annotation]:
        self._get_active_source_file(source_file_id)
        return list(
            self.session.scalars(
                select(Annotation)
                .where(Annotation.source_file_id == source_file_id, Annotation.chapter_id.is_(None))
                .order_by(Annotation.range_start, Annotation.id)
            )
        )

    def update(self, annotation_id: int, payload: AnnotationUpdate) -> Annotation:
        annotation = self._get_annotation(annotation_id)
        data = payload.model_dump(exclude_unset=True)
        if "range_start" in data or "range_end" in data:
            start = data.get("range_start", annotation.range_start)
            end = data.get("range_end", annotation.range_end)
            text = self._annotation_text_scope(annotation)
            if start < 0 or end <= start or end > len(text):
                raise InvalidRequestError("Invalid annotation range")
            annotation.range_start = start
            annotation.range_end = end
            annotation.quote_text = text[start:end]
            annotation.quote_hash = sha256_text(annotation.quote_text)
            prefix_start = max(0, start - CONTEXT_CHARS)
            suffix_end = min(len(text), end + CONTEXT_CHARS)
            annotation.prefix_text = text[prefix_start:start]
            annotation.suffix_text = text[end:suffix_end]
        for field in ("type", "severity", "comment", "example_rewrite", "status"):
            if field in data:
                setattr(annotation, field, data[field])
        self.session.commit()
        self.session.refresh(annotation)
        return annotation

    def delete(self, annotation_id: int) -> None:
        annotation = self._get_annotation(annotation_id)
        self.annotations.delete(annotation)
        self.session.commit()

    def relocate(self, annotation_id: int) -> Annotation:
        annotation = self._get_annotation(annotation_id)
        if annotation.status in TERMINAL_STATUSES:
            raise InvalidRequestError("Terminal annotation status cannot be relocated")
        text = self._annotation_text_scope(annotation)
        result = relocate_quote(text, annotation.quote_text, annotation.prefix_text, annotation.suffix_text)
        if result.status == "open" and result.range_start is not None and result.range_end is not None:
            annotation.range_start = result.range_start
            annotation.range_end = result.range_end
            annotation.status = "open"
        else:
            annotation.status = "needs_relocate"
        self.session.commit()
        self.session.refresh(annotation)
        return annotation

    def _get_annotation(self, annotation_id: int) -> Annotation:
        annotation = self.session.get(Annotation, annotation_id)
        if annotation is None:
            raise NotFoundError("Annotation not found")
        return annotation

    def _get_active_chapter(self, chapter_id: int) -> Chapter:
        chapter = self.session.get(Chapter, chapter_id)
        if chapter is None or not chapter.active:
            raise NotFoundError("Chapter not found")
        return chapter

    def _get_active_source_file(self, source_file_id: int) -> SourceFile:
        source_file = self.session.get(SourceFile, source_file_id)
        if source_file is None or not source_file.active:
            raise NotFoundError("Source file not found")
        return source_file

    def _chapter_text(self, chapter: Chapter) -> str:
        if chapter.current_version is None:
            raise InvalidRequestError("Chapter has no current version")
        text = safe_read_text(self.workspace.resolve_source_path(chapter.source_file.path), encoding="utf-8-sig")
        return text[chapter.range_start : chapter.range_end]

    def _source_text(self, source_file: SourceFile) -> str:
        return safe_read_text(self.workspace.resolve_source_path(source_file.path), encoding="utf-8-sig")

    def _annotation_text_scope(self, annotation: Annotation) -> str:
        if annotation.chapter_id is not None:
            chapter = self._get_active_chapter(annotation.chapter_id)
            return self._chapter_text(chapter)
        source_file = self._get_active_source_file(annotation.source_file_id)
        return self._source_text(source_file)
