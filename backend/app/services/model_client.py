import json
import os
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.config import Settings, get_settings
from backend.app.core.file_utils import safe_read_text, safe_write_text
from backend.app.db.models import ModelCall
from backend.app.services.budget import BudgetExceededError, BudgetGuard
from backend.app.services.model_config import ModelConfigService
from backend.app.services.model_router import ModelRoute, ModelRouter
from backend.app.services.workspace import workspace_runtime_root
from backend.app.utils.hashing import sha256_text


class ModelClientError(RuntimeError):
    pass


class ModelBudgetPausedError(ModelClientError):
    pass


@dataclass(frozen=True)
class ChatMessage:
    role: str
    content: str


@dataclass(frozen=True)
class ModelResponse:
    content: str
    usage: dict[str, Any]
    cache_hit: bool
    model_call_id: int
    route: ModelRoute


class HttpClient(Protocol):
    def post(self, url: str, *, headers: dict[str, str], json: dict[str, Any], timeout: float) -> httpx.Response:
        ...


class ModelClient:
    def __init__(
        self,
        session: Session,
        *,
        router: ModelRouter | None = None,
        settings: Settings | None = None,
        http_client: HttpClient | None = None,
        secret_overrides: dict[str, str] | None = None,
    ) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.router = router or ModelRouter(settings=self.settings)
        self.http_client = http_client or httpx.Client()
        self.secret_overrides = secret_overrides or {}

    def chat(
        self,
        *,
        role: str,
        messages: list[ChatMessage],
        force: bool = False,
        require_json: bool = False,
        temperature: float = 0.2,
        max_tokens: int | None = None,
    ) -> ModelResponse:
        route = self.router.route(role)
        prompt = json.dumps([message.__dict__ for message in messages], ensure_ascii=False, sort_keys=True)
        prompt_hash = sha256_text(f"{role}:{route.provider}:{route.model}:{prompt}")
        requested_max_tokens = max_tokens or route.max_tokens
        cached = self._cached_response(route, prompt_hash)
        if cached is not None and not force:
            call = self._record_call(
                route=route,
                prompt_hash=prompt_hash,
                input_chars=len(prompt),
                output_chars=len(cached),
                usage={"usage_source": "cache"},
                cache_hit=True,
                status="succeeded",
                error=None,
            )
            self.session.commit()
            return ModelResponse(cached, {}, True, call.id, route)
        try:
            call = BudgetGuard(self.session, self.settings).reserve_model_call(
                route=route,
                prompt_hash=prompt_hash,
                input_chars=len(prompt),
                max_output_tokens=requested_max_tokens,
                cache_hit=False,
            )
        except BudgetExceededError as exc:
            call = self._record_call(
                route=route,
                prompt_hash=prompt_hash,
                input_chars=len(prompt),
                output_chars=0,
                usage={},
                cache_hit=False,
                status="paused_budget",
                error=str(exc),
            )
            self.session.commit()
            raise ModelBudgetPausedError(f"{exc}; call_id={call.id}") from exc

        api_key = (
            self.secret_overrides.get(route.provider)
            or ModelConfigService().get_secret(route.provider)
            or os.getenv(route.api_key_env, "").strip()
        )
        if not api_key:
            self._update_call(
                call,
                output_chars=0,
                usage={},
                status="failed",
                error=f"Missing API key env: {route.api_key_env}",
            )
            self.session.commit()
            raise ModelClientError(f"Missing API key env: {route.api_key_env}; call_id={call.id}")

        payload = self._payload(
            route=route,
            messages=messages,
            require_json=require_json,
            temperature=temperature,
            max_tokens=requested_max_tokens,
        )

        start = time.perf_counter()
        last_error: str | None = None
        for attempt in range(1, 4):
            try:
                call.status = "running"
                self.session.commit()
                with concurrency_limiter.acquire(route, self.settings):
                    response = self.http_client.post(
                        self._chat_url(route),
                        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                        json=payload,
                        timeout=float(self.settings.model_timeout_seconds),
                    )
                response.raise_for_status()
                data = response.json()
                content = self._extract_content(data)
                usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
                elapsed = time.perf_counter() - start
                usage_source = "provider" if usage else "local_estimate"
                usage_with_elapsed = {
                    **usage,
                    "elapsed_seconds": round(elapsed, 3),
                    "attempt": attempt,
                    "usage_source": usage_source,
                }
                self._write_cache(route, prompt_hash, content)
                self._update_call(
                    call,
                    output_chars=len(content),
                    usage=usage_with_elapsed,
                    status="succeeded",
                    error=None,
                )
                self.session.commit()
                return ModelResponse(content, usage_with_elapsed, False, call.id, route)
            except httpx.HTTPStatusError as exc:
                detail = exc.response.text[:500] if exc.response is not None else ""
                last_error = f"{exc.response.status_code} {detail}".strip()
                if attempt == 3:
                    break
                time.sleep(min(2**attempt, 5))
            except (httpx.HTTPError, ValueError, KeyError) as exc:
                last_error = str(exc)
                if attempt == 3:
                    break
                time.sleep(min(2**attempt, 5))

        self._update_call(
            call,
            output_chars=0,
            usage={"elapsed_seconds": round(time.perf_counter() - start, 3)},
            status="failed",
            error=last_error,
        )
        self.session.commit()
        raise ModelClientError(f"Model call failed: {last_error}; call_id={call.id}")

    def _payload(
        self,
        *,
        route: ModelRoute,
        messages: list[ChatMessage],
        require_json: bool,
        temperature: float,
        max_tokens: int,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": route.model,
            "messages": [message.__dict__ for message in messages],
            "temperature": self._temperature(route, temperature),
            "max_tokens": min(max_tokens, self.settings.max_output_tokens_per_call),
        }
        if require_json and route.supports_json:
            payload["response_format"] = {"type": "json_object"}
        if route.provider == "kimi":
            payload["thinking"] = {"type": self.settings.kimi_thinking_mode}
        if route.provider == "glm":
            payload["thinking"] = {"type": self.settings.glm_thinking_mode}
        return payload

    def _temperature(self, route: ModelRoute, requested: float) -> float:
        if route.provider == "kimi" and route.model == "kimi-k2.6":
            return 0.6
        return requested

    def _extract_content(self, data: dict[str, Any]) -> str:
        choices = data.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ModelClientError("Model response has no choices")
        message = choices[0].get("message")
        if not isinstance(message, dict):
            raise ModelClientError("Model response choice has no message")
        content = message.get("content")
        if not isinstance(content, str):
            raise ModelClientError("Model response content is not text")
        return content

    def _chat_url(self, route: ModelRoute) -> str:
        return route.base_url.rstrip("/") + "/chat/completions"

    def _cache_dir(self) -> Path:
        path = workspace_runtime_root(settings=self.settings) / "logs" / "model_cache"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _cache_path(self, route: ModelRoute, prompt_hash: str) -> Path:
        return self._cache_dir() / f"{route.role}_{route.provider}_{route.model}_{prompt_hash}.json"

    def _cached_response(self, route: ModelRoute, prompt_hash: str) -> str | None:
        path = self._cache_path(route, prompt_hash)
        if not path.exists():
            return None
        try:
            data = json.loads(safe_read_text(path, encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        content = data.get("content")
        return content if isinstance(content, str) else None

    def _write_cache(self, route: ModelRoute, prompt_hash: str, content: str) -> None:
        path = self._cache_path(route, prompt_hash)
        temp_path = path.with_suffix(path.suffix + ".tmp")
        safe_write_text(temp_path, json.dumps({"content": content}, ensure_ascii=False), encoding="utf-8")
        temp_path.replace(path)

    def _record_call(
        self,
        *,
        route: ModelRoute,
        prompt_hash: str,
        input_chars: int,
        output_chars: int,
        usage: dict[str, Any],
        cache_hit: bool,
        status: str,
        error: str | None,
    ) -> ModelCall:
        total_tokens = usage.get("total_tokens")
        cost_estimate = estimate_cost(
            input_chars,
            output_chars,
            total_tokens,
            reserved_max_output_tokens=usage.get("reserved_max_output_tokens"),
        )
        call = ModelCall(
            role=route.role,
            provider=route.provider,
            model=route.model,
            prompt_hash=prompt_hash,
            input_chars=input_chars,
            output_chars=output_chars,
            usage_json=json.dumps(usage, ensure_ascii=False),
            cost_estimate=cost_estimate,
            cache_hit=cache_hit,
            status=status,
            error=error,
        )
        self.session.add(call)
        self.session.flush()
        self.session.refresh(call)
        return call

    def _update_call(
        self,
        call: ModelCall,
        *,
        output_chars: int,
        usage: dict[str, Any],
        status: str,
        error: str | None,
    ) -> None:
        call.output_chars = output_chars
        call.usage_json = json.dumps(usage, ensure_ascii=False)
        call.cost_estimate = estimate_cost(call.input_chars, output_chars, usage.get("total_tokens"))
        call.status = status
        call.error = error
        self.session.flush()


def estimate_cost(
    input_chars: int,
    output_chars: int,
    total_tokens: Any,
    *,
    reserved_max_output_tokens: Any = None,
) -> float:
    if isinstance(total_tokens, (int, float)) and total_tokens > 0:
        return round(float(total_tokens) / 1_000_000, 6)
    effective_output = output_chars
    if output_chars == 0 and isinstance(reserved_max_output_tokens, (int, float)):
        effective_output = int(reserved_max_output_tokens) * 2.8
    estimated_tokens = (input_chars + effective_output) / 2.8
    return round(estimated_tokens / 1_000_000, 6)


def cached_model_call(session: Session, *, role: str, prompt_hash: str) -> ModelCall | None:
    return session.scalar(
        select(ModelCall)
        .where(ModelCall.role == role, ModelCall.prompt_hash == prompt_hash, ModelCall.status == "succeeded")
        .order_by(ModelCall.id.desc())
    )


class ModelConcurrencyLimiter:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._provider_semaphores: dict[str, threading.BoundedSemaphore] = {}
        self._role_semaphores: dict[str, threading.BoundedSemaphore] = {}

    @contextmanager
    def acquire(self, route: ModelRoute, settings: Settings):
        provider_limit = max(1, settings.provider_max_concurrency)
        role_limit = max(1, self._role_limit(route.role, settings))
        provider_gate = self._provider_gate(route.provider, provider_limit)
        role_gate = self._role_gate(route.role, role_limit)
        provider_gate.acquire()
        role_gate.acquire()
        try:
            yield
        finally:
            role_gate.release()
            provider_gate.release()

    def _provider_gate(self, provider: str, limit: int) -> threading.BoundedSemaphore:
        key = f"{provider}:{limit}"
        with self._lock:
            gate = self._provider_semaphores.get(key)
            if gate is None:
                gate = threading.BoundedSemaphore(limit)
                self._provider_semaphores[key] = gate
            return gate

    def _role_gate(self, role: str, limit: int) -> threading.BoundedSemaphore:
        key = f"{role}:{limit}"
        with self._lock:
            gate = self._role_semaphores.get(key)
            if gate is None:
                gate = threading.BoundedSemaphore(limit)
                self._role_semaphores[key] = gate
            return gate

    def _role_limit(self, role: str, settings: Settings) -> int:
        if role == "reviewer":
            return settings.reviewer_max_concurrency
        if role in {"memory", "long_context"}:
            return settings.memory_max_concurrency
        if role in {"writer", "fixer", "quick_fix", "structural_fix"}:
            return settings.writer_max_concurrency
        return settings.model_max_concurrency


concurrency_limiter = ModelConcurrencyLimiter()
