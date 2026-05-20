import re
import threading
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.file_utils import safe_read_text, safe_write_text
from backend.app.db.models import Chapter, ChapterVersion, MemoryItem, SourceFile
from backend.app.schemas import ChapterCreate, ChapterVersionCreate, SourceFileCreate
from backend.app.services.annotations import relocate_annotations_for_chapter
from backend.app.services.catalog import CatalogService
from backend.app.services.workspace import WorkspaceResolver, workspace_runtime_root
from backend.app.utils.hashing import sha256_file, sha256_text


CHAPTER_HEADING_RE = re.compile(r"^\ufeff?[ \t]*#[ \t]*\u7b2c[ \t]*0*(\d+)[ \t]*\u7ae0[ \t]*(.*?)\s*$", re.MULTILINE)
scan_lock = threading.Lock()


@dataclass(frozen=True)
class ParsedChapter:
    chapter_no: int
    title: str
    range_start: int
    range_end: int
    text: str


def parse_chapters(markdown: str) -> list[ParsedChapter]:
    matches = list(CHAPTER_HEADING_RE.finditer(markdown))
    chapters: list[ParsedChapter] = []
    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(markdown)
        chapter_no = int(match.group(1))
        title = match.group(2).strip() or f"Chapter {chapter_no}"
        chapters.append(
            ParsedChapter(
                chapter_no=chapter_no,
                title=title,
                range_start=start,
                range_end=end,
                text=markdown[start:end],
            )
        )
    return chapters


