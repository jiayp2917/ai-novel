from datetime import UTC, datetime
from threading import Lock
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.core.config import Settings, get_settings
from backend.app.db.models import ModelCall


class BudgetExceededError(RuntimeError):
    pass


class BudgetGuard:
    _reserve_lock = Lock()

    def __init__(self, session: Session, settings: Settings | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()

    def check_model_call(self, *, input_chars: int, max_output_tokens: int) -> None:
        if input_chars > self.settings.max_input_chars_per_call:
            raise BudgetExceededError("Input character budget exceeded")
        if max_output_tokens > self.settings.max_output_tokens_per_call:
            raise BudgetExceededError("Output token budget exceeded")
        calls, cost = self.today_usage()
        if calls >= self.settings.daily_max_model_calls:
            raise BudgetExceededError("Daily model call limit exceeded")
        if cost >= self.settings.daily_max_estimated_cost:
            raise BudgetExceededError("Daily estimated cost limit exceeded")

    def reserve_model_call(
        self,
        *,
        route: Any,
        prompt_hash: str,
        input_chars: int,
        max_output_tokens: int,
        cache_hit: bool,
    ) -> ModelCall:
        self._validate_single_call(input_chars=input_chars, max_output_tokens=max_output_tokens)
        reserved_cost = estimate_reserved_cost(input_chars, max_output_tokens)
        with self._reserve_lock:
            calls, cost = self.today_usage()
            if calls + 1 > self.settings.daily_max_model_calls:
                raise BudgetExceededError("Daily model call limit exceeded")
            if cost + reserved_cost > self.settings.daily_max_estimated_cost:
                raise BudgetExceededError("Daily estimated cost limit exceeded")
            call = ModelCall(
                role=route.role,
                provider=route.provider,
                model=route.model,
                prompt_hash=prompt_hash,
                input_chars=input_chars,
                output_chars=0,
                usage_json=f'{{"reserved_max_output_tokens": {max_output_tokens}}}',
                cost_estimate=reserved_cost,
                cache_hit=cache_hit,
                status="reserved",
                error=None,
            )
            self.session.add(call)
            self.session.flush()
            self.session.refresh(call)
            self.session.commit()
            return call

    def today_usage(self) -> tuple[int, float]:
        start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        statement = select(func.count(ModelCall.id), func.coalesce(func.sum(ModelCall.cost_estimate), 0.0)).where(
            ModelCall.created_at >= start,
            ModelCall.status.in_(["reserved", "running", "succeeded", "failed"]),
            ModelCall.cache_hit.is_(False),
        )
        count, cost = self.session.execute(statement).one()
        return int(count or 0), float(cost or 0.0)

    def _validate_single_call(self, *, input_chars: int, max_output_tokens: int) -> None:
        if input_chars > self.settings.max_input_chars_per_call:
            raise BudgetExceededError("Input character budget exceeded")
        if max_output_tokens > self.settings.max_output_tokens_per_call:
            raise BudgetExceededError("Output token budget exceeded")


def estimate_reserved_cost(input_chars: int, max_output_tokens: int) -> float:
    estimated_tokens = input_chars / 2.8 + max_output_tokens
    return round(estimated_tokens / 1_000_000, 6)
