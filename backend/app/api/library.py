from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.admin_auth import require_admin_access
from backend.app.core.file_utils import safe_read_text
from backend.app.db.models import Chapter, ChapterVersion, SourceFile
from backend.app.db.session import get_db
from backend.app.schemas import ChapterContentRead, ChapterRead, SourceFileContentRead, SourceFileRead
from backend.app.services.chapter_versions import ChapterVersionError, ChapterVersionService
from backend.app.services.library import LibraryScanner, parse_chapters
from backend.app.services.source_files import SourceFileManager, SourceFileManagerError
from backend.app.services.workspace import WorkspaceResolver


router = APIRouter(prefix="/api", tags=["library"])


class PublishChapterVersionRequest(BaseModel):
    approved_by_user: bool


class CreateSourceFileRequest(BaseModel):
    root: str
    folder: str = ""
    filename: str
    template: str = "blank"
    title: str | None = None
    chapter_no: int | None = None
    content: str | None = None


class CreateSourceFolderRequest(BaseModel):
    root: str
    folder: str


class NormalizeChapterRequest(BaseModel):
    chapter_no: int
    title: str
    content_prefix: str | None = None
    confirm_normalize: bool = False


@router.post("/library/scan")
def scan_library(
    _: None = Depends(require_admin_access),
    session: Session = Depends(get_db),
) -> dict:
    return LibraryScanner(session).scan()


@router.get("/library/catalog-status")
def catalog_status(
    _: None = Depends(require_admin_access),
    session: Session = Depends(get_db),
) -> dict:
    return LibraryScanner(session).scan()


@router.post("/source-files/create")
def create_source_file(
    payload: CreateSourceFileRequest,
    _: None = Depends(require_admin_access),
    session: Session = Depends(get_db),
) -> dict:
    try:
        created = SourceFileManager(session).create_file(
            root_key=payload.root,
            folder=payload.folder,
            filename=payload.filename,
            template=payload.template,
            title=payload.title,
            chapter_no=payload.chapter_no,
            content=payload.content,
        )
    except (SourceFileManagerError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "path": created.path,
        "source_file_id": created.source_file_id,
        "chapter_id": created.chapter_id,
        "scan": created.scan,
    }


