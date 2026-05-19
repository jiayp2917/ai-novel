import json
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from backend.app.db.models import Artifact, Chapter, SourceFile
from backend.app.repositories import Repository
from backend.app.services.workspace import workspace_runtime_root
from backend.app.utils.hashing import sha256_file, sha256_text


class ArtifactStore:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.artifacts = Repository(session, Artifact)
        self.runtime_root = workspace_runtime_root()

    def save_text(
        self,
        *,
        kind: str,
        text: str,
        metadata: dict[str, Any],
        base_chapter: Chapter | None = None,
        base_source_file: SourceFile | None = None,
        suffix: str = ".md",
    ) -> Artifact:
        directory = self.runtime_root / "artifacts" / kind
        directory.mkdir(parents=True, exist_ok=True)
        digest = sha256_text(text)
        path = directory / f"{kind}_{digest[:12]}{suffix}"
        path.write_text(text, encoding="utf-8")
        return self.create_from_file(
            kind=kind,
            path=path,
            metadata=metadata,
            base_chapter=base_chapter,
            base_source_file=base_source_file,
        )

    def save_json(
        self,
        *,
        kind: str,
        payload: dict[str, Any],
        metadata: dict[str, Any],
        base_chapter: Chapter | None = None,
        base_source_file: SourceFile | None = None,
    ) -> Artifact:
        text = json.dumps(payload, ensure_ascii=False, indent=2)
        return self.save_text(
            kind=kind,
            text=text,
            metadata=metadata,
            base_chapter=base_chapter,
            base_source_file=base_source_file,
            suffix=".json",
        )

    def create_from_file(
        self,
        *,
        kind: str,
        path: Path,
        metadata: dict[str, Any],
        base_chapter: Chapter | None = None,
        base_source_file: SourceFile | None = None,
    ) -> Artifact:
        relative_path = path.relative_to(self.runtime_root).as_posix()
        source = base_source_file or (base_chapter.source_file if base_chapter is not None else None)
        version = base_chapter.current_version if base_chapter is not None else None
        artifact = self.artifacts.create(
            {
                "kind": kind,
                "path": relative_path,
                "sha256": sha256_file(path),
                "base_source_file_id": source.id if source is not None else None,
                "base_source_file_hash": source.sha256 if source is not None else None,
                "base_chapter_id": base_chapter.id if base_chapter is not None else None,
                "base_chapter_version_id": version.id if version is not None else None,
                "metadata_json": json.dumps(metadata, ensure_ascii=False),
            }
        )
        return artifact
