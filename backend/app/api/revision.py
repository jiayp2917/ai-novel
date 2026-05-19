from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.db.models import Chapter
from backend.app.db.session import get_db
from backend.app.services.annotations import InvalidRequestError, NotFoundError
from backend.app.services.artifacts import ArtifactStore
from backend.app.services.chapter_versions import ChapterVersionService
from backend.app.services.model_client import ModelClientError
from backend.app.services.revision import RevisionService, create_snapshot_candidate_for_chapter


router = APIRouter(prefix="/api", tags=["revision"])


class ReviseFromAnnotationsRequest(BaseModel):
    annotation_ids: list[int] = []
    force: bool = False


class DraftCandidateRequest(BaseModel):
    text: str


@router.post("/chapters/{chapter_id}/revise-from-annotations")
def revise_from_annotations(
    chapter_id: int,
    payload: ReviseFromAnnotationsRequest,
    session: Session = Depends(get_db),
) -> dict:
    try:
        return RevisionService(session).revise_from_annotations(
            chapter_id=chapter_id,
            annotation_ids=payload.annotation_ids,
            force=payload.force,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (InvalidRequestError, ModelClientError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/chapters/{chapter_id}/snapshot-candidate")
def create_snapshot_candidate(chapter_id: int, session: Session = Depends(get_db)) -> dict:
    chapter = session.get(Chapter, chapter_id)
    if chapter is None or not chapter.active:
        raise HTTPException(status_code=404, detail="Chapter not found")
    try:
        artifact = create_snapshot_candidate_for_chapter(session, chapter)
    except (ValueError, InvalidRequestError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "artifact_id": artifact.id,
        "artifact_path": artifact.path,
        "artifact_sha256": artifact.sha256,
        "chapter_id": chapter.id,
        "chapter_no": chapter.chapter_no,
    }


@router.post("/chapters/{chapter_id}/draft-candidate")
def create_draft_candidate(
    chapter_id: int,
    payload: DraftCandidateRequest,
    session: Session = Depends(get_db),
) -> dict:
    chapter = session.get(Chapter, chapter_id)
    if chapter is None or not chapter.active:
        raise HTTPException(status_code=404, detail="Chapter not found")
    if chapter.current_version is None:
        raise HTTPException(status_code=400, detail="Chapter has no current version")
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Draft text is empty")
    artifact = ArtifactStore(session).save_text(
        kind="candidate",
        text=text,
        metadata={
            "purpose": "front_end_draft_candidate",
            "source": "manual_editor_draft",
            "requires_ai_review": False,
            "chapter_no": chapter.chapter_no,
        },
        base_chapter=chapter,
    )
    version = ChapterVersionService(session).save_unpublished_version(chapter, text)
    session.commit()
    return {
        "artifact_id": artifact.id,
        "artifact_path": artifact.path,
        "artifact_sha256": artifact.sha256,
        "version_id": version.id,
        "chapter_id": chapter.id,
        "chapter_no": chapter.chapter_no,
    }


@router.post("/source-files/{source_file_id}/draft-proposal")
def create_source_draft_proposal(
    source_file_id: int,
    payload: DraftCandidateRequest,
    session: Session = Depends(get_db),
) -> dict:
    from backend.app.db.models import SourceFile

    source_file = session.get(SourceFile, source_file_id)
    if source_file is None or not source_file.active:
        raise HTTPException(status_code=404, detail="Source file not found")
    if source_file.kind == "chapters":
        raise HTTPException(status_code=400, detail="Chapter source files must use chapter draft candidates")
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Draft text is empty")
    artifact = ArtifactStore(session).save_text(
        kind="proposal",
        text=text,
        metadata={
            "purpose": "front_end_source_draft_proposal",
            "source": "manual_editor_draft",
            "requires_ai_review": False,
            "source_file_id": source_file.id,
        },
        base_source_file=source_file,
    )
    session.commit()
    return {
        "artifact_id": artifact.id,
        "artifact_path": artifact.path,
        "artifact_sha256": artifact.sha256,
        "source_file_id": source_file.id,
    }