@router.post("/source-folders/create")
def create_source_folder(
    payload: CreateSourceFolderRequest,
    _: None = Depends(require_admin_access),
    session: Session = Depends(get_db),
) -> dict:
    try:
        return SourceFileManager(session).create_folder(root_key=payload.root, folder=payload.folder)
    except (SourceFileManagerError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/source-files/{source_file_id}/normalize-chapter")
def normalize_chapter_source(
    source_file_id: int,
    payload: NormalizeChapterRequest,
    _: None = Depends(require_admin_access),
    session: Session = Depends(get_db),
) -> dict:
    try:
        normalized = SourceFileManager(session).normalize_chapter(
            source_file_id=source_file_id,
            chapter_no=payload.chapter_no,
            title=payload.title,
            content_prefix=payload.content_prefix,
            confirm_normalize=payload.confirm_normalize,
        )
    except (SourceFileManagerError, ValueError) as exc:
        status = 404 if str(exc) == "Source file not found" else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    return {
        "path": normalized.path,
        "source_file_id": normalized.source_file_id,
        "chapter_id": normalized.chapter_id,
        "backup_path": normalized.backup_path,
        "scan": normalized.scan,
    }


@router.get("/source-files", response_model=list[SourceFileRead])
def list_source_files(session: Session = Depends(get_db)) -> list[SourceFile]:
    return list(session.scalars(select(SourceFile).where(SourceFile.active.is_(True)).order_by(SourceFile.path)))


@router.get("/source-files/{source_file_id}", response_model=SourceFileContentRead)
def get_source_file(source_file_id: int, session: Session = Depends(get_db)) -> dict:
    source_file = session.get(SourceFile, source_file_id)
    if source_file is None or not source_file.active:
        raise HTTPException(status_code=404, detail="Source file not found")
    try:
        text = safe_read_text(WorkspaceResolver().resolve_source_path(source_file.path), encoding="utf-8-sig")
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
        "recognized_chapter_count": len(parse_chapters(text)) if source_file.kind == "chapters" else None,
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
        full_text = safe_read_text(WorkspaceResolver().resolve_source_path(chapter.source_file.path), encoding="utf-8-sig")
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


@router.get("/chapters/{chapter_id}/versions")
def list_chapter_versions(chapter_id: int, session: Session = Depends(get_db)) -> list[dict]:
    chapter = session.get(Chapter, chapter_id)
    if chapter is None or not chapter.active:
        raise HTTPException(status_code=404, detail="Chapter not found")
    versions = session.scalars(
        select(ChapterVersion)
        .where(ChapterVersion.chapter_id == chapter.id)
        .order_by(ChapterVersion.created_at.desc(), ChapterVersion.id.desc())
    ).all()
    return [
        {
            "id": version.id,
            "chapter_id": version.chapter_id,
            "source_file_id": version.source_file_id,
            "title": version.title,
            "body_hash": version.body_hash,
            "source_file_hash": version.source_file_hash,
            "text_snapshot_path": version.text_snapshot_path,
            "range_start": version.range_start,
            "range_end": version.range_end,
            "created_at": version.created_at,
            "is_current": version.id == chapter.current_version_id,
            "can_preview": bool(version.text_snapshot_path or version.source_file_hash == chapter.source_file.sha256),
            "can_publish": bool(
                version.id != chapter.current_version_id
                and (version.text_snapshot_path or version.source_file_hash == chapter.source_file.sha256)
            ),
            "can_delete": version.id != chapter.current_version_id,
        }
        for version in versions
    ]


@router.get("/chapters/{chapter_id}/versions/{version_id}/content")
def get_chapter_version_content(chapter_id: int, version_id: int, session: Session = Depends(get_db)) -> dict:
    try:
        return ChapterVersionService(session).version_content(chapter_id, version_id)
    except ChapterVersionError as exc:
        detail = str(exc)
        status = 404 if detail in {"Chapter not found", "Chapter version not found"} else 400
        raise HTTPException(status_code=status, detail=detail) from exc


@router.get("/chapters/{chapter_id}/versions/{version_id}/diff")
def diff_chapter_version(chapter_id: int, version_id: int, session: Session = Depends(get_db)) -> dict:
    try:
        return ChapterVersionService(session).version_diff(chapter_id, version_id)
    except ChapterVersionError as exc:
        detail = str(exc)
        status = 404 if detail in {"Chapter not found", "Chapter version not found"} else 400
        raise HTTPException(status_code=status, detail=detail) from exc


@router.post("/chapters/{chapter_id}/versions/{version_id}/publish")
def publish_chapter_version(
    chapter_id: int,
    version_id: int,
    payload: PublishChapterVersionRequest,
    _: None = Depends(require_admin_access),
    session: Session = Depends(get_db),
) -> dict:
    try:
        return ChapterVersionService(session).publish_version(
            chapter_id,
            version_id,
            approved_by_user=payload.approved_by_user,
        )
    except ChapterVersionError as exc:
        detail = str(exc)
        status = 404 if detail in {"Chapter not found", "Chapter version not found"} else 400
        raise HTTPException(status_code=status, detail=detail) from exc


@router.delete("/chapters/{chapter_id}/versions/{version_id}")
def delete_chapter_version(
    chapter_id: int,
    version_id: int,
    _: None = Depends(require_admin_access),
    session: Session = Depends(get_db),
) -> dict:
    try:
        return ChapterVersionService(session).delete_version(chapter_id, version_id)
    except ChapterVersionError as exc:
        detail = str(exc)
        status = 404 if detail in {"Chapter not found", "Chapter version not found"} else 400
        raise HTTPException(status_code=status, detail=detail) from exc
