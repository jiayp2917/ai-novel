import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.app.core.config import Settings, get_settings
from backend.app.utils.paths import safe_join


LEGACY_LAYOUT = "legacy"
CONTENT_LAYOUT = "content"
UNSUPPORTED_LAYOUT = "unsupported"

LEGACY_SOURCE_DIRS: tuple[tuple[str, str, str], ...] = (
    ("00-系统", "settings", "系统设定"),
    ("01-设定", "settings", "小说设定"),
    ("03-章纲", "outlines", "章纲"),
    ("02-正文", "chapters", "正文"),
)

CONTENT_SOURCE_DIRS: tuple[tuple[str, str, str], ...] = (
    ("settings", "settings", "设定"),
    ("outlines", "outlines", "大纲/章纲"),
    ("chapters", "chapters", "正文"),
)


@dataclass(frozen=True)
class SourceRootSpec:
    directory: Path
    kind: str
    label: str


@dataclass(frozen=True)
class WorkspaceInfo:
    root: Path
    layout: str
    source_roots: tuple[SourceRootSpec, ...]
    detected_counts: dict[str, int]


def app_root() -> Path:
    return Path(__file__).resolve().parents[3]


def app_runtime_root() -> Path:
    settings = get_settings()
    if settings.app_runtime_root is not None:
        return settings.app_runtime_root.resolve()
    if os.getenv("RUNTIME_ROOT"):
        return settings.runtime_root.resolve()
    if os.getenv("APP_DB_PATH"):
        return (settings.app_db_path.parent / "runtime").resolve()
    return settings.runtime_root.resolve()


def workspace_runtime_root(info: WorkspaceInfo | None = None, settings: Settings | None = None) -> Path:
    settings = settings or get_settings()
    if settings.workspace_runtime_root_override is not None:
        return settings.workspace_runtime_root_override.resolve()
    if settings is not get_settings() and os.getenv("PYTEST_CURRENT_TEST") and settings.runtime_root != Path("runtime"):
        return settings.runtime_root.resolve()
    info = info or get_active_workspace_info()
    return (info.root / "runtime").resolve()


def ensure_workspace_runtime_subdir(name: str, info: WorkspaceInfo | None = None) -> Path:
    path = workspace_runtime_root(info) / name
    path.mkdir(parents=True, exist_ok=True)
    return path


def workspace_config_path() -> Path:
    runtime = app_runtime_root()
    runtime.mkdir(parents=True, exist_ok=True)
    return runtime / "workspace.json"


def detect_workspace(root: Path) -> WorkspaceInfo:
    resolved = root.resolve()
    legacy_roots = tuple(
        SourceRootSpec(resolved / name, kind, label)
        for name, kind, label in LEGACY_SOURCE_DIRS
        if (resolved / name).exists()
    )
    if legacy_roots:
        return WorkspaceInfo(
            root=resolved,
            layout=LEGACY_LAYOUT,
            source_roots=legacy_roots,
            detected_counts=_detected_counts(legacy_roots),
        )

    direct_content_roots = tuple(
        SourceRootSpec(resolved / name, kind, label)
        for name, kind, label in CONTENT_SOURCE_DIRS
        if (resolved / name).exists()
    )
    if direct_content_roots:
        return WorkspaceInfo(
            root=resolved,
            layout=CONTENT_LAYOUT,
            source_roots=direct_content_roots,
            detected_counts=_detected_counts(direct_content_roots),
        )

    nested_root = resolved / "content"
    nested_content_roots = tuple(
        SourceRootSpec(nested_root / name, kind, label)
        for name, kind, label in CONTENT_SOURCE_DIRS
        if (nested_root / name).exists()
    )
    if nested_content_roots:
        return WorkspaceInfo(
            root=resolved,
            layout=CONTENT_LAYOUT,
            source_roots=nested_content_roots,
            detected_counts=_detected_counts(nested_content_roots),
        )

    return WorkspaceInfo(root=resolved, layout=UNSUPPORTED_LAYOUT, source_roots=(), detected_counts={})


def get_active_workspace_info() -> WorkspaceInfo:
    settings = get_settings()
    configured = _read_workspace_path()
    if configured is not None and configured.exists() and _workspace_config_should_override_content_root():
        configured_info = detect_workspace(configured)
        if configured_info.layout != UNSUPPORTED_LAYOUT:
            return configured_info

    content_info = detect_workspace(settings.content_root)
    if content_info.layout != UNSUPPORTED_LAYOUT:
        return content_info

    cwd_info = detect_workspace(Path.cwd())
    if cwd_info.layout != UNSUPPORTED_LAYOUT:
        return cwd_info

    return detect_workspace(settings.content_root)


def _workspace_config_should_override_content_root() -> bool:
    return True


def set_active_workspace(path: Path) -> WorkspaceInfo:
    resolved = path.resolve()
    if not resolved.exists() or not resolved.is_dir():
        raise ValueError("Workspace path does not exist or is not a directory")
    info = detect_workspace(resolved)
    if info.layout == UNSUPPORTED_LAYOUT:
        raise ValueError("Workspace does not contain supported source directories")
    workspace_config_path().write_text(
        json.dumps(
            {
                "active_workspace": str(info.root),
                "path": str(info.root),
                "workspace_layout": info.layout,
                "runtime_root": str(workspace_runtime_root(info)),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return info


class WorkspaceResolver:
    def __init__(self, root: Path | None = None) -> None:
        self.info = detect_workspace(root) if root is not None else get_active_workspace_info()
        self.root = self.info.root

    def source_specs(self) -> tuple[SourceRootSpec, ...]:
        return self.info.source_roots

    def relative_path(self, path: Path) -> str:
        return path.resolve().relative_to(self.root).as_posix()

    def resolve_source_path(self, relative_path: str) -> Path:
        return safe_join(self.root, relative_path)

    def status(self) -> dict[str, Any]:
        return workspace_status(self.info)


def workspace_status(info: WorkspaceInfo | None = None) -> dict[str, Any]:
    info = info or get_active_workspace_info()
    return {
        "root": str(info.root),
        "layout": info.layout,
        "app_root": str(app_root()),
        "app_runtime_root": str(app_runtime_root()),
        "runtime_root": str(workspace_runtime_root(info)),
        "runtime_override": get_settings().workspace_runtime_root_override is not None,
        "workspace_location": "in_repo" if _is_relative_to(info.root, app_root()) else "external",
        "detected_counts": info.detected_counts,
        "source_roots": [
            {
                "path": str(spec.directory),
                "relative_path": spec.directory.relative_to(info.root).as_posix(),
                "kind": spec.kind,
                "label": spec.label,
                "exists": spec.directory.exists(),
            }
            for spec in info.source_roots
        ],
    }


def _is_relative_to(path: Path, root: Path) -> bool:
    resolved_path = path.resolve()
    resolved_root = root.resolve()
    return resolved_path == resolved_root or resolved_root in resolved_path.parents


def _read_workspace_path() -> Path | None:
    path = workspace_config_path()
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    raw = payload.get("active_workspace") or payload.get("path")
    if not isinstance(raw, str) or not raw.strip():
        return None
    return Path(raw)


def _detected_counts(source_roots: tuple[SourceRootSpec, ...]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for spec in source_roots:
        key = spec.directory.name
        counts[key] = len(list(spec.directory.rglob("*.md"))) if spec.directory.exists() else 0
    return counts
