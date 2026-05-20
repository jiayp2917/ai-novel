from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.services.pipeline.runs import PipelineRunError, PipelineRunService
from backend.app.services.pipeline.state_machine import PipelineTransitionError


router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])


class PipelineRunCreateRequest(BaseModel):
    start_chapter: int = Field(ge=1)
    end_chapter: int = Field(ge=1)
    mode: str
    chunk_size: int = Field(default=3, ge=1, le=20)
    max_fix_rounds: int = Field(default=2, ge=0, le=5)
    dry_run: bool = True


@router.post("/runs")
def create_pipeline_run(payload: PipelineRunCreateRequest, session: Session = Depends(get_db)) -> dict:
    try:
        return PipelineRunService(session).create_run(
            start_chapter=payload.start_chapter,
            end_chapter=payload.end_chapter,
            mode=payload.mode,
            chunk_size=payload.chunk_size,
            max_fix_rounds=payload.max_fix_rounds,
            dry_run=payload.dry_run,
        )
    except PipelineRunError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/runs")
def list_pipeline_runs(limit: int = Query(default=100, ge=1, le=500), session: Session = Depends(get_db)) -> list[dict]:
    return PipelineRunService(session).list_runs(limit=limit)


@router.get("/runs/{run_id}")
def get_pipeline_run(run_id: int, session: Session = Depends(get_db)) -> dict:
    try:
        return PipelineRunService(session).get_run(run_id)
    except PipelineRunError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/runs/{run_id}/pause")
def pause_pipeline_run(run_id: int, session: Session = Depends(get_db)) -> dict:
    return _mutate_run(session, run_id, "pause")


@router.post("/runs/{run_id}/resume")
def resume_pipeline_run(run_id: int, session: Session = Depends(get_db)) -> dict:
    return _mutate_run(session, run_id, "resume")


@router.post("/runs/{run_id}/retry")
def retry_pipeline_run(run_id: int, session: Session = Depends(get_db)) -> dict:
    return _mutate_run(session, run_id, "retry")


@router.post("/runs/{run_id}/cancel")
def cancel_pipeline_run(run_id: int, session: Session = Depends(get_db)) -> dict:
    return _mutate_run(session, run_id, "cancel")


@router.delete("/runs/{run_id}")
def delete_pipeline_run(run_id: int, session: Session = Depends(get_db)) -> dict:
    try:
        return PipelineRunService(session).delete_run(run_id)
    except PipelineRunError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/runs/{run_id}/delete")
def delete_pipeline_run_compat(run_id: int, session: Session = Depends(get_db)) -> dict:
    try:
        return PipelineRunService(session).delete_run(run_id)
    except PipelineRunError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _mutate_run(session: Session, run_id: int, action: str) -> dict:
    service = PipelineRunService(session)
    try:
        if action == "pause":
            return service.pause(run_id)
        if action == "resume":
            return service.resume(run_id)
        if action == "retry":
            return service.retry(run_id)
        if action == "cancel":
            return service.cancel(run_id)
    except PipelineRunError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PipelineTransitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise HTTPException(status_code=400, detail="Unsupported pipeline action")
