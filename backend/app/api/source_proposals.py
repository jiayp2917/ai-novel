from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.services.annotations import InvalidRequestError, NotFoundError
from backend.app.services.model_client import ModelClientError
from backend.app.services.source_proposal import SourceProposalService


router = APIRouter(prefix="/api/source-files", tags=["source-proposals"])


class SourceProposalRequest(BaseModel):
    annotation_ids: list[int] | None = None


@router.post("/{source_file_id}/generate-proposal")
def generate_source_proposal(
    source_file_id: int,
    payload: SourceProposalRequest,
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
