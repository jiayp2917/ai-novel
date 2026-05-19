from pathlib import Path

import pytest
import threading
import time
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from backend.app.core.config import Settings, get_settings
from backend.app.db.base import Base
from backend.app.db.models import Event, Job, ModelCall, PublishDecision
from backend.app.db.session import get_engine, get_session_local, reset_engine
from backend.app.main import app
from backend.app.services.budget import BudgetExceededError, BudgetGuard
from backend.app.services.model_client import (
    ChatMessage,
    ModelClient,
    ModelClientError,
    concurrency_limiter,
    estimate_cost,
)
from backend.app.services.model_router import ModelRouter
from backend.app.services.worker import JobWorker


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def write_registry(path: Path) -> None:
    path.write_text(
        """
providers:
  deepseek:
    enabled: true
    base_url: https://api.deepseek.test
    api_key_env: DEEPSEEK_API_KEY
    models:
      - id: deepseek-v4-pro
        enabled: true
        cheap: false
        supports_json: true
        roles: [reviewer]
        default_max_tokens: 100
""",
        encoding="utf-8",
    )


def test_budget_guard_rejects_input_over_limit() -> None:
    session = make_session()
    settings = Settings(MAX_INPUT_CHARS_PER_CALL=5)

    with pytest.raises(BudgetExceededError, match="Input character"):
        BudgetGuard(session, settings).check_model_call(input_chars=6, max_output_tokens=1)


