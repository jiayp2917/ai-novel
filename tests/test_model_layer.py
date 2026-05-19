import json
from pathlib import Path

import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from backend.app.core.config import Settings
from backend.app.db.base import Base
from backend.app.db.models import ModelCall
from backend.app.services.model_client import ChatMessage, ModelClient, ModelClientError
from backend.app.services.model_router import ModelRouter
from backend.tools.key_env import load_key_file


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
        roles: [reviewer, arbiter]
        default_max_tokens: 12000
        low_cost_max_tokens: 4000
      - id: deepseek-v4-flash
        enabled: true
        cheap: true
        supports_json: true
        roles: [reviewer]
        default_max_tokens: 8000
        low_cost_max_tokens: 2000
  kimi:
    enabled: true
    base_url: https://api.kimi.test
    api_key_env: KIMI_API_KEY
    models:
      - id: kimi-k2.6
        enabled: true
        cheap: false
        supports_json: false
        roles: [writer, fixer, quick_fix]
        default_max_tokens: 10000
  qwen:
    enabled: true
    base_url: https://api.qwen.test
    api_key_env: QWEN_API_KEY
    models:
      - id: qwen3.6-plus
        enabled: true
        cheap: false
        supports_json: true
        roles: [memory, long_context]
        default_max_tokens: 12000
  glm:
    enabled: true
    base_url: https://api.glm.test
    api_key_env: GLM_API_KEY
    models:
      - id: glm-5.1
        enabled: true
        cheap: false
        supports_json: true
        roles: [structural_fix, fixer]
        default_max_tokens: 12000
""",
        encoding="utf-8",
    )


def test_model_router_uses_role_and_default_provider(tmp_path: Path) -> None:
    registry_path = tmp_path / "models.yaml"
    write_registry(registry_path)
    settings = Settings(DEFAULT_MODEL_PROVIDER="kimi", LOW_COST_MODE=False)

    router = ModelRouter(settings=settings, registry_path=registry_path)
    writer_route = router.route("writer")
    reviewer_route = router.route("reviewer")

    assert writer_route.provider == "kimi"
    assert writer_route.model == "kimi-k2.6"
    assert reviewer_route.provider == "deepseek"
    assert reviewer_route.supports_json is True


def test_model_router_uses_explicit_role_priority_over_default_provider(tmp_path: Path) -> None:
    registry_path = tmp_path / "models.yaml"
    write_registry(registry_path)
    settings = Settings(DEFAULT_MODEL_PROVIDER="deepseek", LOW_COST_MODE=False)

    router = ModelRouter(settings=settings, registry_path=registry_path)

    assert router.route("quick_fix").provider == "kimi"
    assert router.route("long_context").provider == "qwen"
    assert router.route("structural_fix").provider == "glm"


def test_model_router_role_provider_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    registry_path = tmp_path / "models.yaml"
    write_registry(registry_path)
    settings = Settings(DEFAULT_MODEL_PROVIDER="deepseek", LOW_COST_MODE=False)
    monkeypatch.setenv("FIXER_PROVIDER", "glm")

    route = ModelRouter(settings=settings, registry_path=registry_path).route("fixer")

    assert route.provider == "glm"
    assert route.model == "glm-5.1"


def test_model_router_low_cost_prefers_cheap_model(tmp_path: Path) -> None:
    registry_path = tmp_path / "models.yaml"
    write_registry(registry_path)
    settings = Settings(DEFAULT_MODEL_PROVIDER="deepseek", LOW_COST_MODE=True, MAX_OUTPUT_TOKENS_PER_CALL=6000)

    route = ModelRouter(settings=settings, registry_path=registry_path).route("reviewer")

    assert route.model == "deepseek-v4-flash"
    assert route.max_tokens == 2000


def test_model_client_records_missing_key_failure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    registry_path = tmp_path / "models.yaml"
    write_registry(registry_path)
    settings = Settings(
        DEFAULT_MODEL_PROVIDER="deepseek",
        RUNTIME_ROOT=tmp_path / "runtime",
        MODEL_TIMEOUT_SECONDS=1,
    )
    session = make_session()
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    router = ModelRouter(settings=settings, registry_path=registry_path)

    with pytest.raises(ModelClientError):
        ModelClient(session, router=router, settings=settings).chat(
            role="reviewer",
            require_json=True,
            messages=[ChatMessage(role="user", content="ping")],
        )

    call = session.scalar(select(ModelCall))
    assert call is not None
    assert call.status == "failed"
    assert call.error and "DEEPSEEK_API_KEY" in call.error


def test_model_client_calls_chat_completions_and_caches(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    registry_path = tmp_path / "models.yaml"
    write_registry(registry_path)
    settings = Settings(
        DEFAULT_MODEL_PROVIDER="deepseek",
        RUNTIME_ROOT=tmp_path / "runtime",
        MODEL_TIMEOUT_SECONDS=1,
    )
    session = make_session()
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")
    seen_payloads: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_payloads.append(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": '{"ok": true}'}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 3, "total_tokens": 13},
            },
        )

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    router = ModelRouter(settings=settings, registry_path=registry_path)
    client = ModelClient(session, router=router, settings=settings, http_client=http_client)
    messages = [ChatMessage(role="user", content="return json")]

    first = client.chat(role="reviewer", require_json=True, messages=messages)
    second = client.chat(role="reviewer", require_json=True, messages=messages)

    assert first.content == '{"ok": true}'
    assert first.cache_hit is False
    assert second.cache_hit is True
    assert len(seen_payloads) == 1
    assert seen_payloads[0]["response_format"] == {"type": "json_object"}
    calls = list(session.scalars(select(ModelCall).order_by(ModelCall.id)))
    assert [call.cache_hit for call in calls] == [False, True]
    assert json.loads(calls[0].usage_json)["usage_source"] == "provider"
    assert json.loads(calls[1].usage_json)["usage_source"] == "cache"


def test_model_client_disables_thinking_for_kimi_and_glm_by_default(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    registry_path = tmp_path / "models.yaml"
    write_registry(registry_path)
    settings = Settings(
        DEFAULT_MODEL_PROVIDER="kimi",
        RUNTIME_ROOT=tmp_path / "runtime",
        MODEL_TIMEOUT_SECONDS=1,
    )
    session = make_session()
    monkeypatch.setenv("KIMI_API_KEY", "test-key")
    seen_payloads: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_payloads.append(json.loads(request.content.decode("utf-8")))
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}], "usage": {"total_tokens": 1}})

    client = ModelClient(
        session,
        router=ModelRouter(settings=settings, registry_path=registry_path),
        settings=settings,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    client.chat(role="quick_fix", messages=[ChatMessage(role="user", content="ping")])

    assert seen_payloads[0]["thinking"] == {"type": "disabled"}
    assert seen_payloads[0]["temperature"] == 0.6


def test_key_file_loader_accepts_plain_and_powershell_formats(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    key_file = tmp_path / "key.txt"
    key_file.write_text(
        """
