import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.app.core.file_utils import safe_read_text
from backend.app.utils.hashing import sha256_text


ROLE_TASK_SKILLS: dict[str, list[str]] = {
    "writer": [
        "writing/fanqie_style.md",
        "writing/chapter_body_rules.md",
        "writing/numeric_xianxia_style.md",
    ],
    "quick_fix": ["fix/no_new_setting.md", "fix/patch_rules.md"],
    "fixer": ["fix/no_new_setting.md", "fix/patch_rules.md"],
    "reviewer": [
        "review/evidence_guard.md",
        "review/hallucination_guard.md",
        "review/numeric_xianxia_review_checklist.md",
    ],
    "long_context": ["memory/clue_extraction.md"],
    "memory": ["memory/clue_extraction.md"],
    "outliner": ["outline/webnovel_structure.md"],
    "outline": ["outline/webnovel_structure.md"],
}

TASK_ROLE_MAP: dict[str, str] = {
    "generate_chapter_draft": "writer",
    "revise_from_annotations": "quick_fix",
    "fix_chapter_candidate": "quick_fix",
    "review_chapter_candidate": "reviewer",
    "review_outline_proposal": "reviewer",
    "summarize_published_chapter": "long_context",
    "rebuild_structured_memory": "long_context",
    "generate_outline_proposal": "outliner",
}


@dataclass(frozen=True)
class Skill:
    name: str
    version: str
    role: str
    scope: str
    enabled: bool
    path: str
    content: str
    sha256: str


