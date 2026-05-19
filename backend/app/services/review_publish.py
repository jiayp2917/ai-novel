import difflib
import json
import shutil
import threading
from datetime import UTC, datetime
from pathlib import Path
from contextlib import contextmanager
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.file_utils import safe_read_text, safe_write_text
from backend.app.core.config import get_settings
from backend.app.db.models import Artifact, Chapter, ChapterVersion, Event, PublishDecision, Review, SourceFile
from backend.app.repositories import Repository
from backend.app.services.annotations import NotFoundError
from backend.app.services.library import LibraryScanner
from backend.app.services.memory import MemoryService
from backend.app.services.model_client import ChatMessage, ModelClient
from backend.app.services.workspace import WorkspaceResolver, workspace_runtime_root
from backend.app.utils.hashing import sha256_file


class ReviewPublishError(ValueError):
    pass


class ReviewPublishService:
    def __init__(self, session: Session, *, model_client: ModelClient | None = None) -> None:
        self.session = session
        self.settings = get_settings()
        self.model_client = model_client or ModelClient(session)
        self.reviews = Repository(session, Review)
        self.workspace = WorkspaceResolver()
        self.runtime_root = workspace_runtime_root(self.workspace.info)

    def review_artifact(self, artifact_id: int, *, force: bool = False) -> dict:
        artifact = self._artifact(artifact_id)
        self._validate_artifact_file(artifact)
        candidate = self._artifact_text(artifact)
        response = self.model_client.chat(
            role="reviewer",
            force=force,
            require_json=True,
            temperature=0.0,
            messages=[
                ChatMessage(
                    role="system",
                    content=(
                        "You are a strict novel consistency reviewer. Output strict JSON only. "
                        "Every issue must include evidence. Issues without evidence must use owner=admin."
                    ),
                ),
                ChatMessage(role="user", content=self._review_prompt(artifact, candidate)),
            ],
        )
        try:
            payload = json.loads(response.content)
        except json.JSONDecodeError:
            raw = self._save_raw_review(response.content, artifact)
            raise ReviewPublishError(f"Review JSON parse failed; raw_artifact_id={raw.id}")
        if not isinstance(payload, dict):
            issues = [
                {
                    "chapter": None,
                    "severity": "blocking",
                    "type": "invalid_review",
                    "description": "Review output is not a JSON object.",
                    "evidence": "",
                    "owner": "admin",
                    "fix_instruction": "Regenerate review with the required schema.",
                }
            ]
            payload = {"passed": False, "issues": issues}

        issues = self._normalize_issues(payload.get("issues", []))
        passed = bool(payload.get("passed", False)) and not self._has_blocking_issue(issues)
        evidence_count = sum(1 for issue in issues if issue.get("evidence"))
        manual_required = any(issue.get("owner") == "admin" for issue in issues)
        review = self.reviews.create(
            {
                "artifact_id": artifact.id,
                "passed": passed,
                "issues_json": json.dumps(issues, ensure_ascii=False),
                "evidence_count": evidence_count,
                "manual_required": manual_required,
                "candidate_hash": artifact.sha256,
                "base_source_file_hash": artifact.base_source_file_hash,
                "base_chapter_version_id": artifact.base_chapter_version_id,
            }
        )
        self.session.commit()
        return {
            "review_id": review.id,
            "artifact_id": artifact.id,
            "passed": review.passed,
            "evidence_count": review.evidence_count,
            "manual_required": review.manual_required,
            "issues": issues,
        }

    def diff_artifact(self, artifact_id: int) -> dict:
        artifact = self._artifact(artifact_id)
        self._validate_artifact_file(artifact)
        diff_text = self._diff_text(artifact)
        return {"artifact_id": artifact.id, "diff": diff_text, "path": None}

    def write_diff_artifact(self, artifact_id: int) -> dict:
        artifact = self._artifact(artifact_id)
        self._validate_artifact_file(artifact)
        diff_text = self._diff_text(artifact)
        path = self._runtime_path("diffs") / f"artifact_{artifact.id}.diff"
        safe_write_text(path, diff_text, encoding="utf-8")
        return {"artifact_id": artifact.id, "diff": diff_text, "path": path.relative_to(self.runtime_root).as_posix()}

    def _diff_text(self, artifact: Artifact) -> str:
        original = self._base_text(artifact)
        candidate = self._artifact_text(artifact)
        return "\n".join(
            difflib.unified_diff(
                original.splitlines(),
                candidate.splitlines(),
                fromfile="source",
                tofile="candidate",
                lineterm="",
            )
        )

    def publish_artifact(
        self,
        artifact_id: int,
        *,
        approved_by_user: bool,
        force: bool = False,
        force_reason: str | None = None,
    ) -> dict:
        artifact = self._artifact(artifact_id)
        self._validate_artifact_file(artifact)
        if not approved_by_user:
            raise ReviewPublishError("Publish requires approved_by_user=true")
        if artifact.base_source_file_id is None or artifact.base_source_file_hash is None:
            raise ReviewPublishError("Artifact has no base source file")
        self._validate_publish_source_kind(artifact)
        review = self._latest_review(artifact.id)
        if self._requires_ai_review_for_publish(artifact):
            if review is None:
                raise ReviewPublishError("Publish requires a review")
            if not review.passed and not (force and force_reason):
                raise ReviewPublishError("Review did not pass; force requires force_reason")
            if force and not force_reason:
                raise ReviewPublishError("force_reason is required when force=true")
            self._validate_review_binding(review, artifact)
        elif force and not force_reason:
            raise ReviewPublishError("force_reason is required when force=true")
        with publish_locks.acquire(artifact.base_source_file_id):
            source_file = self.workspace.resolve_source_path(self._source_path(artifact))
            if sha256_file(source_file) != artifact.base_source_file_hash:
                raise ReviewPublishError("Source file hash changed; rescan and regenerate candidate")

            candidate = self._artifact_text(artifact)
            original = safe_read_text(source_file, encoding="utf-8-sig")
            published_text = self._published_text(artifact, original, candidate)
            backup_path = self._backup_source(source_file)
            diff_info = self.write_diff_artifact(artifact.id)
            if sha256_file(source_file) != artifact.base_source_file_hash:
                raise ReviewPublishError("Source file hash changed before publish write")
            self._atomic_write(source_file, published_text)
            try:
                LibraryScanner(self.session).scan()
                MemoryService(self.session).rebuild()
            except Exception:
                self._atomic_write(source_file, safe_read_text(backup_path, encoding="utf-8-sig"))
                self.session.rollback()
                self.session.add(
                    Event(
                        event_type="artifact_publish_rolled_back",
                        entity_type="artifact",
                        entity_id=artifact.id,
                        payload_json=json.dumps(
                            {
                                "source_file_id": artifact.base_source_file_id,
                                "backup_path": backup_path.relative_to(self.runtime_root).as_posix(),
                            },
                            ensure_ascii=False,
                        ),
                    )
                )
                self.session.commit()
                raise

            decision = PublishDecision(
                artifact_id=artifact.id,
                approved_by_user=approved_by_user,
                force=force,
                force_reason=force_reason,
                source_hash_before=artifact.base_source_file_hash,
                candidate_hash=artifact.sha256,
                diff_path=diff_info["path"],
                backup_path=backup_path.relative_to(self.runtime_root).as_posix(),
                published_at=datetime.now(UTC),
            )
            self.session.add(decision)
            self.session.add(
                Event(
                    event_type="artifact_published",
                    entity_type="artifact",
                    entity_id=artifact.id,
                    payload_json=json.dumps(
                        {
                            "source_file_id": artifact.base_source_file_id,
                            "backup_path": decision.backup_path,
                            "diff_path": decision.diff_path,
                            "original_chars": len(original),
                            "candidate_chars": len(candidate),
                        },
                        ensure_ascii=False,
                    ),
                )
            )
            self.session.commit()
            return {
                "artifact_id": artifact.id,
                "published": True,
                "backup_path": decision.backup_path,
                "diff_path": decision.diff_path,
                "publish_decision_id": decision.id,
            }

    def _review_prompt(self, artifact: Artifact, candidate: str) -> str:
        return json.dumps(
            {
                "artifact_id": artifact.id,
                "candidate": candidate,
                "required_schema": {
                    "passed": True,
                    "issues": [
                        {
                            "chapter": 1,
                            "severity": "blocking/high/medium/low",
                            "type": "logic/style/continuity/format",
                            "description": "string",
                            "evidence": "specific quote",
                            "owner": "writer/outliner/state/admin",
                            "fix_instruction": "direction only",
                        }
                    ],
                },
            },
            ensure_ascii=False,
        )

    def _normalize_issues(self, issues: Any) -> list[dict[str, Any]]:
        if not isinstance(issues, list):
            return [
                {
                    "chapter": None,
                    "severity": "blocking",
                    "type": "invalid_review",
                    "description": "Review issues field is not a list.",
                    "evidence": "",
                    "owner": "admin",
                    "fix_instruction": "Review output must be regenerated.",
                }
            ]
        normalized: list[dict[str, Any]] = []
        for issue in issues:
            if not isinstance(issue, dict):
                continue
            item = {
                "chapter": issue.get("chapter"),
                "severity": self._severity(str(issue.get("severity", "medium"))),
                "type": str(issue.get("type", "unknown")),
                "description": str(issue.get("description", "")),
                "evidence": str(issue.get("evidence", "")).strip(),
                "owner": self._owner(str(issue.get("owner", "writer"))),
                "fix_instruction": str(issue.get("fix_instruction", "")),
            }
            if not item["evidence"]:
                item["owner"] = "admin"
                item["severity"] = "blocking"
            normalized.append(item)
        return normalized

    def _severity(self, value: str) -> str:
        return value if value in {"blocking", "high", "medium", "low"} else "medium"

    def _owner(self, value: str) -> str:
        return value if value in {"writer", "outliner", "state", "admin"} else "admin"

    def _has_blocking_issue(self, issues: list[dict[str, Any]]) -> bool:
        return any(issue.get("severity") in {"blocking", "high", "medium"} for issue in issues)

    def _save_raw_review(self, content: str, artifact: Artifact) -> Artifact:
        from backend.app.services.artifacts import ArtifactStore

        raw = ArtifactStore(self.session).save_text(
            kind="review",
            text=content,
            metadata={"parse_failed": True, "candidate_artifact_id": artifact.id},
            base_chapter=self._base_chapter(artifact),
            suffix=".txt",
        )
        self.session.commit()
        return raw

    def _artifact(self, artifact_id: int) -> Artifact:
        artifact = self.session.get(Artifact, artifact_id)
        if artifact is None:
            raise NotFoundError("Artifact not found")
        return artifact

    def _artifact_text(self, artifact: Artifact) -> str:
        return safe_read_text(self._runtime_safe_path(artifact.path), encoding="utf-8")

    def _validate_artifact_file(self, artifact: Artifact) -> None:
        path = self._runtime_safe_path(artifact.path)
        if not path.exists():
            raise ReviewPublishError("Artifact file is missing")
        if sha256_file(path) != artifact.sha256:
            raise ReviewPublishError("Artifact file hash mismatch")

    def _runtime_safe_path(self, relative_path: str) -> Path:
        root = self.runtime_root.resolve()
        path = (root / relative_path).resolve()
        if path != root and root not in path.parents:
            raise ReviewPublishError("Artifact path escapes runtime root")
        return path

    def _base_text(self, artifact: Artifact) -> str:
        source = safe_read_text(self.workspace.resolve_source_path(self._source_path(artifact)), encoding="utf-8-sig")
        chapter = self._base_chapter(artifact)
        if chapter is None:
            return source
        return source[chapter.range_start : chapter.range_end]

    def _published_text(self, artifact: Artifact, original: str, candidate: str) -> str:
        chapter = self._base_chapter(artifact)
        if chapter is None:
            return candidate
        version = self._base_version(artifact)
        if version.source_file_hash != artifact.base_source_file_hash:
            raise ReviewPublishError("Chapter version does not match artifact source hash")
        if not candidate.startswith("#"):
            raise ReviewPublishError("Chapter candidate must start with a Markdown heading")
        if chapter.title and chapter.title not in candidate.splitlines()[0]:
            raise ReviewPublishError("Chapter title changed; regenerate candidate or force after review")
        if version.range_end < len(original) and original[version.range_end :].startswith("#") and not candidate.endswith("\n"):
            candidate = f"{candidate}\n"
        return original[: version.range_start] + candidate + original[version.range_end :]

    def _base_chapter(self, artifact: Artifact) -> Chapter | None:
        if artifact.base_chapter_id is None:
            return None
        chapter = self.session.get(Chapter, artifact.base_chapter_id)
        if chapter is None:
            raise ReviewPublishError("Base chapter not found")
        return chapter

    def _base_version(self, artifact: Artifact) -> ChapterVersion:
        if artifact.base_chapter_version_id is None:
            raise ReviewPublishError("Artifact has no base chapter version")
        version = self.session.get(ChapterVersion, artifact.base_chapter_version_id)
        if version is None:
            raise ReviewPublishError("Base chapter version not found")
        return version

    def _validate_review_binding(self, review: Review, artifact: Artifact) -> None:
        if review.artifact_id != artifact.id:
            raise ReviewPublishError("Review does not belong to artifact")
        if review.candidate_hash != artifact.sha256:
            raise ReviewPublishError("Review candidate hash does not match artifact")
        if review.base_source_file_hash != artifact.base_source_file_hash:
            raise ReviewPublishError("Review source hash does not match artifact")
        if review.base_chapter_version_id != artifact.base_chapter_version_id:
            raise ReviewPublishError("Review chapter version does not match artifact")

    def _source_path(self, artifact: Artifact) -> str:
        if artifact.base_source_file_id is None:
            raise ReviewPublishError("Artifact has no base source file")

        source = self.session.get(SourceFile, artifact.base_source_file_id)
        if source is None:
            raise ReviewPublishError("Base source file not found")
        return source.path

    def _validate_publish_source_kind(self, artifact: Artifact) -> None:
        source = self.session.get(SourceFile, artifact.base_source_file_id)
        if source is None:
            raise ReviewPublishError("Base source file not found")
        if artifact.kind != "candidate" or not source.active or source.kind != "chapters" or artifact.base_chapter_id is None:
            raise ReviewPublishError("Only chapter artifacts can be published from this workflow")

    def _requires_ai_review_for_publish(self, artifact: Artifact) -> bool:
        metadata = self._artifact_metadata(artifact)
        return not (
            metadata.get("source") == "manual_editor_draft"
            and metadata.get("requires_ai_review") is False
            and artifact.kind == "candidate"
            and artifact.base_chapter_id is not None
        )

    def _artifact_metadata(self, artifact: Artifact) -> dict[str, Any]:
        try:
            payload = json.loads(artifact.metadata_json or "{}")
        except json.JSONDecodeError:
            return {}
        return payload if isinstance(payload, dict) else {}

    def _latest_review(self, artifact_id: int) -> Review | None:
        return self.session.scalar(
            select(Review).where(Review.artifact_id == artifact_id).order_by(Review.id.desc())
        )

    def _runtime_path(self, name: str) -> Path:
        path = self.runtime_root / name
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _backup_source(self, source_file: Path) -> Path:
        backup_dir = self._runtime_path("backups")
        backup_path = backup_dir / f"{source_file.stem}_{datetime.now(UTC).strftime('%Y%m%d%H%M%S%f')}{source_file.suffix}"
        shutil.copy2(source_file, backup_path)
        return backup_path

    def _atomic_write(self, path: Path, text: str) -> None:
        temp_path = path.with_name(f".{path.name}.tmp")
        safe_write_text(temp_path, text, encoding="utf-8")
        temp_path.replace(path)


class PublishLockRegistry:
    def __init__(self) -> None:
        self._guard = threading.Lock()
        self._locks: dict[int, threading.Lock] = {}

    @contextmanager
    def acquire(self, source_file_id: int):
        lock = self._lock_for(source_file_id)
        lock.acquire()
        try:
            yield
        finally:
            lock.release()

    def _lock_for(self, source_file_id: int) -> threading.Lock:
        with self._guard:
            lock = self._locks.get(source_file_id)
            if lock is None:
                lock = threading.Lock()
                self._locks[source_file_id] = lock
            return lock


publish_locks = PublishLockRegistry()
