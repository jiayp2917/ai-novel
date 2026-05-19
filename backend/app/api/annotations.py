from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.db.models import Annotation
from backend.app.db.session import get_db
from backend.app.schemas import AnnotationRead, AnnotationRequest, AnnotationUpdate
from backend.app.services.annotations import AnnotationService, InvalidRequestError, NotFoundError


router = APIRouter(prefix="/api", tags=["annotations"])


@router.post("/chapters/{chapter_id}/annotations", response_model=AnnotationRead)
def create_annotation(
    chapter_id: int,
    payload: AnnotationRequest,
    session: Session = Depends(get_db),
) -> Annotation:
    try:
        return AnnotationService(session).create_for_chapter(chapter_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InvalidRequestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/chapters/{chapter_id}/annotations", response_model=list[AnnotationRead])
def list_annotations(chapter_id: int, session: Session = Depends(get_db)) -> list[Annotation]:
    try:
        return AnnotationService(session).list_for_chapter(chapter_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/source-files/{source_file_id}/annotations", response_model=AnnotationRead)
def create_source_file_annotation(
    source_file_id: int,
    payload: AnnotationRequest,
    session: Session = Depends(get_db),
) -> Annotation:
    try:
        return AnnotationService(session).create_for_source_file(source_file_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InvalidRequestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/source-files/{source_file_id}/annotations", response_model=list[AnnotationRead])
def list_source_file_annotations(source_file_id: int, session: Session = Depends(get_db)) -> list[Annotation]:
    try:
        return AnnotationService(session).list_for_source_file(source_file_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/annotations/{annotation_id}", response_model=AnnotationRead)
def update_annotation(
    annotation_id: int,
    payload: AnnotationUpdate,
    session: Session = Depends(get_db),
) -> Annotation:
    try:
        return AnnotationService(session).update(annotation_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InvalidRequestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/annotations/{annotation_id}")
def delete_annotation(annotation_id: int, session: Session = Depends(get_db)) -> dict[str, str]:
    try:
        AnnotationService(session).delete(annotation_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "deleted"}


@router.post("/annotations/{annotation_id}/relocate", response_model=AnnotationRead)
def relocate_annotation(annotation_id: int, session: Session = Depends(get_db)) -> Annotation:
    try:
        return AnnotationService(session).relocate(annotation_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InvalidRequestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
