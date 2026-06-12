from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.app.core.admin_auth import require_admin_access
from backend.app.db.models import Artifact
from backend.app.db.session import get_db
from backend.app.services.model_client import ChatMessage, ModelClient, ModelClientError
from backend.app.services.model_config import ModelConfigService
from backend.app.services.model_router import ModelRoute, ModelRouteNotFoundError, ModelRouter
from backend.app.services.skills import SkillLoader
from backend.app.services.workspace import workspace_runtime_root


router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin_access)])


class ProbeModelRequest(BaseModel):
    role: str
    force: bool = False
    temporary_key: str | None = None


class ProbeModelConfigRequest(BaseModel):
    force: bool = False
    temporary_key: str | None = None


class SaveModelConfigRequest(BaseModel):
    provider: str | None = None
    model: str | None = None
    base_url: str | None = None
    api_key_env: str | None = None
    max_tokens: int | None = None
    cheap: bool | None = None
    supports_json: bool | None = None


class SaveModelProfileRequest(BaseModel):
    name: str | None = None
    provider: str | None = None
    model: str | None = None
    base_url: str | None = None
    api_key_env: str | None = None
    max_tokens: int | None = None
    cheap: bool | None = None
    supports_json: bool | None = None


class AssignModelProfileRequest(BaseModel):
    profile_id: str


class SaveModelSecretRequest(BaseModel):
    key: str


@router.post("/probe-model")
def probe_model(payload: ProbeModelRequest, session: Session = Depends(get_db)) -> dict:
    """Compatibility model probe endpoint; model-config/{role}/probe is preferred."""
    try:
        route = ModelRouter().route(payload.role)
        secret_overrides = {route.provider: payload.temporary_key.strip()} if payload.temporary_key and payload.temporary_key.strip() else None
        result = ModelClient(session, secret_overrides=secret_overrides).chat(
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


@router.get("/model-config")
def model_config() -> dict:
    roles = ["writer", "reviewer", "fixer", "quick_fix", "outliner", "structural_fix", "memory", "long_context", "arbiter"]
    return ModelConfigService().config_payload(roles)


@router.patch("/model-config/{role}")
def save_model_config(role: str, payload: SaveModelConfigRequest) -> dict:
    saved = ModelConfigService().save_route(role, payload.model_dump(exclude_unset=True))
    return {"saved": True, "role": role, "config": saved.__dict__}


@router.post("/model-profiles")
def create_model_profile(payload: SaveModelProfileRequest) -> dict:
    profile = ModelConfigService().save_profile(payload.model_dump(exclude_unset=True))
    return {"saved": True, "profile": profile.__dict__}


@router.patch("/model-profiles/{profile_id}")
def update_model_profile(profile_id: str, payload: SaveModelProfileRequest) -> dict:
    profile = ModelConfigService().save_profile(payload.model_dump(exclude_unset=True), profile_id=profile_id)
    return {"saved": True, "profile": profile.__dict__}


@router.delete("/model-profiles/{profile_id}")
def delete_model_profile(profile_id: str) -> dict:
    ModelConfigService().delete_profile(profile_id)
    return {"deleted": True, "profile_id": profile_id}


@router.post("/model-profiles/{profile_id}/secret")
def save_model_profile_secret(profile_id: str, payload: SaveModelSecretRequest) -> dict:
    service = ModelConfigService()
    profile = service.profile_by_id(profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="模型档案不存在。")
    service.save_secret(profile.provider, payload.key)
    route = ModelRoute(
        role="profile",
        provider=profile.provider,
        model=profile.model,
        base_url=profile.base_url,
        api_key_env=profile.api_key_env,
        max_tokens=profile.max_tokens,
        cheap=profile.cheap,
        supports_json=profile.supports_json,
    )
    return {"saved": True, "profile_id": profile_id, "secret": service.secret_status(route)}


@router.patch("/model-role-assignments/{role}")
def assign_model_profile(role: str, payload: AssignModelProfileRequest) -> dict:
    route = ModelConfigService().assign_profile(role, payload.profile_id)
    return {"saved": True, "role": role, "route": route.__dict__}


@router.post("/model-config/{role}/secret")
def save_model_secret(role: str, payload: SaveModelSecretRequest) -> dict:
    route = ModelRouter().route(role)
    ModelConfigService().save_secret(route.provider, payload.key)
    return {"saved": True, "role": role, "secret": ModelConfigService().secret_status(route)}


@router.post("/model-config/{role}/probe")
def probe_model_config(role: str, payload: ProbeModelConfigRequest | None = None, session: Session = Depends(get_db)) -> dict:
    payload = payload or ProbeModelConfigRequest()
    return probe_model(ProbeModelRequest(role=role, force=payload.force, temporary_key=payload.temporary_key), session=session)


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