def test_model_client_records_paused_budget(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    registry = tmp_path / "models.yaml"
    write_registry(registry)
    session = make_session()
    settings = Settings(
        DEFAULT_MODEL_PROVIDER="deepseek",
        RUNTIME_ROOT=tmp_path / "runtime",
        MAX_INPUT_CHARS_PER_CALL=5,
    )
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test")
    router = ModelRouter(settings=settings, registry_path=registry)

    with pytest.raises(ModelClientError, match="budget"):
        ModelClient(session, router=router, settings=settings).chat(
            role="reviewer",
            messages=[ChatMessage(role="user", content="this is too long")],
        )

    call = session.scalar(select(ModelCall))
    assert call is not None
    assert call.status == "paused_budget"


def test_budget_reservation_counts_reserved_output_tokens(tmp_path: Path) -> None:
    session = make_session()
    settings = Settings(
        DAILY_MAX_MODEL_CALLS=2,
        DAILY_MAX_ESTIMATED_COST=0.0011,
        MAX_OUTPUT_TOKENS_PER_CALL=1000,
    )

    class Route:
        role = "reviewer"
        provider = "deepseek"
        model = "deepseek-v4-pro"

    call = BudgetGuard(session, settings).reserve_model_call(
        route=Route(),
        prompt_hash="a" * 64,
        input_chars=100,
        max_output_tokens=1000,
        cache_hit=False,
    )
    session.commit()

    assert call.status == "reserved"
    assert call.cost_estimate and call.cost_estimate > 0.0003
    with pytest.raises(BudgetExceededError, match="Daily estimated cost"):
        BudgetGuard(session, settings).reserve_model_call(
            route=Route(),
            prompt_hash="b" * 64,
            input_chars=100,
            max_output_tokens=1000,
            cache_hit=False,
        )


def test_budget_reservation_commits_before_lock_release(tmp_path: Path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'budget.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    settings = Settings(DAILY_MAX_MODEL_CALLS=1, DAILY_MAX_ESTIMATED_COST=10.0)

    class Route:
        role = "reviewer"
        provider = "deepseek"
        model = "deepseek-v4-pro"

    first = Session(engine)
    second = Session(engine)
    try:
        BudgetGuard(first, settings).reserve_model_call(
            route=Route(),
            prompt_hash="a" * 64,
            input_chars=100,
            max_output_tokens=100,
            cache_hit=False,
        )

        with pytest.raises(BudgetExceededError, match="Daily model call"):
            BudgetGuard(second, settings).reserve_model_call(
                route=Route(),
                prompt_hash="b" * 64,
                input_chars=100,
                max_output_tokens=100,
                cache_hit=False,
            )
    finally:
        first.close()
        second.close()


def test_estimate_cost_uses_reserved_tokens_for_pending_calls() -> None:
    cost = estimate_cost(2800, 0, None, reserved_max_output_tokens=1000)

    assert cost == 0.002


def test_model_concurrency_limiter_respects_reviewer_role_limit() -> None:
    settings = Settings(REVIEWER_MAX_CONCURRENCY=1, PROVIDER_MAX_CONCURRENCY=2, MODEL_MAX_CONCURRENCY=2)

    class Route:
        role = "reviewer"
        provider = "deepseek"

    active = 0
    max_active = 0
    guard = threading.Lock()

    def run() -> None:
        nonlocal active, max_active
        with concurrency_limiter.acquire(Route(), settings):
            with guard:
                active += 1
                max_active = max(max_active, active)
            time.sleep(0.02)
            with guard:
                active -= 1

    threads = [threading.Thread(target=run) for _ in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert max_active == 1


def test_model_concurrency_limiter_respects_provider_limit() -> None:
    settings = Settings(
        WRITER_MAX_CONCURRENCY=4,
        PROVIDER_MAX_CONCURRENCY=1,
        MODEL_MAX_CONCURRENCY=4,
    )

    class Route:
        role = "writer"
        provider = "kimi"

    active = 0
    max_active = 0
    guard = threading.Lock()

    def run() -> None:
        nonlocal active, max_active
        with concurrency_limiter.acquire(Route(), settings):
            with guard:
                active += 1
                max_active = max(max_active, active)
            time.sleep(0.02)
            with guard:
                active -= 1

    threads = [threading.Thread(target=run) for _ in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert max_active == 1


def test_model_concurrency_limiter_respects_memory_role_limit() -> None:
    settings = Settings(
        MEMORY_MAX_CONCURRENCY=1,
        PROVIDER_MAX_CONCURRENCY=3,
        MODEL_MAX_CONCURRENCY=3,
    )

    class Route:
        role = "long_context"
        provider = "qwen"

    active = 0
    max_active = 0
    guard = threading.Lock()

    def run() -> None:
        nonlocal active, max_active
        with concurrency_limiter.acquire(Route(), settings):
            with guard:
                active += 1
                max_active = max(max_active, active)
            time.sleep(0.02)
            with guard:
                active -= 1

    threads = [threading.Thread(target=run) for _ in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert max_active == 1


def test_worker_claims_only_one_job_per_chapter() -> None:
    session = make_session()
    session.add_all(
        [
            Job(type="revise_from_annotations", status="queued", payload_json='{"chapter_id": 1, "annotation_ids": []}', locked_chapter_id=1),
            Job(type="revise_from_annotations", status="queued", payload_json='{"chapter_id": 1, "annotation_ids": []}', locked_chapter_id=1),
            Job(type="revise_from_annotations", status="queued", payload_json='{"chapter_id": 2, "annotation_ids": []}', locked_chapter_id=2),
        ]
    )
    session.commit()

    jobs = JobWorker(session)._claim_jobs(10)

    assert len(jobs) == 2
    claimed_chapters = {
        session.get(Job, job_id).locked_chapter_id
        for job_id in jobs
    }
    assert claimed_chapters == {1, 2}


def test_worker_claim_is_atomic_across_sessions(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())
    with get_session_local()() as session:
        session.add_all(
            [
                Job(
                    type="revise_from_annotations",
                    status="queued",
                    payload_json='{"chapter_id": 1, "annotation_ids": []}',
                    locked_chapter_id=1,
                ),
                Job(
                    type="revise_from_annotations",
                    status="queued",
                    payload_json='{"chapter_id": 1, "annotation_ids": []}',
                    locked_chapter_id=1,
                ),
            ]
        )
        session.commit()

    with get_session_local()() as first, get_session_local()() as second:
        first_claimed = JobWorker(first)._claim_jobs(10)
        second_claimed = JobWorker(second)._claim_jobs(10)

    assert len(first_claimed) + len(second_claimed) == 1
    get_settings.cache_clear()
    reset_engine()


def test_jobs_api_lists_jobs_and_cost_dashboard(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("CONTENT_ROOT", str(tmp_path / "content"))
    monkeypatch.setenv("RUNTIME_ROOT", str(tmp_path / "runtime"))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(tmp_path / "runtime"))
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())
    with Session(get_engine()) as session:
        session.add(Job(type="revise_from_annotations", status="queued", payload_json='{"chapter_id": 1}'))
        session.add(
            ModelCall(
                role="reviewer",
                provider="deepseek",
                model="deepseek-v4-pro",
                prompt_hash="x" * 64,
                input_chars=10,
                output_chars=5,
                usage_json='{"usage_source": "provider", "total_tokens": 9}',
                cost_estimate=0.001,
                cache_hit=False,
                status="succeeded",
            )
        )
        session.add(
            ModelCall(
                role="writer",
                provider="kimi",
                model="kimi-k2.6",
                prompt_hash="y" * 64,
                input_chars=3,
                output_chars=2,
                usage_json="null",
                cache_hit=False,
                status="failed",
                error="bad usage payload",
            )
        )
        session.add(
            Event(
                event_type="artifact_published",
                entity_type="artifact",
                entity_id=7,
                payload_json='{"diff_path": "diffs/artifact_7.diff"}',
            )
        )
        session.add(
            PublishDecision(
                artifact_id=7,
                approved_by_user=True,
                force=False,
                source_hash_before="a" * 64,
                candidate_hash="b" * 64,
                diff_path="diffs/artifact_7.diff",
                backup_path="backups/book.md",
            )
        )
        session.commit()

    client = TestClient(app)
    jobs = client.get("/api/jobs")
    dashboard = client.get("/api/jobs/cost-dashboard")
    calls = client.get("/api/jobs/model-calls")
    events = client.get("/api/jobs/events")
    decisions = client.get("/api/jobs/publish-decisions")

    assert jobs.status_code == 200
    assert jobs.json()[0]["status"] == "queued"
    assert dashboard.status_code == 200
    assert dashboard.json()["today_model_calls"] == 2
    assert dashboard.json()["provider_usage_count"] == 1
    assert calls.status_code == 200
    calls_payload = calls.json()
    assert calls_payload[0]["usage"] == {}
    assert calls_payload[1]["usage"]["total_tokens"] == 9
    assert events.status_code == 200
    assert events.json()[0]["payload"]["diff_path"] == "diffs/artifact_7.diff"
    assert decisions.status_code == 200
    assert decisions.json()[0]["backup_path"] == "backups/book.md"
    constraints = client.get("/api/jobs/model-constraints")
    assert constraints.status_code == 200
    assert constraints.json()["reviewer_max_concurrency"] == 1
    assert constraints.json()["memory_max_concurrency"] == 1
    assert "真实消耗" in constraints.json()["usage_note"]
    get_settings.cache_clear()
    reset_engine()
