from __future__ import annotations

import argparse
import zipfile
from datetime import UTC, datetime
from pathlib import Path


INCLUDE_PATHS = [
    ".env.example",
    ".gitignore",
    "AGENTS.md",
    "CLAUDE.md",
    "PRD.md",
    "README.md",
    "alembic.ini",
    "backend",
    "config",
    "content",
    "docs",
    "frontend",
    "requirements.txt",
    "skills",
    "tests",
]

EXCLUDED_NAMES = {
    ".git",
    ".pytest_cache",
    "__pycache__",
    "dist",
    "node_modules",
    "runtime",
}

EXCLUDED_ROOTS = {
    "00-系统",
    "00-设定",
    "01-大纲",
    "01-设定",
    "02-正文",
    "03-章纲",
    "runtime",
}

EXCLUDED_FILES = {
    "key.txt",
}

EXCLUDED_SUFFIXES = {
    ".pyc",
    ".pyo",
    ".tsbuildinfo",
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Package system source without novel content, runtime data, or keys.")
    parser.add_argument("--root", default=".", help="Repository root. Defaults to current directory.")
    parser.add_argument("--out", default=None, help="Output zip path.")
    parser.add_argument("--dry-run", action="store_true", help="Only print the package plan.")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    out = Path(args.out).resolve() if args.out else root / "runtime" / "reports" / _default_name()
    files = package_files(root)
    violations = safety_violations(root, files)
    if violations:
        for item in violations:
            print(f"REFUSE: {item}")
        return 2

    print(f"root={root}")
    print(f"out={out}")
    print(f"files={len(files)}")
    for rel in files[:30]:
        print(rel.as_posix())
    if len(files) > 30:
        print(f"... {len(files) - 30} more")
    if args.dry_run:
        return 0

    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for rel in files:
            archive.write(root / rel, rel.as_posix())
    print(str(out))
    return 0


def package_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for include in INCLUDE_PATHS:
        path = root / include
        if not path.exists():
            continue
        if path.is_file():
            rel = path.relative_to(root)
            if not _excluded(rel):
                files.append(rel)
            continue
        for child in path.rglob("*"):
            if child.is_file():
                rel = child.relative_to(root)
                if not _excluded(rel):
                    files.append(rel)
    return sorted(set(files), key=lambda item: item.as_posix())


def safety_violations(root: Path, files: list[Path]) -> list[str]:
    violations: list[str] = []
    for rel in files:
        parts = set(rel.parts)
        if rel.parts and rel.parts[0] in EXCLUDED_ROOTS:
            violations.append(f"novel/runtime root included: {rel.as_posix()}")
        if rel.name in EXCLUDED_FILES:
            violations.append(f"sensitive file included: {rel.as_posix()}")
        if _is_env_file(rel):
            violations.append(f"env file included: {rel.as_posix()}")
        if _is_content_source(rel):
            violations.append(f"content source included: {rel.as_posix()}")
        if "runtime" in parts:
            violations.append(f"runtime path included: {rel.as_posix()}")
    for required in ["backend", "frontend", "config", "tests"]:
        if not (root / required).exists():
            violations.append(f"missing required source directory: {required}")
    return violations


def _excluded(rel: Path) -> bool:
    if not rel.parts:
        return True
    if rel.parts[0] in EXCLUDED_ROOTS:
        return True
    if rel.name in EXCLUDED_FILES:
        return True
    if _is_env_file(rel):
        return True
    if _is_content_source(rel):
        return True
    if rel.suffix in EXCLUDED_SUFFIXES:
        return True
    return any(part in EXCLUDED_NAMES for part in rel.parts)


def _is_env_file(rel: Path) -> bool:
    if rel.name == ".env.example":
        return False
    return rel.name == ".env" or rel.name.startswith(".env.")


def _is_content_source(rel: Path) -> bool:
    if len(rel.parts) < 2 or rel.parts[0] != "content":
        return False
    if rel.name == ".gitkeep":
        return False
    return rel.parts[1] in {"settings", "outlines", "chapters"}


def _default_name() -> str:
    stamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    return f"novel_editor_system_{stamp}.zip"


if __name__ == "__main__":
    raise SystemExit(main())
