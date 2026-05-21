from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path


SOURCE_DIRS = ("00-系统", "01-设定", "02-正文", "03-章纲")
SENSITIVE_FILE_NAMES = {"key.txt", "model_secrets.dpapi.json"}


@dataclass(frozen=True)
class CopyPlanItem:
    source: Path
    target: Path
    size: int
    sha256: str


def main() -> int:
    parser = argparse.ArgumentParser(description="Copy a novel workspace to an external workspace with hash reporting.")
    parser.add_argument("--from", dest="source_root", required=True)
    parser.add_argument("--to", dest="target_root", required=True)
    parser.add_argument("--include-runtime", action="store_true")
    parser.add_argument("--execute", action="store_true", help="Actually copy files. Without this flag the command is dry-run.")
    parser.add_argument("--overwrite", action="store_true", help="Allow overwriting existing target files during --execute.")
    parser.add_argument("--report", default=None)
    args = parser.parse_args()

    source_root = Path(args.source_root).resolve()
    target_root = Path(args.target_root).resolve()
    plan = build_plan(source_root, target_root, include_runtime=args.include_runtime)
    conflicts = existing_targets(plan)
    dry_run = not args.execute
    if args.execute:
        if conflicts and not args.overwrite:
            report = render_report(source_root, target_root, plan, dry_run=False, conflicts=conflicts)
            report_path = Path(args.report) if args.report else target_root / "runtime" / "reports" / "workspace_migration_blocked.md"
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(report, encoding="utf-8")
            print(str(report_path))
            raise SystemExit("Target files already exist; rerun with --overwrite after reviewing the report.")
        execute_plan(plan)
    report = render_report(source_root, target_root, plan, dry_run=dry_run, conflicts=conflicts)
    report_path = Path(args.report) if args.report else target_root / "runtime" / "reports" / "workspace_migration_report.md"
    if dry_run:
        report_path = source_root / "runtime" / "reports" / "workspace_migration_dry_run.md"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report, encoding="utf-8")
    print(str(report_path))
    return 0


def build_plan(source_root: Path, target_root: Path, *, include_runtime: bool) -> list[CopyPlanItem]:
    dirs = list(SOURCE_DIRS)
    if include_runtime:
        dirs.append("runtime")
    items: list[CopyPlanItem] = []
    for directory in dirs:
        source_dir = source_root / directory
        if not source_dir.exists():
            continue
        for source in sorted(path for path in source_dir.rglob("*") if path.is_file()):
            if _is_sensitive_migration_file(source):
                continue
            relative = source.relative_to(source_root)
            items.append(
                CopyPlanItem(
                    source=source,
                    target=target_root / relative,
                    size=source.stat().st_size,
                    sha256=sha256_file(source),
                )
            )
    return items


def execute_plan(plan: list[CopyPlanItem]) -> None:
    for item in plan:
        item.target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item.source, item.target)
        copied_hash = sha256_file(item.target)
        if copied_hash != item.sha256:
            raise RuntimeError(f"Hash mismatch after copy: {item.target}")


def existing_targets(plan: list[CopyPlanItem]) -> list[CopyPlanItem]:
    return [item for item in plan if item.target.exists()]


def _is_sensitive_migration_file(path: Path) -> bool:
    name = path.name.lower()
    if name in SENSITIVE_FILE_NAMES:
        return True
    return name == ".env" or name.startswith(".env.")


def render_report(
    source_root: Path,
    target_root: Path,
    plan: list[CopyPlanItem],
    *,
    dry_run: bool,
    conflicts: list[CopyPlanItem] | None = None,
) -> str:
    total_size = sum(item.size for item in plan)
    includes_runtime = any(item.source.relative_to(source_root).parts[0] == "runtime" for item in plan)
    lines = [
        "# 工作区迁移报告",
        "",
        f"生成时间：{datetime.now(UTC).isoformat()}",
        f"模式：{'dry-run' if dry_run else 'copy'}",
        f"源工作区：`{source_root}`",
        f"目标工作区：`{target_root}`",
        f"文件数：{len(plan)}",
        f"总大小：{total_size} bytes",
        f"目标已存在文件：{len(conflicts or [])}",
        "",
        "## 文件清单",
        "",
        "| 源文件 | 目标文件 | 大小 | SHA256 |",
        "|---|---|---:|---|",
    ]
    for item in plan:
        lines.append(
            f"| `{item.source.relative_to(source_root).as_posix()}` | "
            f"`{item.target.relative_to(target_root).as_posix()}` | {item.size} | `{item.sha256}` |"
        )
    lines.extend(
        [
            "",
            "## 目标已存在文件",
            "",
            "| 目标文件 |",
            "|---|",
        ]
    )
    for item in conflicts or []:
        lines.append(f"| `{item.target.relative_to(target_root).as_posix()}` |")
    if not conflicts:
        lines.append("| 无 |")
    lines.extend(
        [
            "",
            "## 说明",
            "",
            "- 本工具只复制文件，不移动、不删除源文件。",
            "- 默认 dry-run，不写入目标工作区，只生成计划报告。",
            "- 只有传入 `--execute` 才会复制；目标已存在时还必须显式传入 `--overwrite`。",
            "- `key.txt`、`.env` 不在迁移范围内。",
            "- `runtime` 只有显式传入 `--include-runtime` 时才会迁移；它用于保留 artifact、diff、backup、模型调用日志、审核记录和发布记录，不是普通导出或清理入口。",
            "- 即使迁移 `runtime`，`model_secrets.dpapi.json`、`key.txt`、`.env`、`.env.*` 也会被排除。",
            "",
        ]
    )
    if includes_runtime:
        lines.extend(
            [
                "## runtime 迁移提醒",
                "",
                "- 本报告包含 `runtime` 文件。请只在需要迁移审计证据、模型调用记录、diff、backup 或发布记录时使用。",
                "- 不要把包含 `runtime` 的迁移包提交到 Git，也不要作为系统代码包分发。",
                "",
            ]
        )
    return "\n".join(lines)


def sha256_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
