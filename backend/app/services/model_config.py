from __future__ import annotations

import base64
import ctypes
import json
import os
import platform
from ctypes import wintypes
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from backend.app.core.file_utils import safe_read_text, safe_write_text
from backend.app.services.model_registry import ModelRegistryError, provider_config_api_key_env
from backend.app.services.model_router import ModelRoute, ModelRouter
from backend.app.services.workspace import app_runtime_root


CONFIG_FILENAME = "model_config_overrides.json"
SECRETS_FILENAME = "model_secrets.dpapi.json"


@dataclass(frozen=True)
class ModelRouteOverride:
    role: str
    provider: str
    model: str
    base_url: str
    api_key_env: str
    max_tokens: int
    cheap: bool
    supports_json: bool


class SecretStoreUnavailable(RuntimeError):
    pass


class ModelConfigService:
    def __init__(self, runtime_root: Path | None = None) -> None:
        self.runtime_root = (runtime_root or app_runtime_root()).resolve()
        self.config_path = self.runtime_root / CONFIG_FILENAME
        self.secrets_path = self.runtime_root / SECRETS_FILENAME

    def routes(self) -> dict[str, ModelRouteOverride]:
        raw = self._read_config()
        routes = raw.get("routes", {})
        if not isinstance(routes, dict):
            return {}
        parsed: dict[str, ModelRouteOverride] = {}
        for role, value in routes.items():
            if not isinstance(value, dict):
                continue
            try:
                parsed[str(role)] = ModelRouteOverride(
                    role=str(role),
                    provider=str(value["provider"]),
                    model=str(value["model"]),
                    base_url=str(value["base_url"]),
                    api_key_env=str(value["api_key_env"]),
                    max_tokens=int(value["max_tokens"]),
                    cheap=bool(value.get("cheap", False)),
                    supports_json=bool(value.get("supports_json", False)),
                )
            except (KeyError, TypeError, ValueError):
                continue
        return parsed

    def route_for_role(self, role: str) -> ModelRoute | None:
        override = self.routes().get(role)
        if override is None:
            return None
        return ModelRoute(
            role=role,
            provider=override.provider,
            model=override.model,
            base_url=override.base_url,
            api_key_env=override.api_key_env,
            max_tokens=override.max_tokens,
            cheap=override.cheap,
            supports_json=override.supports_json,
        )

    def save_route(self, role: str, payload: dict[str, Any]) -> ModelRouteOverride:
        default_route = ModelRouter(use_runtime_overrides=False).route(role)
        provider = str(payload.get("provider") or default_route.provider).strip()
        model = str(payload.get("model") or default_route.model).strip()
        base_url = str(payload.get("base_url") or default_route.base_url).strip()
        api_key_env = str(payload.get("api_key_env") or _api_key_env_for_provider(provider, default_route.api_key_env)).strip()
        if not provider or not model or not base_url or not api_key_env:
            raise HTTPException(status_code=400, detail="模型、接口地址和密钥名称不能为空。")
        try:
            max_tokens = int(payload.get("max_tokens") or default_route.max_tokens)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="输出上限必须是正整数。") from exc
        if max_tokens <= 0:
            raise HTTPException(status_code=400, detail="输出上限必须是正整数。")

        override = ModelRouteOverride(
            role=role,
            provider=provider,
            model=model,
            base_url=base_url,
            api_key_env=api_key_env,
            max_tokens=max_tokens,
            cheap=bool(payload.get("cheap", default_route.cheap)),
            supports_json=bool(payload.get("supports_json", default_route.supports_json)),
        )
        raw = self._read_config()
        routes = raw.get("routes")
        if not isinstance(routes, dict):
            routes = {}
        routes[role] = asdict(override)
        raw["routes"] = routes
        self._write_config(raw)
        return override

    def config_payload(self, roles: list[str]) -> dict[str, Any]:
        router = ModelRouter(use_runtime_overrides=False)
        overrides = self.routes()
        items = []
        for role in roles:
            try:
                default_route = router.route(role)
                active = self.route_for_role(role) or default_route
                override = overrides.get(role)
                items.append(
                    {
                        "role": role,
                        "label": role_label(role),
                        "purpose": role_purpose(role),
                        "provider": active.provider,
                        "provider_label": provider_label(active.provider),
                        "model": active.model,
                        "base_url": active.base_url,
                        "api_key_env": active.api_key_env,
                        "max_tokens": active.max_tokens,
                        "cheap": active.cheap,
                        "supports_json": active.supports_json,
                        "overridden": override is not None,
                        "default": {
                            "provider": default_route.provider,
                            "provider_label": provider_label(default_route.provider),
                            "model": default_route.model,
                            "base_url": default_route.base_url,
                            "api_key_env": default_route.api_key_env,
                            "max_tokens": default_route.max_tokens,
                            "cheap": default_route.cheap,
                            "supports_json": default_route.supports_json,
                        },
                        "secret": self.secret_status(active),
                    }
                )
            except Exception as exc:
                items.append({"role": role, "label": role_label(role), "purpose": role_purpose(role), "error": str(exc)})
        return {"roles": items, "secret_store": self.secret_store_status()}

    def secret_status(self, route: ModelRoute) -> dict[str, Any]:
        if self.get_secret(route.provider) is not None:
            return {"status": "stored", "label": "已安全保存", "can_save": self.can_store_secret(), "env_name": route.api_key_env}
        if os.getenv(route.api_key_env, "").strip():
            return {"status": "env", "label": "来自本机环境", "can_save": self.can_store_secret(), "env_name": route.api_key_env}
        return {"status": "missing", "label": "未配置", "can_save": self.can_store_secret(), "env_name": route.api_key_env}

    def secret_store_status(self) -> dict[str, Any]:
        if self.can_store_secret():
            return {"available": True, "label": "可使用 Windows 本机加密保存"}
        return {"available": False, "label": "当前系统暂不支持应用内加密保存，请继续使用 key.txt 或环境变量"}

    def can_store_secret(self) -> bool:
        return platform.system().lower() == "windows"

    def save_secret(self, provider: str, value: str) -> None:
        provider = provider.strip()
        value = value.strip()
        if not provider:
            raise HTTPException(status_code=400, detail="供应商不能为空。")
        if not value:
            raise HTTPException(status_code=400, detail="密钥不能为空。")
        if not self.can_store_secret():
            raise HTTPException(status_code=400, detail="当前系统不支持应用内加密保存，请继续使用 key.txt 或环境变量。")
        encrypted = _protect_secret(value)
        secrets = self._read_secrets()
        secrets[provider] = encrypted
        self._write_secrets(secrets)

    def get_secret(self, provider: str) -> str | None:
        encrypted = self._read_secrets().get(provider)
        if not isinstance(encrypted, str) or not encrypted:
            return None
        try:
            return _unprotect_secret(encrypted)
        except SecretStoreUnavailable:
            return None

    def _read_config(self) -> dict[str, Any]:
        if not self.config_path.exists():
            return {}
        try:
            data = json.loads(safe_read_text(self.config_path, encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=500, detail="模型配置文件格式错误。") from exc
        return data if isinstance(data, dict) else {}

    def _write_config(self, data: dict[str, Any]) -> None:
        self.runtime_root.mkdir(parents=True, exist_ok=True)
        safe_write_text(self.config_path, json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def _read_secrets(self) -> dict[str, str]:
        if not self.secrets_path.exists():
            return {}
        try:
            data = json.loads(safe_read_text(self.secrets_path, encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
        return {str(key): str(value) for key, value in data.items()} if isinstance(data, dict) else {}

    def _write_secrets(self, data: dict[str, str]) -> None:
        self.runtime_root.mkdir(parents=True, exist_ok=True)
        safe_write_text(self.secrets_path, json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def role_label(role: str) -> str:
    return {
        "writer": "AI 写作",
        "reviewer": "AI 检查",
        "fixer": "AI 修订",
        "quick_fix": "AI 小修",
        "outliner": "章纲规划",
        "structural_fix": "结构修订",
        "memory": "记忆整理",
        "long_context": "记忆整理",
        "arbiter": "高风险判断",
    }.get(role, role)


def role_purpose(role: str) -> str:
    return {
        "writer": "生成章节草稿，不直接写回正文。",
        "reviewer": "检查草稿问题，只给判断和证据。",
        "fixer": "根据检查结果修订草稿。",
        "quick_fix": "处理明确的小范围修订。",
        "outliner": "生成或调整章纲提案。",
        "structural_fix": "处理结构、节奏和章纲修订。",
        "memory": "整理短记忆和写作规则。",
        "long_context": "整理记忆和长上下文，不创作正文。",
        "arbiter": "辅助高风险人工判断，不自动发布。",
    }.get(role, "辅助小说创作流程。")


def provider_label(provider: str) -> str:
    return {
        "kimi": "Moonshot / Kimi",
        "deepseek": "DeepSeek",
        "qwen": "通义千问",
        "glm": "智谱 GLM",
    }.get(provider, provider)


def _api_key_env_for_provider(provider: str, fallback: str) -> str:
    try:
        return provider_config_api_key_env(provider)
    except ModelRegistryError:
        return fallback


class DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _protect_secret(value: str) -> str:
    if platform.system().lower() != "windows":
        raise SecretStoreUnavailable("DPAPI is only available on Windows")
    data = value.encode("utf-8")
    in_blob = DATA_BLOB(len(data), ctypes.cast(ctypes.create_string_buffer(data), ctypes.POINTER(ctypes.c_char)))
    out_blob = DATA_BLOB()
    if not ctypes.windll.crypt32.CryptProtectData(ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob)):
        raise SecretStoreUnavailable("Windows failed to protect secret")
    try:
        encrypted = ctypes.string_at(out_blob.pbData, out_blob.cbData)
        return base64.b64encode(encrypted).decode("ascii")
    finally:
        ctypes.windll.kernel32.LocalFree(out_blob.pbData)


def _unprotect_secret(value: str) -> str:
    if platform.system().lower() != "windows":
        raise SecretStoreUnavailable("DPAPI is only available on Windows")
    encrypted = base64.b64decode(value.encode("ascii"))
    in_blob = DATA_BLOB(len(encrypted), ctypes.cast(ctypes.create_string_buffer(encrypted), ctypes.POINTER(ctypes.c_char)))
    out_blob = DATA_BLOB()
    if not ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob)):
        raise SecretStoreUnavailable("Windows failed to unprotect secret")
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData).decode("utf-8")
    finally:
        ctypes.windll.kernel32.LocalFree(out_blob.pbData)
