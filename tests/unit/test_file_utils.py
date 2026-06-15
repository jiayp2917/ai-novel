from pathlib import Path

import pytest

from backend.app.core.file_utils import FileEncodingError, safe_read_text, safe_write_text
from backend.app.core.http_errors import file_error_response


def test_safe_read_and_write_text(tmp_path: Path) -> None:
    path = tmp_path / "note.md"

    safe_write_text(path, "正文内容")

    assert safe_read_text(path) == "正文内容"


def test_safe_read_text_missing_file_raises_404(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError) as exc_info:
        safe_read_text(tmp_path / "missing.md")

    response = file_error_response(exc_info.value)
    assert response.status_code == 404


def test_safe_read_text_encoding_error_raises_file_encoding_error(tmp_path: Path) -> None:
    path = tmp_path / "bad.txt"
    path.write_bytes(b"\xff\xfe\xff")

    with pytest.raises(FileEncodingError) as exc_info:
        safe_read_text(path, encoding="utf-8")

    response = file_error_response(exc_info.value)
    assert response.status_code == 400
    assert "Cannot read file as utf-8" in str(exc_info.value)
    assert "文件编码错误" in response.body.decode("utf-8")


def test_safe_write_text_io_error_raises_os_error(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    path = tmp_path / "blocked.md"

    def raise_os_error(self: Path, content: str, encoding: str = "utf-8") -> int:
        raise OSError("permission denied")

    monkeypatch.setattr(Path, "write_text", raise_os_error)

    with pytest.raises(OSError) as exc_info:
        safe_write_text(path, "正文内容")

    response = file_error_response(exc_info.value)
    assert response.status_code == 500
    assert "permission denied" in str(exc_info.value)