DEEPSEEK_API_KEY=plain-key
$env:KIMI_API_KEY="quoted-key"
QWEN_API_KEY='single-quoted-key' // comment
GLM_API_KEY=glm-key # comment
""",
        encoding="utf-8",
    )
    for name in ["DEEPSEEK_API_KEY", "KIMI_API_KEY", "QWEN_API_KEY", "GLM_API_KEY"]:
        monkeypatch.delenv(name, raising=False)

    loaded = load_key_file(key_file)

    assert sorted(loaded) == ["DEEPSEEK_API_KEY", "GLM_API_KEY", "KIMI_API_KEY", "QWEN_API_KEY"]
    assert loaded["DEEPSEEK_API_KEY"] == "plain-key"
    assert loaded["KIMI_API_KEY"] == "quoted-key"
    assert loaded["QWEN_API_KEY"] == "single-quoted-key"
    assert loaded["GLM_API_KEY"] == "glm-key"


def test_key_file_loader_accepts_provider_label_formats(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    key_file = tmp_path / "key.txt"
    key_file.write_text(
        """
qwen：qwen-key
kimi:kimi-key
deepseek: deepseek-key
glm: glm-key
""",
        encoding="utf-8",
    )
    for name in ["DEEPSEEK_API_KEY", "KIMI_API_KEY", "QWEN_API_KEY", "GLM_API_KEY"]:
        monkeypatch.delenv(name, raising=False)

    loaded = load_key_file(key_file)

    assert loaded == {
        "QWEN_API_KEY": "qwen-key",
        "KIMI_API_KEY": "kimi-key",
        "DEEPSEEK_API_KEY": "deepseek-key",
        "GLM_API_KEY": "glm-key",
    }


def test_key_file_loader_accepts_key_then_provider_shorthand(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    key_file = tmp_path / "key.txt"
    key_file.write_text(
        """
standalone-kimi-key
sk-deepseek-key deepseek
glm-key-value glm
sk-qwen-key qwen
""",
        encoding="utf-8",
    )
    for name in ["DEEPSEEK_API_KEY", "KIMI_API_KEY", "QWEN_API_KEY", "GLM_API_KEY"]:
        monkeypatch.delenv(name, raising=False)

    loaded = load_key_file(key_file)

    assert loaded == {
        "KIMI_API_KEY": "standalone-kimi-key",
        "DEEPSEEK_API_KEY": "sk-deepseek-key",
        "GLM_API_KEY": "glm-key-value",
        "QWEN_API_KEY": "sk-qwen-key",
    }


def test_key_file_loader_accepts_provider_equals_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    key_file = tmp_path / "key.txt"
    key_file.write_text(
        """
deepseek=sk-deepseek-key
kimi=standalone-kimi-key
qwen=sk-qwen-key
glm=glm-key-value
""",
        encoding="utf-8",
    )
    for name in ["DEEPSEEK_API_KEY", "KIMI_API_KEY", "QWEN_API_KEY", "GLM_API_KEY"]:
        monkeypatch.delenv(name, raising=False)

    loaded = load_key_file(key_file)

    assert loaded == {
        "DEEPSEEK_API_KEY": "sk-deepseek-key",
        "KIMI_API_KEY": "standalone-kimi-key",
        "QWEN_API_KEY": "sk-qwen-key",
        "GLM_API_KEY": "glm-key-value",
    }


def test_key_file_loader_accepts_env_name_with_colon(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    key_file = tmp_path / "key.txt"
    key_file.write_text(
        """
DEEPSEEK_API_KEY:sk-deepseek-key
KIMI_API_KEY:standalone-kimi-key
QWEN_API_KEY:sk-qwen-key
GLM_API_KEY:glm-key-value
""",
        encoding="utf-8",
    )
    for name in ["DEEPSEEK_API_KEY", "KIMI_API_KEY", "QWEN_API_KEY", "GLM_API_KEY"]:
        monkeypatch.delenv(name, raising=False)

    loaded = load_key_file(key_file)

    assert loaded == {
        "DEEPSEEK_API_KEY": "sk-deepseek-key",
        "KIMI_API_KEY": "standalone-kimi-key",
        "QWEN_API_KEY": "sk-qwen-key",
        "GLM_API_KEY": "glm-key-value",
    }
