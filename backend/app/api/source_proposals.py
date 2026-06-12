from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.core.admin_auth import require_admin_access
from backend.app.db.session import get_db
from backend.app.services.annotations import InvalidRequestError, NotFoundError
from backend.app.services.model_client import ModelClientError
from backend.app.services.source_proposal import SourceProposalService
from backend.app.services.writing_cards import WritingCardService


router = APIRouter(prefix="/api/source-files", tags=["source-proposals"])


class SourceProposalRequest(BaseModel):
    annotation_ids: list[int] | None = None


class WritingCardRequest(BaseModel):
    chapter_no: int
    generation_mode: str = "stable"
    force: bool = False


class WorkProfileProposalRequest(BaseModel):
    force: bool = False


@router.post("/{source_file_id}/generate-proposal")
def generate_source_proposal(
    source_file_id: int,
    payload: SourceProposalRequest,
    _: None = Depends(require_admin_access),
    session: Session = Depends(get_db),
) -> dict:
    try:
        return SourceProposalService(session).generate_proposal(
            source_file_id,
            annotation_ids=payload.annotation_ids,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (InvalidRequestError, ModelClientError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{source_file_id}/generate-writing-card")
def generate_writing_card(
    source_file_id: int,
    payload: WritingCardRequest,
    _: None = Depends(require_admin_access),
    session: Session = Depends(get_db),
) -> dict:
    try:
        return WritingCardService(session).generate_card(
            source_file_id,
            chapter_no=payload.chapter_no,
            generation_mode=payload.generation_mode,
            force=payload.force,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (InvalidRequestError, ModelClientError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{source_file_id}/generate-work-profile")
def generate_work_profile(
    source_file_id: int,
    payload: WorkProfileProposalRequest,
    _: None = Depends(require_admin_access),
    session: Session = Depends(get_db),
) -> dict:
    try:
        return SourceProposalService(session).generate_work_profile_proposal(source_file_id, force=payload.force)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (InvalidRequestError, ModelClientError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/writing-cards/{artifact_id}/confirm")
def confirm_writing_card(
    artifact_id: int,
    _: None = Depends(require_admin_access),
    session: Session = Depends(get_db),
) -> dict:
    try:
        return WritingCardService(session).confirm_card(artifact_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InvalidRequestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/work-profiles/{artifact_id}/confirm")
def confirm_work_profile(
    artifact_id: int,
    _: None = Depends(require_admin_access),
    session: Session = Depends(get_db),
) -> dict:
    try:
        return SourceProposalService(session).confirm_work_profile(artifact_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InvalidRequestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
