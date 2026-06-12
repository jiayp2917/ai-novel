from pathlib import Path

from fastapi import Request
from fastapi.responses import JSONResponse

from backend.app.core.file_utils import FileEncodingError


def file_error_response(exc: OSError) -> JSONResponse:
    if isinstance(exc, FileNotFoundError):
        return JSONResponse(status_code=404, content={"detail": f"文件不存在：{_error_path(exc)}"})
    if isinstance(exc, FileEncodingError):
        action = "读取" if exc.operation == "read" else "写入"
        return JSONResponse(status_code=400, content={"detail": f"文件编码错误，无法按 {exc.encoding} {action}：{exc.path}"})
    return JSONResponse(status_code=500, content={"detail": str(exc) or "文件读写失败。"})


async def os_error_handler(_: Request, exc: OSError) -> JSONResponse:
    return file_error_response(exc)


def _error_path(exc: FileNotFoundError) -> str:
    if exc.filename:
        return str(exc.filename)
    if exc.filename2:
        return str(exc.filename2)
    if exc.args:
        for value in reversed(exc.args):
            if isinstance(value, (str, Path)):
                return str(value)
    return "unknown"
