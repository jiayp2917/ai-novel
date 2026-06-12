from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.core.admin_auth import require_admin_access
from backend.app.db.models import MemoryItem
from backend.app.db.session import get_db
from backend.app.schemas import ContextPreview, MemoryItemRead
from backend.app.services.memory import MemoryService


router = APIRouter(prefix="/api/memory", tags=["memory"])


@router.post("/rebuild")
def rebuild_memory(
    _: None = Depends(require_admin_access),
    session: Session = Depends(get_db),
) -> dict[str, int]:
    return MemoryService(session).rebuild()


@router.get("", response_model=list[MemoryItemRead])
def list_memory(session: Session = Depends(get_db)) -> list[MemoryItem]:
    return MemoryService(session).list_memory()


@router.get("/context-preview", response_model=ContextPreview)
def context_preview(chapter_id: int, session: Session = Depends(get_db)) -> dict:
    try:
        return MemoryService(session).context_preview(chapter_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
