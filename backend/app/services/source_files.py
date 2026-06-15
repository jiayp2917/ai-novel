from dataclasses import dataclass
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.file_utils import safe_read_text, safe_write_text
from backend.app.db.models import Chapter, Event, SourceFile
from backend.app.services.library import LibraryScanner, parse_chapters
from backend.app.services.workspace import SourceRootSpec, WorkspaceResolver, workspace_runtime_root
from backend.app.utils.paths import safe_join


class SourceFileManagerError(ValueError):
    pass


WINDOWS_FORBIDDEN_CHARS = set('<>:"|?*')
WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}


@dataclass(frozen=True)
class CreatedSource:
    path: str
    source_file_id: int | None
    chapter_id: int | None = None
    backup_path: str | None = None
    scan: dict | None = None


class SourceFileManager:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.workspace = WorkspaceResolver()

    def create_folder(self, *, root_key: str, folder: str) -> dict:
        root = self._source_root(root_key)
        relative_folder = self._clean_relative_path(folder, allow_empty=False)
        path = safe_join(root.directory, relative_folder)
        self._ensure_allowed_target(path)
        if path.exists() and not path.is_dir():
            raise SourceFileManagerError("Folder path already exists as a file")
        path.mkdir(parents=True, exist_ok=True)
        scan = LibraryScanner(self.session).scan()
        return {
            "path": self.workspace.relative_path(path),
            "created": True,
            "scan": scan,
        }

    def create_file(
        self,
        *,
        root_key: str,
        folder: str,
        filename: str,
        template: str,
        title: str | None,
        chapter_no: int | None,
        content: str | None,
    ) -> CreatedSource:
        root = self._source_root(root_key)
        cleaned_folder = self._clean_relative_path(folder, allow_empty=True)
        cleaned_filename = self._clean_filename(filename)
        target_dir = safe_join(root.directory, cleaned_folder) if cleaned_folder else root.directory
        path = safe_join(target_dir, cleaned_filename)
        self._ensure_allowed_target(path)
        if path.exists():
            raise SourceFileManagerError("Source file already exists")
        if template == "chapter":
            if root.kind != "chapters":
                raise SourceFileManagerError("Chapter template can only be created under chapter sources")
            if chapter_no is None or chapter_no <= 0:
                raise SourceFileManagerError("Chapter number must be positive")
            if self._active_chapter_exists(chapter_no):
                raise SourceFileManagerError("Chapter number already exists")
            text = self._chapter_template(chapter_no, title, content)
        elif template == "blank":
            text = self._blank_template(title, content)
        else:
            raise SourceFileManagerError("Unsupported source file template")

        path.parent.mkdir(parents=True, exist_ok=True)
        safe_write_text(path, text, encoding="utf-8")
        scan = LibraryScanner(self.session).scan()
        relative_path = self.workspace.relative_path(path)
        source_file = self.session.scalar(select(SourceFile).where(SourceFile.path == relative_path, SourceFile.active.is_(True)))
        chapter = None
        if template == "chapter" and chapter_no is not None:
            chapter = self.session.scalar(select(Chapter).where(Chapter.chapter_no == chapter_no, Chapter.active.is_(True)))
        return CreatedSource(
            path=relative_path,
            source_file_id=source_file.id if source_file else None,
            chapter_id=chapter.id if chapter else None,
            scan=scan,
        )

    def normalize_chapter(
        self,
        *,
        source_file_id: int,
        chapter_no: int,
        title: str,
        content_prefix: str | None = None,
        confirm_normalize: bool = False,
    ) -> CreatedSource:
        source_file = self.session.get(SourceFile, source_file_id)
        if source_file is None or not source_file.active:
            raise SourceFileManagerError("Source file not found")
        if source_file.kind != "chapters":
            raise SourceFileManagerError("Only chapter source files can be normalized")
        if not confirm_normalize:
            raise SourceFileManagerError("规范化会修改这个 Markdown 文件并生成备份；请确认后再执行。")
        if chapter_no <= 0:
            raise SourceFileManagerError("Chapter number must be positive")
        if self._active_chapter_exists(chapter_no):
            raise SourceFileManagerError("Chapter number already exists")
        path = self.workspace.resolve_source_path(source_file.path)
        text = safe_read_text(path, encoding="utf-8-sig")
        if parse_chapters(text):
            raise SourceFileManagerError("Source file already contains recognized chapters")
        body = text.strip()
        heading = self._chapter_heading(chapter_no, title)
        prefix = (content_prefix or "").strip()
        pieces = [heading]
        if prefix:
            pieces.append(prefix)
        if body:
            pieces.append(body)
        backup_path = self._backup_source(path)
        safe_write_text(path, "\n\n".join(pieces).rstrip() + "\n", encoding="utf-8")
        scan = LibraryScanner(self.session).scan()
        chapter = self.session.scalar(select(Chapter).where(Chapter.chapter_no == chapter_no, Chapter.active.is_(True)))
        relative_backup_path = self._relative_runtime_path(backup_path)
        self.session.add(
            Event(
                event_type="source_file_normalized",
                entity_type="source_file",
                entity_id=source_file.id,
                payload_json=json.dumps(
                    {
                        "source_file_id": source_file.id,
                        "path": source_file.path,
                        "backup_path": relative_backup_path,
                        "chapter_no": chapter_no,
                        "title": title,
                        "note": "规范化未识别正文 Markdown，只补充标准章节标题，不等同于发布正文。",
                    },
                    ensure_ascii=False,
                ),
            )
        )
        self.session.commit()
        return CreatedSource(
            path=source_file.path,
            source_file_id=source_file.id,
            chapter_id=chapter.id if chapter else None,
            backup_path=relative_backup_path,
            scan=scan,
        )

    def _source_root(self, root_key: str) -> SourceRootSpec:
        specs = list(self.workspace.source_specs())
        if root_key == "chapters":
            return self._first_matching(specs, lambda spec: spec.kind == "chapters")
        if root_key == "outlines":
            return self._first_matching(specs, lambda spec: spec.kind == "outlines")
        if root_key in {"system", "settings"}:
            return self._first_matching(specs, lambda spec: spec.kind == "settings" and not spec.directory.name.startswith("00-")) or self._first_matching(
                specs,
                lambda spec: spec.kind == "settings",
            )
        raise SourceFileManagerError("Unsupported source root")

    def _first_matching(self, specs: list[SourceRootSpec], predicate) -> SourceRootSpec:
        for spec in specs:
            if predicate(spec):
                return spec
        raise SourceFileManagerError("Source root is not available in current workspace")

    def _clean_filename(self, filename: str) -> str:
        value = filename.strip().replace("\\", "/")
        if not value:
            raise SourceFileManagerError("Filename is required")
        if "/" in value or value in {".", ".."}:
            raise SourceFileManagerError("Filename must not contain folders")
        self._validate_path_component(value)
        if self._is_protected_component(value):
            raise SourceFileManagerError("Protected filename is not allowed")
        if not value.lower().endswith(".md"):
            value = f"{value}.md"
        return value

    def _clean_relative_path(self, value: str | None, *, allow_empty: bool) -> str:
        raw = (value or "").strip().replace("\\", "/").strip("/")
        if not raw:
            if allow_empty:
                return ""
            raise SourceFileManagerError("Folder name is required")
        parts = [part.strip() for part in raw.split("/") if part.strip()]
        if not parts:
            if allow_empty:
                return ""
            raise SourceFileManagerError("Folder name is required")
        for part in parts:
            self._validate_path_component(part)
            if part in {".", ".."} or self._is_protected_component(part):
                raise SourceFileManagerError("Folder path contains protected or unsafe parts")
        return "/".join(parts)

    def _ensure_allowed_target(self, path: Path) -> None:
        relative = path.resolve().relative_to(self.workspace.root.resolve()).as_posix()
        lowered_parts = {part.lower() for part in relative.split("/")}
        if "runtime" in lowered_parts or "key.txt" in lowered_parts or ".env" in lowered_parts:
            raise SourceFileManagerError("Protected workspace paths cannot be modified")

    def _backup_source(self, source_file: Path) -> Path:
        backup_dir = workspace_runtime_root(self.workspace.info) / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_path = backup_dir / f"{source_file.stem}_{datetime.now(UTC).strftime('%Y%m%d%H%M%S%f')}{source_file.suffix}"
        shutil.copy2(source_file, backup_path)
        return backup_path

    def _relative_runtime_path(self, path: Path) -> str:
        return path.resolve().relative_to(workspace_runtime_root(self.workspace.info).resolve()).as_posix()

    def _is_protected_component(self, value: str) -> bool:
        lowered = value.strip().lower()
        return lowered in {"runtime", "key.txt", ".env"} or lowered.startswith(".")

    def _validate_path_component(self, value: str) -> None:
        name = value.strip()
        if not name:
            raise SourceFileManagerError("Path component is required")
        if any(char in WINDOWS_FORBIDDEN_CHARS for char in name) or any(ord(char) < 32 for char in name):
            raise SourceFileManagerError("Path component contains characters that are not allowed on Windows")
        if name[-1] in {" ", "."}:
            raise SourceFileManagerError("Path component must not end with a space or dot")
        stem = name.split(".", 1)[0].upper()
        if stem in WINDOWS_RESERVED_NAMES:
            raise SourceFileManagerError("Reserved Windows device names are not allowed")

    def _chapter_template(self, chapter_no: int, title: str | None, content: str | None) -> str:
        body = (content or "").strip()
        return f"{self._chapter_heading(chapter_no, title)}\n\n{body}\n"

    def _chapter_heading(self, chapter_no: int, title: str | None) -> str:
        cleaned_title = (title or "").strip() or f"第{chapter_no:03d}章"
        return f"# 第{chapter_no:03d}章 {cleaned_title}"

    def _blank_template(self, title: str | None, content: str | None) -> str:
        body = (content or "").strip()
        cleaned_title = (title or "").strip()
        if cleaned_title and body:
            return f"# {cleaned_title}\n\n{body}\n"
        if cleaned_title:
            return f"# {cleaned_title}\n\n"
        if body:
            return f"{body}\n"
        return ""

    def _active_chapter_exists(self, chapter_no: int) -> bool:
        return self.session.scalar(select(Chapter.id).where(Chapter.chapter_no == chapter_no, Chapter.active.is_(True))) is not None
