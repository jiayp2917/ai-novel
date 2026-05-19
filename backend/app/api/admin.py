from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.db.models import Artifact
from backend.app.db.session import get_db
from backend.app.services.model_client import ChatMessage, ModelClient, ModelClientError
from backend.app.services.model_router import ModelRouteNotFoundError, ModelRouter
from backend.app.services.skills import SkillLoader
from backend.app.services.workspace import workspace_runtime_root


router = APIRouter(prefix="/api/admin", tags=["admin"])


class ProbeModelRequest(BaseModel):
    role: str
    force: bool = False


@router.post("/probe-model")
def probe_model(payload: ProbeModelRequest, session: Session = Depends(get_db)) -> dict:
    try:
        result = ModelClient(session).chat(
            role=payload.role,
            force=payload.force,
            require_json=True,
            temperature=0.0,
            max_tokens=256,
            messages=[
                ChatMessage(
                    role="system",
                    content="Return strict JSON only.",
                ),
                ChatMessage(
                    role="user",
                    content='Return {"ok": true, "role": "' + payload.role + '"}.',
                ),
            ],
        )
    except (ModelClientError, ModelRouteNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "role": payload.role,
        "provider": result.route.provider,
        "model": result.route.model,
        "cache_hit": result.cache_hit,
        "model_call_id": result.model_call_id,
        "content": result.content,
        "usage": result.usage,
    }


@router.get("/model-routes")
def model_routes() -> dict:
    router_service = ModelRouter()
    roles = ["writer", "reviewer", "fixer", "quick_fix", "outliner", "structural_fix", "memory", "long_context", "arbiter"]
    routes = {}
    for role in roles:
        try:
            route = router_service.route(role)
            routes[role] = {
                "provider": route.provider,
                "model": route.model,
                "base_url": route.base_url,
                "max_tokens": route.max_tokens,
                "cheap": route.cheap,
                "supports_json": route.supports_json,
                "api_key_env": route.api_key_env,
            }
        except ModelRouteNotFoundError as exc:
            routes[role] = {"error": str(exc)}
    return {"routes": routes}


@router.get("/skills")
def enabled_skills(session: Session = Depends(get_db)) -> dict:
    loader = SkillLoader()
    try:
        artifacts = list(session.scalars(select(Artifact).order_by(Artifact.created_at.desc(), Artifact.id.desc()).limit(500)))
    except SQLAlchemyError:
        return {"skills": loader.list_enabled()}
    return {"skills": loader.list_enabled_with_usage(artifacts, workspace_runtime_root())}
