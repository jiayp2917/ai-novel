import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.core.config import get_settings
from backend.app.db.models import Chapter, Review, SourceFile
from backend.app.db.session import get_db
from backend.app.services.artifacts import ArtifactStore
from backend.app.services.workspace import get_active_workspace_info


router = APIRouter(prefix="/api/test", tags=["test-support"])


class SeedCandidateRequest(BaseModel):
    chapter_id: int
    text: str


class SeedReviewedCandidateRequest(SeedCandidateRequest):
    passed: bool = True


class SeedProposalRequest(BaseModel):
    source_file_id: int
    text: str


@router.post("/seed-candidate")
def seed_candidate(payload: SeedCandidateRequest, session: Session = Depends(get_db)) -> dict:
    _assert_test_environment()
    chapter = session.get(Chapter, payload.chapter_id)
    if chapter is None or not chapter.active:
        raise HTTPException(status_code=404, detail="Chapter not found")
    artifact = ArtifactStore(session).save_text(
        kind="candidate",
        text=payload.text,
        metadata={"purpose": "playwright_e2e_mismatch_seed"},
        base_chapter=chapter,
    )
    session.commit()
    return {"artifact_id": artifact.id, "chapter_id": chapter.id}


@router.post("/seed-reviewed-candidate")
def seed_reviewed_candidate(payload: SeedReviewedCandidateRequest, session: Session = Depends(get_db)) -> dict:
    _assert_test_environment()
    chapter = session.get(Chapter, payload.chapter_id)
    if chapter is None or not chapter.active:
        raise HTTPException(status_code=404, detail="Chapter not found")
    artifact = ArtifactStore(session).save_text(
        kind="candidate",
        text=payload.text,
        metadata={"purpose": "playwright_e2e_publish_seed"},
        base_chapter=chapter,
    )
    review = Review(
        artifact_id=artifact.id,
        passed=payload.passed,
        issues_json="[]",
        evidence_count=0,
        manual_required=False,
        candidate_hash=artifact.sha256,
        base_source_file_hash=artifact.base_source_file_hash,
        base_chapter_version_id=artifact.base_chapter_version_id,
    )
    session.add(review)
    session.commit()
    return {"artifact_id": artifact.id, "chapter_id": chapter.id, "review_id": review.id}


@router.post("/seed-proposal")
def seed_proposal(payload: SeedProposalRequest, session: Session = Depends(get_db)) -> dict:
    _assert_test_environment()
    source_file = session.get(SourceFile, payload.source_file_id)
    if source_file is None or not source_file.active:
        raise HTTPException(status_code=404, detail="Source file not found")
    artifact = ArtifactStore(session).save_text(
        kind="proposal",
        text=payload.text,
        metadata={"purpose": "playwright_e2e_proposal_seed"},
        base_source_file=source_file,
    )
    review = Review(
        artifact_id=artifact.id,
        passed=True,
        issues_json=json.dumps([], ensure_ascii=False),
        evidence_count=0,
        manual_required=False,
        candidate_hash=artifact.sha256,
        base_source_file_hash=artifact.base_source_file_hash,
        base_chapter_version_id=artifact.base_chapter_version_id,
    )
    session.add(review)
    session.commit()
    return {"artifact_id": artifact.id, "source_file_id": source_file.id, "review_id": review.id}


def _assert_test_environment() -> None:
    settings = get_settings()
    db_name = settings.app_db_path.name.lower()
    runtime_name = settings.runtime_root.name.lower()
    workspace = get_active_workspace_info().root
    workspace_parts = {part.lower() for part in workspace.parts}
    if "e2e" not in db_name and "test" not in db_name:
        raise HTTPException(status_code=403, detail="Test support requires an e2e/test database")
    if "e2e" not in runtime_name and "test" not in runtime_name:
        raise HTTPException(status_code=403, detail="Test support requires an e2e/test runtime")
    if "sandbox_workspace" not in workspace_parts:
        raise HTTPException(status_code=403, detail="Test support requires sandbox workspace")
