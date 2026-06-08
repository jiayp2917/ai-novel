import json
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.db.models import Artifact, Chapter, Event, Job, ModelCall, PublishDecision, Review
from backend.app.db.session import get_db
from backend.app.core.config import get_settings
from backend.app.services.budget import BudgetGuard
from backend.app.services.worker import JobWorker
from backend.app.services.workspace import workspace_runtime_root
from backend.tools.model_usage_report import collect_model_usage_report


router = APIRouter(prefix="/api/jobs", tags=["jobs"])


class ModelCallCleanupRequest(BaseModel):
    retain_days: int = Field(default=30, ge=1, le=365)
    failed_only: bool = False
    confirm_cleanup: bool = False


def _clamp_limit(limit: int) -> int:
    return max(1, min(limit, 200))


def _clamp_report_limit(limit: int) -> int:
    return max(1, min(limit, 2000))


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
def list_model_calls(limit: int = 50, failed_only: bool = False, session: Session = Depends(get_db)) -> list[dict]:
    calls_stmt = select(ModelCall).order_by(ModelCall.created_at.desc(), ModelCall.id.desc()).limit(_clamp_limit(limit))
    if failed_only:
        calls_stmt = calls_stmt.where(ModelCall.status == "failed")
    calls = session.scalars(calls_stmt)
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


@router.post("/model-calls/cleanup")
def cleanup_model_calls(payload: ModelCallCleanupRequest, session: Session = Depends(get_db)) -> dict:
    if not payload.confirm_cleanup:
        raise HTTPException(status_code=400, detail="清理 AI 调用记录前需要确认。")

    cutoff = datetime.now(UTC) - timedelta(days=payload.retain_days)
    calls_stmt = select(ModelCall).where(ModelCall.created_at < cutoff)
    if payload.failed_only:
        calls_stmt = calls_stmt.where(ModelCall.status == "failed")
    calls = list(session.scalars(calls_stmt))
    deleted = len(calls)
    for call in calls:
        session.delete(call)
    session.add(
        Event(
            event_type="model_calls_cleaned",
            entity_type="model_calls",
            entity_id=0,
            payload_json=json.dumps(
                {
                    "deleted": deleted,
                    "retain_days": payload.retain_days,
                    "failed_only": payload.failed_only,
                    "cutoff": cutoff.isoformat(),
                },
                ensure_ascii=False,
            ),
        )
    )
    session.commit()
    return {
        "deleted": deleted,
        "retain_days": payload.retain_days,
        "failed_only": payload.failed_only,
        "cutoff": cutoff.isoformat(),
    }


@router.get("/model-usage-report")
def model_usage_report(days: int = 30, limit: int = 500, session: Session = Depends(get_db)) -> dict:
    report_limit = _clamp_report_limit(limit)
    since = None
    if days > 0:
        since = datetime.now(UTC) - timedelta(days=days)

    calls_stmt = select(ModelCall).order_by(ModelCall.created_at.desc(), ModelCall.id.desc()).limit(report_limit)
    jobs_stmt = select(Job).order_by(Job.created_at.desc(), Job.id.desc()).limit(report_limit)
    artifacts_stmt = select(Artifact).order_by(Artifact.created_at.desc(), Artifact.id.desc()).limit(report_limit)
    reviews_stmt = select(Review).order_by(Review.created_at.desc(), Review.id.desc()).limit(report_limit)
    if since is not None:
        calls_stmt = calls_stmt.where(ModelCall.created_at >= since)
        jobs_stmt = jobs_stmt.where(Job.created_at >= since)
        artifacts_stmt = artifacts_stmt.where(Artifact.created_at >= since)
        reviews_stmt = reviews_stmt.where(Review.created_at >= since)

    calls = list(session.scalars(calls_stmt))
    jobs = list(session.scalars(jobs_stmt))
    artifacts = list(session.scalars(artifacts_stmt))
    reviews = list(session.scalars(reviews_stmt))
    decisions = list(session.scalars(select(PublishDecision).order_by(PublishDecision.id.desc()).limit(report_limit)))
    chapters = list(session.execute(select(Chapter.id, Chapter.chapter_no, Chapter.title)))
    chapter_lookup = {
        chapter_id: {"chapter_no": chapter_no, "title": title}
        for chapter_id, chapter_no, title in chapters
    }
    return collect_model_usage_report(
        calls,
        jobs,
        reviews=reviews,
        artifacts=artifacts,
        decisions=decisions,
        runtime_root=workspace_runtime_root(),
        chapter_lookup=chapter_lookup,
    )


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
