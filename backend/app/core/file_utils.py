from pathlib import Path

from fastapi import HTTPException


def safe_read_text(path: Path, encoding: str = "utf-8") -> str:
    try:
        return path.read_text(encoding=encoding)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"文件不存在：{path}") from exc
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"文件编码错误，无法按 {encoding} 读取：{path}") from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"读取文件失败：{path}") from exc


def safe_write_text(path: Path, content: str, encoding: str = "utf-8") -> None:
    try:
        path.write_text(content, encoding=encoding)
    except UnicodeEncodeError as exc:
        raise HTTPException(status_code=400, detail=f"文件编码错误，无法按 {encoding} 写入：{path}") from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"写入文件失败：{path}") from exc