class LibraryScanner:
    def __init__(self, session: Session, content_root: Path | None = None) -> None:
        self.session = session
        self.workspace = WorkspaceResolver(content_root)
        self.content_root = self.workspace.root
        self.runtime_root = workspace_runtime_root(self.workspace.info)
        self.catalog = CatalogService(session)

    def scan(self) -> dict:
        with scan_lock:
            seen_source_paths: set[str] = set()
            seen_chapter_numbers: set[int] = set()
            summary = {
                "source_files_seen": 0,
                "source_files_created": 0,
                "source_files_updated": 0,
                "source_files_deactivated": 0,
                "chapter_source_files_seen": 0,
                "chapters_seen": 0,
                "chapters_created": 0,
                "chapters_deactivated": 0,
                "chapter_versions_created": 0,
                "annotations_relocated": 0,
                "unparsed_chapter_files": [],
                "empty_chapter_folders": [],
            }
            for spec in self.workspace.source_specs():
                kind = spec.kind
                directory = spec.directory
                if not directory.exists():
                    continue
                if kind == "chapters":
                    summary["empty_chapter_folders"].extend(self._empty_chapter_folders(directory))
                for path in sorted(directory.rglob("*.md")):
                    seen_source_paths.add(self._relative_path(path))
                    source_file, created, updated = self._upsert_source_file(path, kind)
                    if updated:
                        self._mark_memory_stale_for_source(source_file)
                    summary["source_files_seen"] += 1
                    summary["source_files_created"] += int(created)
                    summary["source_files_updated"] += int(updated)
                    if kind == "chapters":
                        summary["chapter_source_files_seen"] += 1
                        chapter_stats = self._scan_chapter_file(path, source_file)
                        seen_chapter_numbers.update(chapter_stats.pop("chapter_numbers"))
                        if chapter_stats["chapters_seen"] == 0:
                            summary["unparsed_chapter_files"].append(self._relative_path(path))
                        for key, value in chapter_stats.items():
                            summary[key] += value
            summary["source_files_deactivated"] = self._deactivate_missing_source_files(seen_source_paths)
            summary["chapters_deactivated"] = self._deactivate_missing_chapters(seen_chapter_numbers)
            self.session.commit()
            summary["unparsed_chapter_files"] = sorted(set(summary["unparsed_chapter_files"]))
            summary["empty_chapter_folders"] = sorted(set(summary["empty_chapter_folders"]))
            return summary

    def _relative_path(self, path: Path) -> str:
        return self.workspace.relative_path(path)

    def _upsert_source_file(self, path: Path, kind: str) -> tuple[SourceFile, bool, bool]:
        stat = path.stat()
        payload = SourceFileCreate(
            path=self._relative_path(path),
            kind=kind,
            sha256=sha256_file(path),
            mtime=stat.st_mtime,
            size=stat.st_size,
            active=True,
        )
        existing = self.session.scalar(select(SourceFile).where(SourceFile.path == payload.path))
        if existing is None:
            return self.catalog.create_source_file(payload), True, False

        updated = existing.sha256 != payload.sha256 or existing.mtime != payload.mtime or existing.size != payload.size
        existing.kind = payload.kind
        existing.sha256 = payload.sha256
        existing.mtime = payload.mtime
        existing.size = payload.size
        existing.active = True
        self.session.flush()
        return existing, False, updated

    def _scan_chapter_file(self, path: Path, source_file: SourceFile) -> dict[str, int]:
        stats = {
            "chapters_seen": 0,
            "chapters_created": 0,
            "chapter_versions_created": 0,
            "annotations_relocated": 0,
            "chapter_numbers": set(),
        }
        markdown = safe_read_text(path, encoding="utf-8-sig")
        source_hash = source_file.sha256
        for parsed in parse_chapters(markdown):
            stats["chapter_numbers"].add(parsed.chapter_no)
            stats["chapters_seen"] += 1
            chapter = self.session.scalar(select(Chapter).where(Chapter.chapter_no == parsed.chapter_no))
            if chapter is None:
                chapter = self.catalog.create_chapter(
                    ChapterCreate(
                        chapter_no=parsed.chapter_no,
                        title=parsed.title,
                        source_file_id=source_file.id,
                        range_start=parsed.range_start,
                        range_end=parsed.range_end,
                    )
                )
                stats["chapters_created"] += 1
            else:
                chapter.title = parsed.title
                chapter.source_file_id = source_file.id
                chapter.range_start = parsed.range_start
                chapter.range_end = parsed.range_end
                chapter.active = True

            body_hash = sha256_text(parsed.text)
            current = chapter.current_version
            if current is None or current.body_hash != body_hash or current.source_file_hash != source_hash:
                snapshot_path = self._write_chapter_version_snapshot(chapter.id, body_hash, parsed.text)
                version = self.catalog.create_chapter_version(
                    ChapterVersionCreate(
                        chapter_id=chapter.id,
                        source_file_id=source_file.id,
                        body_hash=body_hash,
                        source_file_hash=source_hash,
                        title=parsed.title,
                        text_snapshot_path=snapshot_path,
                        range_start=parsed.range_start,
                        range_end=parsed.range_end,
                    )
                )
                chapter.current_version_id = version.id
                stats["chapter_versions_created"] += 1
                stats["annotations_relocated"] += relocate_annotations_for_chapter(
                    self.session,
                    chapter_id=chapter.id,
                    body_hash=body_hash,
                    text=parsed.text,
                )
        self.session.flush()
        return stats

    def _write_chapter_version_snapshot(self, chapter_id: int, body_hash: str, text: str) -> str:
        directory = self.runtime_root / "versions"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"chapter_{chapter_id}_{body_hash[:12]}.md"
        safe_write_text(path, text, encoding="utf-8")
        return path.relative_to(self.runtime_root).as_posix()

    def _empty_chapter_folders(self, directory: Path) -> list[str]:
        folders: list[str] = []
        for folder in sorted(path for path in directory.rglob("*") if path.is_dir()):
            if not any(child.is_file() and child.suffix.lower() == ".md" for child in folder.rglob("*")):
                folders.append(self._relative_path(folder))
        return folders

    def _deactivate_missing_source_files(self, seen_paths: set[str]) -> int:
        changed = 0
        for source_file in self.session.scalars(select(SourceFile).where(SourceFile.active.is_(True))):
            if source_file.path not in seen_paths:
                source_file.active = False
                self._mark_memory_stale_for_source(source_file)
                changed += 1
        self.session.flush()
        return changed

    def _deactivate_missing_chapters(self, seen_chapter_numbers: set[int]) -> int:
        changed = 0
        for chapter in self.session.scalars(select(Chapter).where(Chapter.active.is_(True))):
            if chapter.chapter_no not in seen_chapter_numbers:
                chapter.active = False
                changed += 1
        self.session.flush()
        return changed

    def _mark_memory_stale_for_source(self, source_file: SourceFile) -> None:
        if source_file.kind == "settings":
            kinds = {"core_fact"}
        elif source_file.kind == "outlines":
            kinds = {"chapter_card"}
        else:
            kinds = {"chapter_summary", "structured_state"}
        for item in self.session.scalars(select(MemoryItem).where(MemoryItem.kind.in_(kinds))):
            item.stale = True
