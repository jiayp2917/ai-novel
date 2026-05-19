from pathlib import Path

import pytest
from fastapi import HTTPException

from backend.app.core.file_utils import safe_read_text, safe_write_text


def test_safe_read_and_write_text(tmp_path: Path) -> None:
    path = tmp_path / "note.md"

    safe_write_text(path, "正文内容")

    assert safe_read_text(path) == "正文内容"


def test_safe_read_text_missing_file_raises_404(tmp_path: Path) -> None:
    with pytest.raises(HTTPException) as exc_info:
        safe_read_text(tmp_path / "missing.md")

    assert exc_info.value.status_code == 404
    assert "文件不存在" in str(exc_info.value.detail)


def test_safe_read_text_encoding_error_raises_400(tmp_path: Path) -> None:
    path = tmp_path / "bad.txt"
    path.write_bytes(b"\xff\xfe\xff")

    with pytest.raises(HTTPException) as exc_info:
        safe_read_text(path, encoding="utf-8")

    assert exc_info.value.status_code == 400
    assert "文件编码错误" in str(exc_info.value.detail)


def test_safe_write_text_io_error_raises_500(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    path = tmp_path / "blocked.md"

    def raise_os_error(self: Path, content: str, encoding: str = "utf-8") -> int:
        raise OSError("permission denied")

    monkeypatch.setattr(Path, "write_text", raise_os_error)

    with pytest.raises(HTTPException) as exc_info:
        safe_write_text(path, "正文内容")

    assert exc_info.value.status_code == 500
    assert "写入文件失败" in str(exc_info.value.detail)
