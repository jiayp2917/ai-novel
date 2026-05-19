from pathlib import Path

from backend.tools.package_system import package_files, safety_violations


def test_package_system_excludes_content_runtime_and_keys(tmp_path: Path) -> None:
    for directory in [
        "backend",
        "frontend",
        "config",
        "tests",
        "runtime",
        "02-正文",
        "content/settings",
        "content/outlines",
        "content/chapters",
    ]:
        (tmp_path / directory).mkdir(parents=True)
    (tmp_path / "backend" / "app.py").write_text("print('ok')", encoding="utf-8")
    (tmp_path / "frontend" / "main.tsx").write_text("export {}", encoding="utf-8")
    (tmp_path / "config" / "models.yaml").write_text("{}", encoding="utf-8")
    (tmp_path / "tests" / "test_ok.py").write_text("def test_ok(): pass", encoding="utf-8")
    (tmp_path / "README.md").write_text("# README", encoding="utf-8")
    (tmp_path / "runtime" / "app.db").write_text("db", encoding="utf-8")
    (tmp_path / "02-正文" / "chapter.md").write_text("novel", encoding="utf-8")
    (tmp_path / "content" / ".gitkeep").write_text("", encoding="utf-8")
    (tmp_path / "content" / "settings" / "settings.md").write_text("settings", encoding="utf-8")
    (tmp_path / "content" / "outlines" / "outline.md").write_text("outline", encoding="utf-8")
    (tmp_path / "content" / "chapters" / "chapter.md").write_text("chapter", encoding="utf-8")
    (tmp_path / "key.txt").write_text("secret", encoding="utf-8")
    (tmp_path / ".env").write_text("SECRET=1", encoding="utf-8")
    (tmp_path / "frontend" / ".env.local").write_text("SECRET=1", encoding="utf-8")
    (tmp_path / "frontend" / "dist").mkdir()
    (tmp_path / "frontend" / "dist" / "bundle.js").write_text("built", encoding="utf-8")

    files = package_files(tmp_path)
    rendered = {path.as_posix() for path in files}

    assert "backend/app.py" in rendered
    assert "frontend/main.tsx" in rendered
    assert "config/models.yaml" in rendered
    assert "tests/test_ok.py" in rendered
    assert "runtime/app.db" not in rendered
    assert "02-正文/chapter.md" not in rendered
    assert "content/.gitkeep" in rendered
    assert "content/settings/settings.md" not in rendered
    assert "content/outlines/outline.md" not in rendered
    assert "content/chapters/chapter.md" not in rendered
    assert "key.txt" not in rendered
    assert ".env" not in rendered
    assert "frontend/.env.local" not in rendered
    assert "frontend/dist/bundle.js" not in rendered
    assert safety_violations(tmp_path, files) == []