class SkillLoader:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path(__file__).resolve().parents[3] / "skills"

    def load_for_task(self, task_type: str) -> list[Skill]:
        return self.load_for_role(TASK_ROLE_MAP.get(task_type, task_type))

    def load_for_role(self, role: str) -> list[Skill]:
        skills: list[Skill] = []
        for relative in ROLE_TASK_SKILLS.get(role, []):
            path = self.root / relative
            if not path.exists():
                continue
            skill = self._read(path)
            if skill.enabled:
                skills.append(skill)
        return skills

    def list_enabled(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        if not self.root.exists():
            return items
        for path in sorted(self.root.rglob("*.md")):
            skill = self._read(path)
            if skill.enabled:
                items.append(_with_empty_usage(skill_summary(skill)))
        return items

    def list_enabled_with_usage(self, artifacts: list[Any], runtime_root: Path) -> list[dict[str, Any]]:
        usage = skill_usage_from_artifacts(artifacts, runtime_root)
        items = []
        for item in self.list_enabled():
            by_path = usage["by_path"].get(item["path"])
            by_hash = usage["by_sha256"].get(item["sha256"])
            latest = by_path or by_hash or {}
            enriched = _with_empty_usage(item)
            enriched.update(
                {
                    "last_used_at": latest.get("last_used_at"),
                    "last_used_task_type": latest.get("last_used_task_type"),
                    "last_used_artifact_id": latest.get("last_used_artifact_id"),
                    "last_used_chapter_id": latest.get("last_used_chapter_id"),
                    "included_in_latest_context": item["path"] in usage["latest_paths"]
                    or item["sha256"] in usage["latest_sha256"],
                }
            )
            items.append(enriched)
        return items

    def _read(self, path: Path) -> Skill:
        text = safe_read_text(path, encoding="utf-8")
        metadata, content = parse_front_matter(text)
        relative = path.relative_to(self.root).as_posix()
        return Skill(
            name=str(metadata.get("name") or path.stem),
            version=str(metadata.get("version") or "1"),
            role=str(metadata.get("role") or relative.split("/", 1)[0]),
            scope=str(metadata.get("scope") or ""),
            enabled=parse_enabled(metadata.get("enabled", True)),
            path=relative,
            content=content.strip(),
            sha256=sha256_text(text),
        )


def parse_front_matter(text: str) -> tuple[dict[str, Any], str]:
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text
    metadata: dict[str, Any] = {}
    for line in parts[1].splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip()
    return metadata, parts[2]


def parse_enabled(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in {"0", "false", "no", "off", "disabled"}


def skill_summary(skill: Skill) -> dict[str, Any]:
    return {
        "name": skill.name,
        "version": skill.version,
        "role": skill.role,
        "scope": skill.scope,
        "enabled": skill.enabled,
        "path": skill.path,
        "sha256": skill.sha256,
    }


def _with_empty_usage(item: dict[str, Any]) -> dict[str, Any]:
    enriched = dict(item)
    enriched.setdefault("last_used_at", None)
    enriched.setdefault("last_used_task_type", None)
    enriched.setdefault("last_used_artifact_id", None)
    enriched.setdefault("last_used_chapter_id", None)
    enriched.setdefault("included_in_latest_context", False)
    return enriched


def skill_usage_from_artifacts(artifacts: list[Any], runtime_root: Path) -> dict[str, Any]:
    by_path: dict[str, dict[str, Any]] = {}
    by_sha256: dict[str, dict[str, Any]] = {}
    latest_context_key = ""
    latest_paths: set[str] = set()
    latest_sha256: set[str] = set()

    for artifact in artifacts:
        metadata = _loads_json(getattr(artifact, "metadata_json", None), {})
        reports = _context_reports(artifact, metadata, runtime_root)
        for report in reports:
            skills = report.get("skills")
            if not isinstance(skills, list):
                continue
            created_at = getattr(artifact, "created_at", None)
            task_type = report.get("task_type") or metadata.get("task_type")
            chapter_id = report.get("chapter_id") or getattr(artifact, "base_chapter_id", None)
            report_paths: set[str] = set()
            report_sha256: set[str] = set()
            for skill in skills:
                if not isinstance(skill, dict):
                    continue
                path = str(skill.get("path") or "").strip()
                sha256 = str(skill.get("sha256") or "").strip()
                if not path and not sha256:
                    continue
                record = {
                    "last_used_at": _datetime_to_json(created_at),
                    "last_used_task_type": task_type,
                    "last_used_artifact_id": getattr(artifact, "id", None),
                    "last_used_chapter_id": chapter_id,
                }
                if path:
                    report_paths.add(path)
                    if _is_newer(record, by_path.get(path)):
                        by_path[path] = record
                if sha256:
                    report_sha256.add(sha256)
                    if _is_newer(record, by_sha256.get(sha256)):
                        by_sha256[sha256] = record
            created_key = _datetime_key(created_at)
            if created_key >= latest_context_key:
                latest_context_key = created_key
                latest_paths = report_paths
                latest_sha256 = report_sha256
    return {
        "by_path": by_path,
        "by_sha256": by_sha256,
        "latest_paths": latest_paths,
        "latest_sha256": latest_sha256,
    }


def _context_reports(artifact: Any, metadata: dict[str, Any], runtime_root: Path) -> list[dict[str, Any]]:
    reports: list[dict[str, Any]] = []
    inline_report = metadata.get("context_report")
    if isinstance(inline_report, dict):
        reports.append(inline_report)
    if getattr(artifact, "kind", None) == "context_report":
        path = _safe_runtime_path(runtime_root, str(getattr(artifact, "path", "")))
        if path is not None and path.exists() and path.is_file():
            payload = _loads_json(safe_read_text(path, encoding="utf-8"), {})
            if isinstance(payload, dict):
                reports.append(payload)
    return reports


def _safe_runtime_path(runtime_root: Path, relative_path: str) -> Path | None:
    root = runtime_root.resolve()
    try:
        path = (root / relative_path).resolve()
    except OSError:
        return None
    if path == root or root in path.parents:
        return path
    return None


def _loads_json(raw: str | None, fallback: Any) -> Any:
    try:
        payload = json.loads(raw or "")
    except (TypeError, json.JSONDecodeError):
        return fallback
    if isinstance(fallback, dict):
        return payload if isinstance(payload, dict) else fallback
    return payload


def _is_newer(candidate: dict[str, Any], current: dict[str, Any] | None) -> bool:
    if current is None:
        return True
    return str(candidate.get("last_used_at") or "") >= str(current.get("last_used_at") or "")


def _datetime_to_json(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat()
    return None


def _datetime_key(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return ""
