import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from backend.app.core.config import Settings
from backend.app.core.config import get_settings
from backend.app.db.base import Base
from backend.app.db.models import ModelCall
from backend.app.db.session import get_engine, reset_engine
from backend.app.main import app
from backend.app.services.model_client import ChatMessage, ModelClient, ModelClientError
from backend.app.services.model_config import ModelConfigService
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


def setup_app_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("CONTENT_ROOT", str(tmp_path / "content"))
    monkeypatch.setenv("RUNTIME_ROOT", str(tmp_path / "runtime"))
    monkeypatch.setenv("APP_RUNTIME_ROOT", str(tmp_path / "runtime"))
    monkeypatch.setenv("WORKSPACE_RUNTIME_ROOT_OVERRIDE", str(tmp_path / "runtime"))
    get_settings.cache_clear()
    reset_engine()
    Base.metadata.create_all(get_engine())


def test_model_config_api_hides_secret_and_keeps_yaml_unchanged(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    config_path = Path("config/model_registry.yaml")
    before = config_path.read_text(encoding="utf-8")
    client = TestClient(app)

    listed = client.get("/api/admin/model-config")
    assert listed.status_code == 200
    writer = next(item for item in listed.json()["roles"] if item["role"] == "writer")
    assert writer["label"] == "AI 写作"
    assert writer["secret"]["status"] in {"missing", "env", "stored"}
    assert "plain-secret" not in json.dumps(listed.json()).lower()

    saved = client.patch(
        "/api/admin/model-config/writer",
        json={
            "provider": "kimi",
            "model": "kimi-k2.6",
            "base_url": "https://api.changed.local/v1",
            "api_key_env": "KIMI_API_KEY",
            "max_tokens": 1234,
        },
    )

    assert saved.status_code == 200
    assert ModelRouter().route("writer").base_url == "https://api.changed.local/v1"
    assert ModelRouter().route("writer").max_tokens == 1234
    assert config_path.read_text(encoding="utf-8") == before


def test_model_config_rejects_invalid_advanced_fields(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    client = TestClient(app)

    invalid_url = client.patch(
        "/api/admin/model-config/writer",
        json={"provider": "kimi", "model": "kimi-k2.6", "base_url": "not-a-url", "api_key_env": "KIMI_API_KEY"},
    )
    invalid_env = client.patch(
        "/api/admin/model-config/writer",
        json={"provider": "kimi", "model": "kimi-k2.6", "base_url": "https://api.changed.local/v1", "api_key_env": "bad env"},
    )

    assert invalid_url.status_code == 400
    assert invalid_url.json()["detail"] == "接口地址必须是有效的 http 或 https 地址。"
    assert invalid_env.status_code == 400
    assert invalid_env.json()["detail"] == "密钥名称必须是环境变量格式，例如 KIMI_API_KEY。"


def test_model_config_secret_response_never_returns_plaintext(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    secret_value = "unit-test-secret-value"

    def fake_save_secret(self: ModelConfigService, provider: str, value: str) -> None:
        assert value == secret_value
        self.runtime_root.mkdir(parents=True, exist_ok=True)
        self.secrets_path.write_text(json.dumps({provider: "encrypted-placeholder"}), encoding="utf-8")

    def fake_get_secret(self: ModelConfigService, provider: str) -> str | None:
        return "stored-secret" if provider == "kimi" else None

    monkeypatch.setattr(ModelConfigService, "can_store_secret", lambda self: True)
    monkeypatch.setattr(ModelConfigService, "save_secret", fake_save_secret)
    monkeypatch.setattr(ModelConfigService, "get_secret", fake_get_secret)
    client = TestClient(app)

    response = client.post("/api/admin/model-config/writer/secret", json={"key": secret_value})

    assert response.status_code == 200
    rendered = json.dumps(response.json(), ensure_ascii=False)
    assert secret_value not in rendered
    assert response.json()["secret"]["status"] == "stored"


def test_probe_model_config_temporary_key_is_not_persisted(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    setup_app_db(tmp_path, monkeypatch)
    monkeypatch.delenv("KIMI_API_KEY", raising=False)
    monkeypatch.setattr(ModelConfigService, "get_secret", lambda self, provider: None)
    client = TestClient(app)
    seen_authorization: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_authorization.append(request.headers.get("Authorization", ""))
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"ok": true}'}}], "usage": {"total_tokens": 1}})

    class FakeHttpClient:
        def post(self, url: str, *, headers: dict[str, str], json: dict, timeout: float) -> httpx.Response:
            request = httpx.Request("POST", url, headers=headers, json=json)
            response = handler(request)
            response.request = request
            return response

    monkeypatch.setattr("backend.app.services.model_client.httpx.Client", lambda: FakeHttpClient())

    response = client.post("/api/admin/model-config/writer/probe", json={"temporary_key": "temporary-only"})

    assert response.status_code == 200
    assert seen_authorization == ["Bearer temporary-only"]
    assert not (tmp_path / "runtime" / "model_secrets.dpapi.json").exists()
    assert "temporary-only" not in json.dumps(response.json(), ensure_ascii=False)
