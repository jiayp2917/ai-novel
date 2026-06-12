import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.db.models import Artifact, PublishDecision, Review
from backend.app.core.file_utils import safe_read_text
from backend.app.services.annotations import NotFoundError
from backend.app.services.model_client import ModelClientError
from backend.app.services.review_publish import ReviewPublishError, ReviewPublishService
from backend.app.services.workspace import workspace_runtime_root


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
    artifact_ids = [artifact.id for artifact in artifacts]
    reviews = _latest_reviews(session, artifact_ids)
    publishes = _latest_publishes(session, artifact_ids)
    return [
        _artifact_payload(
            artifact,
            review=reviews.get(artifact.id),
            published=publishes.get(artifact.id),
        )
        for artifact in artifacts
    ]


@router.get("/{artifact_id}")
def get_artifact(artifact_id: int, session: Session = Depends(get_db)) -> dict:
    artifact = session.get(Artifact, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return _artifact_payload(
        artifact,
        review=_latest_review(session, artifact.id),
        published=_latest_publish(session, artifact.id),
    )


@router.get("/{artifact_id}/text")
def get_artifact_text(artifact_id: int, session: Session = Depends(get_db)) -> dict:
    artifact = session.get(Artifact, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Artifact not found")
    root = workspace_runtime_root().resolve()
    path = (root / artifact.path).resolve()
    if root not in path.parents and path != root:
        raise HTTPException(status_code=400, detail="Artifact path escapes runtime root")
    if not path.exists():
        raise HTTPException(status_code=404, detail="Artifact file is missing")
    return {"artifact_id": artifact.id, "text": safe_read_text(path, encoding="utf-8")}


def _artifact_payload(
    artifact: Artifact,
    *,
    review: Review | None = None,
    published: PublishDecision | None = None,
) -> dict:
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


def _latest_review(session: Session, artifact_id: int) -> Review | None:
    return session.scalar(select(Review).where(Review.artifact_id == artifact_id).order_by(Review.id.desc()))


def _latest_publish(session: Session, artifact_id: int) -> PublishDecision | None:
    return session.scalar(
        select(PublishDecision).where(PublishDecision.artifact_id == artifact_id).order_by(PublishDecision.id.desc())
    )


def _latest_reviews(session: Session, artifact_ids: list[int]) -> dict[int, Review]:
    if not artifact_ids:
        return {}
    latest = (
        select(Review.artifact_id, func.max(Review.id).label("review_id"))
        .where(Review.artifact_id.in_(artifact_ids))
        .group_by(Review.artifact_id)
        .subquery()
    )
    rows = session.scalars(select(Review).join(latest, Review.id == latest.c.review_id)).all()
    return {review.artifact_id: review for review in rows}


def _latest_publishes(session: Session, artifact_ids: list[int]) -> dict[int, PublishDecision]:
    if not artifact_ids:
        return {}
    latest = (
        select(PublishDecision.artifact_id, func.max(PublishDecision.id).label("publish_id"))
        .where(PublishDecision.artifact_id.in_(artifact_ids))
        .group_by(PublishDecision.artifact_id)
        .subquery()
    )
    rows = session.scalars(select(PublishDecision).join(latest, PublishDecision.id == latest.c.publish_id)).all()
    return {published.artifact_id: published for published in rows}


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


@router.post("/{artifact_id}/manual-check")
def manual_check_artifact(artifact_id: int, session: Session = Depends(get_db)) -> dict:
    try:
        return ReviewPublishService(session).manual_check_artifact(artifact_id)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ReviewPublishError as exc:
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
