from pathlib import Path


class FileEncodingError(OSError):
    def __init__(self, operation: str, path: Path, encoding: str) -> None:
        self.operation = operation
        self.path = path
        self.encoding = encoding
        super().__init__(f"Cannot {operation} file as {encoding}: {path}")


def safe_read_text(path: Path, encoding: str = "utf-8") -> str:
    try:
        return path.read_text(encoding=encoding)
    except UnicodeDecodeError as exc:
        raise FileEncodingError("read", path, encoding) from exc


def safe_write_text(path: Path, content: str, encoding: str = "utf-8") -> None:
    try:
        path.write_text(content, encoding=encoding)
    except UnicodeEncodeError as exc:
        raise FileEncodingError("write", path, encoding) from exc
