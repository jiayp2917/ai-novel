from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.app.utils.hashing import sha256_text


ROLE_TASK_SKILLS: dict[str, list[str]] = {
    "writer": ["writing/fanqie_style.md", "writing/chapter_body_rules.md"],
    "quick_fix": ["fix/no_new_setting.md", "fix/patch_rules.md"],
    "fixer": ["fix/no_new_setting.md", "fix/patch_rules.md"],
    "reviewer": ["review/evidence_guard.md", "review/hallucination_guard.md"],
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
                items.append(skill_summary(skill))
        return items

    def _read(self, path: Path) -> Skill:
        text = path.read_text(encoding="utf-8")
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
