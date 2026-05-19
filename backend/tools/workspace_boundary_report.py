from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from backend.app.services.workspace import app_root, workspace_runtime_root


CODE_DIRS = {"backend", "frontend", "config", "skills", "tests", "docs"}
CONTENT_DIRS = {"00-系统", "01-设定", "02-正文", "03-章纲", "content"}
RUNTIME_DIRS = {"runtime"}
CACHE_NAMES = {"__pycache__", ".pytest_cache", "dist", "node_modules"}
SENSITIVE_NAMES = {"key.txt", ".env"}


@dataclass(frozen=True)
class InventoryItem:
    path: str
    category: str
    action: str
    note: str


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate a read-only workspace boundary inventory report.")
    parser.add_argument("--root", default=str(app_root()), help="Repository or workspace root to inspect.")
    parser.add_argument("--out", default=None, help="Report output path. Defaults to current workspace runtime reports.")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    items = inventory(root)
    report = render_report(root, items)
    out = Path(args.out) if args.out else workspace_runtime_root() / "reports" / "workspace_boundary_report.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(report, encoding="utf-8")
    print(str(out))
    return 0


def inventory(root: Path) -> list[InventoryItem]:
    items: list[InventoryItem] = []
    for path in sorted(root.iterdir(), key=lambda item: item.name.lower()):
        name = path.name
        relative = name
        if name in SENSITIVE_NAMES:
            items.append(InventoryItem(relative, "sensitive", "keep_local", "敏感文件，只记录文件名，不读取内容，不应进入 Git。"))
        elif name in CODE_DIRS or path.suffix in {".md", ".txt", ".ini", ".toml", ".json", ".yaml", ".yml"}:
            items.append(InventoryItem(relative, "system", "keep", "系统代码、配置或文档。"))
        elif name in CONTENT_DIRS:
            items.append(InventoryItem(relative, "content", "keep_or_migrate", "小说内容源，禁止自动删除；可迁移到外部作品工作区。"))
        elif name in RUNTIME_DIRS:
            items.append(InventoryItem(relative, "runtime", "archive_or_keep", "运行态产物，默认保留；历史产物只允许归档。"))
        elif name in CACHE_NAMES:
            items.append(InventoryItem(relative, "cache", "safe_delete", "缓存或构建产物，可通过清理命令删除。"))
        elif path.is_dir() and _contains_cache(path):
            items.append(InventoryItem(relative, "mixed_or_cache", "inspect", "目录可能包含缓存或工具产物，清理前需人工确认。"))
        else:
            items.append(InventoryItem(relative, "unknown", "inspect", "未归类项目，清理或迁移前需人工确认。"))
    return items


def render_report(root: Path, items: list[InventoryItem]) -> str:
    lines = [
        "# 工作区边界盘点报告",
        "",
        f"生成时间：{datetime.now(UTC).isoformat()}",
        f"检查根目录：`{root}`",
        "",
        "## 分类清单",
        "",
        "| 路径 | 分类 | 建议动作 | 说明 |",
        "|---|---|---|---|",
    ]
    for item in items:
        lines.append(f"| `{item.path}` | {item.category} | {item.action} | {item.note} |")
    lines.extend(
        [
            "",
            "## 安全规则",
            "",
            "- `00-系统/01-设定/02-正文/03-章纲` 禁止自动删除。",
            "- `key.txt` 和 `.env` 只记录文件名，不读取内容。",
            "- `runtime` 下历史 artifact、diff、backup、model log 默认保留，只允许归档。",
            "- 可自动清理范围仅限缓存、构建产物和明确的空日志。",
            "",
        ]
    )
    return "\n".join(lines)


def _contains_cache(path: Path) -> bool:
    return any(child.name in CACHE_NAMES for child in path.iterdir()) if path.exists() else False


if __name__ == "__main__":
    raise SystemExit(main())
