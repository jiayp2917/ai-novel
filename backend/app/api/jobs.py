import json
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.db.models import Event, Job, ModelCall, PublishDecision
from backend.app.db.session import get_db
from backend.app.core.config import get_settings
from backend.app.services.budget import BudgetGuard
from backend.app.services.worker import JobWorker


router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def _clamp_limit(limit: int) -> int:
    return max(1, min(limit, 200))


def _loads_json(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        loaded = json.loads(value)
    except json.JSONDecodeError:
        return fallback
    if isinstance(fallback, dict) and not isinstance(loaded, dict):
        return fallback
    if isinstance(fallback, list) and not isinstance(loaded, list):
        return fallback
    return loaded


@router.get("")
def list_jobs(session: Session = Depends(get_db)) -> list[dict]:
    jobs = session.scalars(select(Job).order_by(Job.created_at.desc()).limit(100))
    return [
        {
            "id": job.id,
            "type": job.type,
            "status": job.status,
            "payload": _loads_json(job.payload_json, {}),
            "result": _loads_json(job.result_json, None),
            "error": job.error,
            "locked_chapter_id": job.locked_chapter_id,
            "locked_source_file_id": job.locked_source_file_id,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
        }
        for job in jobs
    ]


@router.post("/run-once")
def run_jobs_once(session: Session = Depends(get_db)) -> dict:
    return JobWorker(session).run_once()


@router.get("/model-calls")
def list_model_calls(limit: int = 50, session: Session = Depends(get_db)) -> list[dict]:
    calls = session.scalars(select(ModelCall).order_by(ModelCall.created_at.desc(), ModelCall.id.desc()).limit(_clamp_limit(limit)))
    return [
        {
            "id": call.id,
            "role": call.role,
            "provider": call.provider,
            "model": call.model,
            "prompt_hash": call.prompt_hash,
            "input_chars": call.input_chars,
            "output_chars": call.output_chars,
            "usage": _loads_json(call.usage_json, {}),
            "cost_estimate": call.cost_estimate,
            "cache_hit": call.cache_hit,
            "status": call.status,
            "error": call.error,
            "created_at": call.created_at,
        }
        for call in calls
    ]


@router.get("/events")
def list_events(limit: int = 50, session: Session = Depends(get_db)) -> list[dict]:
    events = session.scalars(select(Event).order_by(Event.created_at.desc(), Event.id.desc()).limit(_clamp_limit(limit)))
    return [
        {
            "id": event.id,
            "event_type": event.event_type,
            "entity_type": event.entity_type,
            "entity_id": event.entity_id,
            "payload": _loads_json(event.payload_json, {}),
            "created_at": event.created_at,
        }
        for event in events
    ]


@router.get("/publish-decisions")
def list_publish_decisions(limit: int = 50, session: Session = Depends(get_db)) -> list[dict]:
    decisions = session.scalars(select(PublishDecision).order_by(PublishDecision.id.desc()).limit(_clamp_limit(limit)))
    return [
        {
            "id": decision.id,
            "artifact_id": decision.artifact_id,
            "approved_by_user": decision.approved_by_user,
            "force": decision.force,
            "force_reason": decision.force_reason,
            "source_hash_before": decision.source_hash_before,
            "candidate_hash": decision.candidate_hash,
            "diff_path": decision.diff_path,
            "backup_path": decision.backup_path,
            "published_at": decision.published_at,
        }
        for decision in decisions
    ]


@router.get("/cost-dashboard")
def cost_dashboard(session: Session = Depends(get_db)) -> dict:
    calls, cost = BudgetGuard(session).today_usage()
    running = session.scalar(select(func.count(Job.id)).where(Job.status == "running")) or 0
    cache_hits = session.scalar(select(func.count(ModelCall.id)).where(ModelCall.cache_hit.is_(True))) or 0
    totals = session.execute(
        select(
            func.coalesce(func.sum(ModelCall.input_chars), 0),
            func.coalesce(func.sum(ModelCall.output_chars), 0),
        )
    ).one()
    provider_usage = session.scalar(select(func.count(ModelCall.id)).where(ModelCall.usage_json.contains('"usage_source": "provider"'))) or 0
    cache_usage = session.scalar(select(func.count(ModelCall.id)).where(ModelCall.usage_json.contains('"usage_source": "cache"'))) or 0
    return {
        "today_model_calls": calls,
        "today_estimated_cost": cost,
        "input_chars": int(totals[0] or 0),
        "output_chars": int(totals[1] or 0),
        "cache_hits": int(cache_hits),
        "provider_usage_count": int(provider_usage),
        "cache_usage_count": int(cache_usage),
        "running_jobs": int(running),
    }


@router.get("/model-constraints")
def model_constraints() -> dict:
    settings = get_settings()
    return {
        "low_cost_mode": settings.low_cost_mode,
        "enable_model_concurrency": settings.enable_model_concurrency,
        "model_max_concurrency": settings.model_max_concurrency,
        "writer_max_concurrency": settings.writer_max_concurrency,
        "reviewer_max_concurrency": settings.reviewer_max_concurrency,
        "memory_max_concurrency": settings.memory_max_concurrency,
        "provider_max_concurrency": settings.provider_max_concurrency,
        "model_timeout_seconds": settings.model_timeout_seconds,
        "daily_max_model_calls": settings.daily_max_model_calls,
        "daily_max_estimated_cost": settings.daily_max_estimated_cost,
        "max_input_chars_per_call": settings.max_input_chars_per_call,
        "max_output_tokens_per_call": settings.max_output_tokens_per_call,
        "kimi_thinking_mode": settings.kimi_thinking_mode,
        "glm_thinking_mode": settings.glm_thinking_mode,
        "usage_note": "本地 usage 是日志可见下限；真实消耗以供应商控制台为准。",
    }
