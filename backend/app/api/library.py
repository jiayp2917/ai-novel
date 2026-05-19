from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.db.models import Chapter, SourceFile
from backend.app.db.session import get_db
from backend.app.schemas import ChapterContentRead, ChapterRead, SourceFileContentRead, SourceFileRead
from backend.app.services.library import LibraryScanner
from backend.app.services.workspace import WorkspaceResolver


router = APIRouter(prefix="/api", tags=["library"])


@router.post("/library/scan")
def scan_library(session: Session = Depends(get_db)) -> dict:
    return LibraryScanner(session).scan()


@router.get("/source-files", response_model=list[SourceFileRead])
def list_source_files(session: Session = Depends(get_db)) -> list[SourceFile]:
    return list(session.scalars(select(SourceFile).where(SourceFile.active.is_(True)).order_by(SourceFile.path)))


@router.get("/source-files/{source_file_id}", response_model=SourceFileContentRead)
def get_source_file(source_file_id: int, session: Session = Depends(get_db)) -> dict:
    source_file = session.get(SourceFile, source_file_id)
    if source_file is None or not source_file.active:
        raise HTTPException(status_code=404, detail="Source file not found")
    try:
        text = WorkspaceResolver().resolve_source_path(source_file.path).read_text(encoding="utf-8-sig")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "id": source_file.id,
        "path": source_file.path,
        "kind": source_file.kind,
        "sha256": source_file.sha256,
        "mtime": source_file.mtime,
        "size": source_file.size,
        "active": source_file.active,
        "text": text,
        "offset_unit": "python_code_point",
    }


@router.get("/chapters", response_model=list[ChapterRead])
def list_chapters(session: Session = Depends(get_db)) -> list[Chapter]:
    return list(session.scalars(select(Chapter).where(Chapter.active.is_(True)).order_by(Chapter.chapter_no)))


@router.get("/chapters/{chapter_id}", response_model=ChapterRead)
def get_chapter(chapter_id: int, session: Session = Depends(get_db)) -> Chapter:
    chapter = session.get(Chapter, chapter_id)
    if chapter is None or not chapter.active:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return chapter


@router.get("/chapters/{chapter_id}/content", response_model=ChapterContentRead)
def get_chapter_content(chapter_id: int, session: Session = Depends(get_db)) -> dict:
    chapter = session.get(Chapter, chapter_id)
    if chapter is None or not chapter.active:
        raise HTTPException(status_code=404, detail="Chapter not found")
    try:
        full_text = WorkspaceResolver().resolve_source_path(chapter.source_file.path).read_text(encoding="utf-8-sig")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "id": chapter.id,
        "chapter_no": chapter.chapter_no,
        "title": chapter.title,
        "source_file_id": chapter.source_file_id,
        "current_version_id": chapter.current_version_id,
        "range_start": chapter.range_start,
        "range_end": chapter.range_end,
        "active": chapter.active,
        "text": full_text[chapter.range_start : chapter.range_end],
        "offset_unit": "python_code_point",
    }
