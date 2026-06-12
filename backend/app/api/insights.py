from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.core.admin_auth import require_admin_access
from backend.app.db.models import AnnotationInsight
from backend.app.db.session import get_db
from backend.app.schemas import AnnotationInsightRead, AnnotationInsightUpdate
from backend.app.services.annotation_learner import AnnotationLearner
from backend.app.services.annotations import InvalidRequestError, NotFoundError


router = APIRouter(prefix="/api", tags=["annotation-insights"])


class LearnAnnotationsRequest(BaseModel):
    annotation_ids: list[int] | None = None


@router.post("/annotations/learn")
def learn_annotations(
    payload: LearnAnnotationsRequest,
    _: None = Depends(require_admin_access),
    session: Session = Depends(get_db),
) -> dict:
    try:
        return AnnotationLearner(session).learn(payload.annotation_ids)
    except InvalidRequestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/annotation-insights", response_model=list[AnnotationInsightRead])
def list_annotation_insights(session: Session = Depends(get_db)) -> list[AnnotationInsight]:
    return AnnotationLearner(session).list_insights()


@router.patch("/annotation-insights/{insight_id}", response_model=AnnotationInsightRead)
def update_annotation_insight(
    insight_id: int,
    payload: AnnotationInsightUpdate,
    _: None = Depends(require_admin_access),
    session: Session = Depends(get_db),
) -> AnnotationInsight:
    try:
        return AnnotationLearner(session).update_insight(insight_id, payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InvalidRequestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
