import difflib
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.orm import Session

from backend.app.core.file_utils import safe_read_text, safe_write_text
from backend.app.db.models import Chapter, ChapterVersion, Event, SourceFile
from backend.app.services.library import LibraryScanner
from backend.app.services.memory import MemoryService
from backend.app.services.review_publish import publish_locks
from backend.app.services.workspace import WorkspaceResolver, workspace_runtime_root
from backend.app.utils.hashing import sha256_file
from backend.app.utils.hashing import sha256_text


class ChapterVersionError(ValueError):
    pass


class ChapterVersionService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.workspace = WorkspaceResolver()
        self.runtime_root = workspace_runtime_root(self.workspace.info)

    def version_content(self, chapter_id: int, version_id: int) -> dict:
        chapter, version = self._chapter_and_version(chapter_id, version_id)
        return {
            "chapter_id": chapter.id,
            "version_id": version.id,
            "title": version.title,
            "text": self._version_text(chapter, version),
            "is_current": version.id == chapter.current_version_id,
        }

    def save_unpublished_version(self, chapter: Chapter, text: str, *, title: str | None = None) -> ChapterVersion:
        self._validate_source(chapter.source_file)
        body_hash = sha256_text(text)
        snapshot_path = self._write_snapshot(chapter.id, body_hash, text)
        version = ChapterVersion(
            chapter_id=chapter.id,
            source_file_id=chapter.source_file_id,
            body_hash=body_hash,
            source_file_hash=chapter.source_file.sha256,
            title=title or chapter.title,
            text_snapshot_path=snapshot_path,
            range_start=chapter.range_start,
            range_end=chapter.range_end,
        )
        self.session.add(version)
        self.session.flush()
        return version

    def version_diff(self, chapter_id: int, version_id: int) -> dict:
        chapter, version = self._chapter_and_version(chapter_id, version_id)
        current = self._current_text(chapter)
        target = self._version_text(chapter, version)
        diff_text = "\n".join(
            difflib.unified_diff(
                current.splitlines(),
                target.splitlines(),
                fromfile="current",
                tofile=f"version_{version.id}",
                lineterm="",
            )
        )
        return {"chapter_id": chapter.id, "version_id": version.id, "diff": diff_text}

    def publish_version(self, chapter_id: int, version_id: int, *, approved_by_user: bool) -> dict:
        if not approved_by_user:
            raise ChapterVersionError("Version publish requires approved_by_user=true")
        chapter, version = self._chapter_and_version(chapter_id, version_id)
        if version.id == chapter.current_version_id:
            raise ChapterVersionError("Chapter version is already current")
        source = chapter.source_file
        self._validate_source(source)
        target = self._version_text(chapter, version)
        if not target.startswith("#"):
            raise ChapterVersionError("Chapter version must start with a Markdown heading")

        with publish_locks.acquire(source.id):
            source_path = self.workspace.resolve_source_path(source.path)
            if sha256_file(source_path) != source.sha256:
                raise ChapterVersionError("Source file hash changed; rescan before publishing version")
            original = safe_read_text(source_path, encoding="utf-8-sig")
            published_text = self._replace_current_chapter(original, chapter, target)
            backup_path = self._backup_source(source_path)
            diff_path = self._write_diff(chapter, version, original[chapter.range_start : chapter.range_end], target)
            if sha256_file(source_path) != source.sha256:
                raise ChapterVersionError("Source file hash changed before version publish write")
            self._atomic_write(source_path, published_text)
            try:
                LibraryScanner(self.session).scan()
                MemoryService(self.session).rebuild()
            except Exception:
                self._atomic_write(source_path, safe_read_text(backup_path, encoding="utf-8-sig"))
                self.session.rollback()
                self.session.add(
                    Event(
                        event_type="chapter_version_publish_rolled_back",
                        entity_type="chapter_version",
                        entity_id=version.id,
                        payload_json=json.dumps(
                            {
                                "chapter_id": chapter.id,
                                "source_file_id": source.id,
                                "backup_path": self._relative_runtime_path(backup_path),
                            },
                            ensure_ascii=False,
                        ),
                    )
                )
                self.session.commit()
                raise

            self.session.add(
                Event(
                    event_type="chapter_version_published",
                    entity_type="chapter_version",
                    entity_id=version.id,
                    payload_json=json.dumps(
                        {
                            "chapter_id": chapter.id,
                            "source_file_id": source.id,
                            "backup_path": self._relative_runtime_path(backup_path),
                            "diff_path": self._relative_runtime_path(diff_path),
                            "source_hash_before": source.sha256,
                            "version_body_hash": version.body_hash,
                        },
                        ensure_ascii=False,
                    ),
                )
            )
            self.session.commit()
            return {
                "chapter_id": chapter.id,
                "version_id": version.id,
                "published": True,
                "backup_path": self._relative_runtime_path(backup_path),
                "diff_path": self._relative_runtime_path(diff_path),
            }

    def _chapter_and_version(self, chapter_id: int, version_id: int) -> tuple[Chapter, ChapterVersion]:
        chapter = self.session.get(Chapter, chapter_id)
        if chapter is None or not chapter.active:
            raise ChapterVersionError("Chapter not found")
        version = self.session.get(ChapterVersion, version_id)
        if version is None or version.chapter_id != chapter.id:
            raise ChapterVersionError("Chapter version not found")
        return chapter, version

    def _version_text(self, chapter: Chapter, version: ChapterVersion) -> str:
        if version.text_snapshot_path:
            return safe_read_text(self._runtime_safe_path(version.text_snapshot_path), encoding="utf-8")
        if version.source_file_hash == chapter.source_file.sha256:
            source = safe_read_text(self.workspace.resolve_source_path(chapter.source_file.path), encoding="utf-8-sig")
            return source[version.range_start : version.range_end]
        if version.id == chapter.current_version_id:
            return self._current_text(chapter)
        raise ChapterVersionError("Chapter version snapshot is missing")

    def _current_text(self, chapter: Chapter) -> str:
        source = safe_read_text(self.workspace.resolve_source_path(chapter.source_file.path), encoding="utf-8-sig")
        return source[chapter.range_start : chapter.range_end]

    def _replace_current_chapter(self, original: str, chapter: Chapter, target: str) -> str:
        if chapter.range_end < len(original) and original[chapter.range_end :].startswith("#") and not target.endswith("\n"):
            target = f"{target}\n"
        return original[: chapter.range_start] + target + original[chapter.range_end :]

    def _validate_source(self, source: SourceFile) -> None:
        if not source.active or source.kind != "chapters":
            raise ChapterVersionError("Only chapter versions can be published")

    def _runtime_safe_path(self, relative_path: str) -> Path:
        root = self.runtime_root.resolve()
        path = (root / relative_path).resolve()
        if path != root and root not in path.parents:
            raise ChapterVersionError("Chapter version path escapes runtime root")
        return path

    def _backup_source(self, source_file: Path) -> Path:
        backup_dir = self.runtime_root / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_path = backup_dir / f"{source_file.stem}_{datetime.now(UTC).strftime('%Y%m%d%H%M%S%f')}{source_file.suffix}"
        shutil.copy2(source_file, backup_path)
        return backup_path

    def _write_diff(self, chapter: Chapter, version: ChapterVersion, current: str, target: str) -> Path:
        diff_dir = self.runtime_root / "diffs"
        diff_dir.mkdir(parents=True, exist_ok=True)
        diff_text = "\n".join(
            difflib.unified_diff(
                current.splitlines(),
                target.splitlines(),
                fromfile=f"chapter_{chapter.id}_current",
                tofile=f"chapter_{chapter.id}_version_{version.id}",
                lineterm="",
            )
        )
        diff_path = diff_dir / f"chapter_{chapter.id}_version_{version.id}_{datetime.now(UTC).strftime('%Y%m%d%H%M%S%f')}.diff"
        safe_write_text(diff_path, diff_text, encoding="utf-8")
        return diff_path

    def _write_snapshot(self, chapter_id: int, body_hash: str, text: str) -> str:
        directory = self.runtime_root / "versions"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"chapter_{chapter_id}_{body_hash[:12]}.md"
        safe_write_text(path, text, encoding="utf-8")
        return self._relative_runtime_path(path)

    def _relative_runtime_path(self, path: Path) -> str:
        return path.resolve().relative_to(self.runtime_root.resolve()).as_posix()

    def _atomic_write(self, path: Path, text: str) -> None:
        temp_path = path.with_name(f".{path.name}.tmp")
        safe_write_text(temp_path, text, encoding="utf-8")
        temp_path.replace(path)
