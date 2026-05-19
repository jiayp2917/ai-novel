from pathlib import Path

from backend.tools.workspace_boundary_report import inventory, render_report
from backend.tools.workspace_migrate import build_plan, existing_targets, execute_plan


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_boundary_report_lists_sensitive_names_without_contents(tmp_path: Path) -> None:
    write(tmp_path / "key.txt", "secret-value")
    write(tmp_path / "02-正文" / "01卷" / "第001章.md", "# 第001章\n正文")
    items = inventory(tmp_path)
    report = render_report(tmp_path, items)

    assert "key.txt" in report
    assert "secret-value" not in report
    assert "02-正文" in report
    assert "keep_or_migrate" in report


def test_workspace_migrate_dry_plan_and_copy_preserve_hash(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    write(source / "00-系统" / "system.md", "# 系统")
    write(source / "02-正文" / "01卷" / "第001章.md", "# 第001章\n正文")
    write(source / "key.txt", "secret")

    plan = build_plan(source, target, include_runtime=False)

    assert len(plan) == 2
    assert not (target / "02-正文").exists()
    assert all(item.source.name != "key.txt" for item in plan)

    execute_plan(plan)

    copied = target / "02-正文" / "01卷" / "第001章.md"
    assert copied.read_text(encoding="utf-8") == "# 第001章\n正文"
    assert {item.target for item in plan} == {
        target / "00-系统" / "system.md",
        target / "02-正文" / "01卷" / "第001章.md",
    }


def test_workspace_migrate_reports_existing_targets(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    write(source / "02-正文" / "01卷" / "第001章.md", "# 第001章\n正文")
    write(target / "02-正文" / "01卷" / "第001章.md", "# 第001章\n旧正文")

    plan = build_plan(source, target, include_runtime=False)
    conflicts = existing_targets(plan)

    assert len(conflicts) == 1
    assert conflicts[0].target == target / "02-正文" / "01卷" / "第001章.md"
