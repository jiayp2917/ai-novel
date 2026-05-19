import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.db.models import Artifact, PublishDecision, Review
from backend.app.services.annotations import NotFoundError
from backend.app.services.model_client import ModelClientError
from backend.app.services.review_publish import ReviewPublishError, ReviewPublishService


router = APIRouter(prefix="/api/artifacts", tags=["artifacts"])


class ReviewArtifactRequest(BaseModel):
    force: bool = False


class PublishArtifactRequest(BaseModel):
    approved_by_user: bool
    force: bool = False
    force_reason: str | None = None


@router.get("")
def list_artifacts(
    base_chapter_id: int | None = None,
    base_source_file_id: int | None = None,
    kind: str | None = None,
    limit: int = 50,
    session: Session = Depends(get_db),
) -> list[dict]:
    limit = max(1, min(limit, 200))
    query = select(Artifact).order_by(Artifact.created_at.desc()).limit(limit)
    if base_chapter_id is not None:
        query = query.where(Artifact.base_chapter_id == base_chapter_id)
    if base_source_file_id is not None:
        query = query.where(Artifact.base_source_file_id == base_source_file_id)
    if kind is not None:
        query = query.where(Artifact.kind == kind)
    artifacts = session.scalars(query).all()
    return [_artifact_payload(session, artifact) for artifact in artifacts]


@router.get("/{artifact_id}")
def get_artifact(artifact_id: int, session: Session = Depends(get_db)) -> dict:
    artifact = session.get(Artifact, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return _artifact_payload(session, artifact)


def _artifact_payload(session: Session, artifact: Artifact) -> dict:
    review = session.scalar(
        select(Review).where(Review.artifact_id == artifact.id).order_by(Review.id.desc())
    )
    published = session.scalar(
        select(PublishDecision).where(PublishDecision.artifact_id == artifact.id).order_by(PublishDecision.id.desc())
    )
    return {
        "id": artifact.id,
        "kind": artifact.kind,
        "path": artifact.path,
        "sha256": artifact.sha256,
        "base_source_file_id": artifact.base_source_file_id,
        "base_source_file_hash": artifact.base_source_file_hash,
        "base_chapter_id": artifact.base_chapter_id,
        "base_chapter_version_id": artifact.base_chapter_version_id,
        "metadata": json.loads(artifact.metadata_json or "{}"),
        "created_at": artifact.created_at,
        "latest_review": None
        if review is None
        else {
            "id": review.id,
            "passed": review.passed,
            "manual_required": review.manual_required,
            "evidence_count": review.evidence_count,
            "issues": json.loads(review.issues_json or "[]"),
            "created_at": review.created_at,
        },
        "latest_publish": None
        if published is None
        else {
            "id": published.id,
            "approved_by_user": published.approved_by_user,
            "force": published.force,
            "diff_path": published.diff_path,
            "backup_path": published.backup_path,
            "published_at": published.published_at,
        },
    }


@router.post("/{artifact_id}/review")
def review_artifact(
    artifact_id: int,
    payload: ReviewArtifactRequest,
    session: Session = Depends(get_db),
) -> dict:
    try:
        return ReviewPublishService(session).review_artifact(artifact_id, force=payload.force)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ReviewPublishError, ModelClientError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{artifact_id}/diff")
def diff_artifact(artifact_id: int, session: Session = Depends(get_db)) -> dict:
    try:
        return ReviewPublishService(session).diff_artifact(artifact_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ReviewPublishError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{artifact_id}/publish")
def publish_artifact(
    artifact_id: int,
    payload: PublishArtifactRequest,
    session: Session = Depends(get_db),
) -> dict:
    try:
        return ReviewPublishService(session).publish_artifact(
            artifact_id,
            approved_by_user=payload.approved_by_user,
            force=payload.force,
            force_reason=payload.force_reason,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ReviewPublishError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
