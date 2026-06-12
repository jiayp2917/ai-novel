from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.app.core.admin_auth import require_admin_access
from backend.app.services.workspace import set_active_workspace, workspace_status


router = APIRouter(prefix="/api/workspace", tags=["workspace"])


class WorkspaceUpdateRequest(BaseModel):
    path: str


@router.get("")
def get_workspace() -> dict:
    return workspace_status()


@router.post("")
def update_workspace(payload: WorkspaceUpdateRequest, _: None = Depends(require_admin_access)) -> dict:
    try:
        return workspace_status(set_active_workspace(Path(payload.path)))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
