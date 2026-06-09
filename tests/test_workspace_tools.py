from pathlib import Path

from backend.tools.workspace_boundary_report import inventory, render_report
from backend.tools.workspace_migrate import build_plan, existing_targets, execute_plan, render_report as render_migration_report


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_boundary_report_lists_sensitive_names_without_contents(tmp_path: Path) -> None:
    write(tmp_path / "key.txt", "secret-value")
    write(tmp_path / "00-设定" / "设定文档.md", "# 设定")
    write(tmp_path / "01-大纲" / "总纲.md", "# 总纲")
    write(tmp_path / "02-正文" / "01卷" / "第001章.md", "# 第001章\n正文")
    items = inventory(tmp_path)
    report = render_report(tmp_path, items)

    assert "key.txt" in report
    assert "secret-value" not in report
    assert "00-设定" in report
    assert "01-大纲" in report
    assert "02-正文" in report
    assert "keep_or_migrate" in report


def test_workspace_migrate_dry_plan_and_copy_preserve_hash(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    write(source / "00-系统" / "system.md", "# 系统")
    write(source / "00-设定" / "设定文档.md", "# 设定")
    write(source / "01-大纲" / "总纲.md", "# 总纲")
    write(source / "02-正文" / "01卷" / "第001章.md", "# 第001章\n正文")
    write(source / "key.txt", "secret")

    plan = build_plan(source, target, include_runtime=False)

    assert len(plan) == 4
    assert not (target / "02-正文").exists()
    assert all(item.source.name != "key.txt" for item in plan)

    execute_plan(plan)

    copied = target / "02-正文" / "01卷" / "第001章.md"
    assert copied.read_text(encoding="utf-8") == "# 第001章\n正文"
    assert {item.target for item in plan} == {
        target / "00-系统" / "system.md",
        target / "00-设定" / "设定文档.md",
        target / "01-大纲" / "总纲.md",
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


def test_workspace_migrate_runtime_excludes_secret_files_and_reports_warning(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    write(source / "runtime" / "artifacts" / "candidate.md", "# 候选")
    write(source / "runtime" / "diffs" / "chapter.diff", "diff")
    write(source / "runtime" / "backups" / "chapter.md", "backup")
    write(source / "runtime" / "model_secrets.dpapi.json", '{"kimi":"encrypted"}')
    write(source / "runtime" / ".env.runtime", "SECRET=1")
    write(source / "runtime" / "key.txt", "secret")

    plan = build_plan(source, target, include_runtime=True)
    rendered = {item.source.relative_to(source).as_posix() for item in plan}
    report = render_migration_report(source, target, plan, dry_run=True)

    assert "runtime/artifacts/candidate.md" in rendered
    assert "runtime/diffs/chapter.diff" in rendered
    assert "runtime/backups/chapter.md" in rendered
    assert "runtime/model_secrets.dpapi.json" not in rendered
    assert "runtime/.env.runtime" not in rendered
    assert "runtime/key.txt" not in rendered
    assert "runtime 迁移提醒" in report
    assert "不要把包含 `runtime` 的迁移包提交到 Git" in report
