"""模型配置服务：维护角色路由、profile 列表与密钥存取。"""
from __future__ import annotations

import base64
import ctypes
import hashlib
import json
import os
import platform
from urllib.parse import urlparse
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
ALL_MODEL_ROLES = ["writer", "reviewer", "fixer", "quick_fix", "outliner", "structural_fix", "memory", "long_context", "arbiter"]


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


@dataclass(frozen=True)
class ModelProfile:
    id: str
    name: str
    provider: str
    model: str
    base_url: str
    api_key_env: str
    max_tokens: int
    cheap: bool
    supports_json: bool
    built_in: bool = False


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
        assignment = self.role_assignments().get(role)
        profile = self.profile_by_id(assignment) if assignment else None
        if profile is not None:
            return ModelRoute(
                role=role,
                provider=profile.provider,
                model=profile.model,
                base_url=profile.base_url,
                api_key_env=profile.api_key_env,
                max_tokens=profile.max_tokens,
                cheap=profile.cheap,
                supports_json=profile.supports_json,
            )
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
        provider = _payload_text(payload, "provider", default_route.provider)
        model = _payload_text(payload, "model", default_route.model)
        base_url = _payload_text(payload, "base_url", default_route.base_url)
        api_key_env = _payload_text(payload, "api_key_env", _api_key_env_for_provider(provider, default_route.api_key_env))
        if not provider or not model or not base_url or not api_key_env:
            raise HTTPException(status_code=400, detail="模型、接口地址和密钥名称不能为空。")
        _validate_provider(provider)
        _validate_base_url(base_url)
        _validate_api_key_env(api_key_env)
        max_tokens = _payload_positive_int(payload, "max_tokens", default_route.max_tokens, "输出上限必须是正整数。")

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

    def profiles(self, roles: list[str] | None = None) -> dict[str, ModelProfile]:
        raw = self._read_config()
        parsed = self._stored_profiles(raw)
        router = ModelRouter(use_runtime_overrides=False)
        for role in roles or []:
            try:
                route = router.route(role)
            except Exception:
                continue
            profile = self._profile_from_route(route, built_in=True)
            parsed.setdefault(profile.id, profile)
        for route in self.routes().values():
            profile = self._profile_from_override(route, built_in=False)
            parsed.setdefault(profile.id, profile)
        return parsed

    def profile_by_id(self, profile_id: str | None) -> ModelProfile | None:
        if not profile_id:
            return None
        profiles = self.profiles(ALL_MODEL_ROLES)
        return profiles.get(profile_id)

    def role_assignments(self) -> dict[str, str]:
        raw = self._read_config()
        assignments = raw.get("role_assignments", {})
        if not isinstance(assignments, dict):
            return {}
        return {str(role): str(profile_id) for role, profile_id in assignments.items() if isinstance(profile_id, str)}

    def save_profile(self, payload: dict[str, Any], profile_id: str | None = None) -> ModelProfile:
        raw = self._read_config()
        profiles = self._stored_profiles(raw)
        existing = profiles.get(profile_id or "")
        base = existing or self._profile_from_route(ModelRouter(use_runtime_overrides=False).route("writer"), built_in=False)

        name = _payload_text(payload, "name", base.name)
        provider = _payload_text(payload, "provider", base.provider)
        model = _payload_text(payload, "model", base.model)
        base_url = _payload_text(payload, "base_url", base.base_url)
        api_key_env = _payload_text(payload, "api_key_env", _api_key_env_for_provider(provider, base.api_key_env))
        if not name:
            raise HTTPException(status_code=400, detail="模型档案名称不能为空。")
        if not provider or not model or not base_url or not api_key_env:
            raise HTTPException(status_code=400, detail="模型、接口地址和密钥名称不能为空。")
        _validate_provider(provider)
        _validate_base_url(base_url)
        _validate_api_key_env(api_key_env)
        max_tokens = _payload_positive_int(payload, "max_tokens", base.max_tokens, "输出上限必须是正整数。")

        next_id = profile_id or _unique_profile_id(_slugify(name), profiles)
        if profile_id and profile_id not in profiles:
            raise HTTPException(status_code=404, detail="模型档案不存在。")
        profile = ModelProfile(
            id=next_id,
            name=name,
            provider=provider,
            model=model,
            base_url=base_url,
            api_key_env=api_key_env,
            max_tokens=max_tokens,
            cheap=bool(payload.get("cheap", base.cheap)),
            supports_json=bool(payload.get("supports_json", base.supports_json)),
            built_in=False,
        )
        profiles[next_id] = profile
        raw["profiles"] = {key: _profile_payload(value, include_runtime=False) for key, value in profiles.items() if not value.built_in}
        self._write_config(raw)
        return profile

    def delete_profile(self, profile_id: str) -> None:
        raw = self._read_config()
        profiles = self._stored_profiles(raw)
        if profile_id not in profiles:
            raise HTTPException(status_code=404, detail="模型档案不存在。")
        assignments = self.role_assignments()
        used_by = [role_label(role) for role, assigned in assignments.items() if assigned == profile_id]
        if used_by:
            raise HTTPException(status_code=400, detail=f"模型档案正在被角色使用：{'、'.join(used_by)}。")
        profiles.pop(profile_id)
        raw["profiles"] = {key: _profile_payload(value, include_runtime=False) for key, value in profiles.items() if not value.built_in}
        self._write_config(raw)

    def assign_profile(self, role: str, profile_id: str) -> ModelRoute:
        if role not in ALL_MODEL_ROLES:
            raise HTTPException(status_code=400, detail="不支持的模型角色。")
        profile = self.profile_by_id(profile_id)
        if profile is None:
            raise HTTPException(status_code=404, detail="模型档案不存在。")
        raw = self._read_config()
        assignments = self.role_assignments()
        assignments[role] = profile_id
        raw["role_assignments"] = assignments
        self._write_config(raw)
        return ModelRoute(
            role=role,
            provider=profile.provider,
            model=profile.model,
            base_url=profile.base_url,
            api_key_env=profile.api_key_env,
            max_tokens=profile.max_tokens,
            cheap=profile.cheap,
            supports_json=profile.supports_json,
        )

    def config_payload(self, roles: list[str]) -> dict[str, Any]:
        router = ModelRouter(use_runtime_overrides=False)
        overrides = self.routes()
        profiles = self.profiles(roles)
        assignments = self.role_assignments()
        items = []
        for role in roles:
            try:
                default_route = router.route(role)
                active = self.route_for_role(role) or default_route
                override = overrides.get(role)
                assigned_profile = profiles.get(assignments.get(role, ""))
                override_profile = self._profile_from_override(override, built_in=False) if override is not None else None
                active_profile = assigned_profile or override_profile or self._profile_from_route(default_route, built_in=True)
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
                        "overridden": override is not None or assigned_profile is not None,
                        "profile_id": active_profile.id,
                        "profile_name": active_profile.name,
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
        return {
            "profiles": [
                {
                    **_profile_payload(profile, include_runtime=True),
                    "provider_label": provider_label(profile.provider),
                    "secret": self.secret_status(
                        ModelRoute(
                            role="profile",
                            provider=profile.provider,
                            model=profile.model,
                            base_url=profile.base_url,
                            api_key_env=profile.api_key_env,
                            max_tokens=profile.max_tokens,
                            cheap=profile.cheap,
                            supports_json=profile.supports_json,
                        )
                    ),
                }
                for profile in sorted(profiles.values(), key=lambda item: (item.built_in, item.name, item.id))
            ],
            "roles": items,
            "secret_store": self.secret_store_status(),
        }

    def _stored_profiles(self, raw: dict[str, Any]) -> dict[str, ModelProfile]:
        values = raw.get("profiles", {})
        if not isinstance(values, dict):
            return {}
        parsed: dict[str, ModelProfile] = {}
        for profile_id, value in values.items():
            if not isinstance(value, dict):
                continue
            try:
                parsed[str(profile_id)] = ModelProfile(
                    id=str(profile_id),
                    name=str(value["name"]),
                    provider=str(value["provider"]),
                    model=str(value["model"]),
                    base_url=str(value["base_url"]),
                    api_key_env=str(value["api_key_env"]),
                    max_tokens=int(value["max_tokens"]),
                    cheap=bool(value.get("cheap", False)),
                    supports_json=bool(value.get("supports_json", False)),
                    built_in=False,
                )
            except (KeyError, TypeError, ValueError):
                continue
        return parsed

    def _profile_from_route(self, route: ModelRoute, *, built_in: bool) -> ModelProfile:
        profile_id = _profile_id_for_route(route)
        return ModelProfile(
            id=profile_id,
            name=f"{provider_label(route.provider)} / {route.model}",
            provider=route.provider,
            model=route.model,
            base_url=route.base_url,
            api_key_env=route.api_key_env,
            max_tokens=route.max_tokens,
            cheap=route.cheap,
            supports_json=route.supports_json,
            built_in=built_in,
        )

    def _profile_from_override(self, route: ModelRouteOverride, *, built_in: bool) -> ModelProfile:
        return ModelProfile(
            id=_profile_id_for_values(route.provider, route.model, route.base_url, route.api_key_env, route.max_tokens),
            name=f"{provider_label(route.provider)} / {route.model}",
            provider=route.provider,
            model=route.model,
            base_url=route.base_url,
            api_key_env=route.api_key_env,
            max_tokens=route.max_tokens,
            cheap=route.cheap,
            supports_json=route.supports_json,
            built_in=built_in,
        )

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
        "agnes": "Agnes AI",
        "kimi": "Moonshot / Kimi",
        "deepseek": "DeepSeek",
        "qwen": "通义千问",
        "glm": "智谱 GLM",
    }.get(provider, provider)


def _profile_payload(profile: ModelProfile, *, include_runtime: bool) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": profile.id,
        "name": profile.name,
        "provider": profile.provider,
        "model": profile.model,
        "base_url": profile.base_url,
        "api_key_env": profile.api_key_env,
        "max_tokens": profile.max_tokens,
        "cheap": profile.cheap,
        "supports_json": profile.supports_json,
    }
    if include_runtime:
        payload["built_in"] = profile.built_in
    return payload


def _profile_id_for_route(route: ModelRoute) -> str:
    return _profile_id_for_values(route.provider, route.model, route.base_url, route.api_key_env, route.max_tokens)


def _profile_id_for_values(provider: str, model: str, base_url: str, api_key_env: str, max_tokens: int) -> str:
    digest = hashlib.sha1(f"{provider}|{model}|{base_url}|{api_key_env}|{max_tokens}".encode("utf-8")).hexdigest()[:10]
    return f"{_slugify(provider)}-{_slugify(model)}-{digest}"


def _slugify(value: str) -> str:
    slug = "".join(char.lower() if char.isascii() and char.isalnum() else "-" for char in value.strip())
    slug = "-".join(part for part in slug.split("-") if part)
    return slug[:48] or "model"


def _unique_profile_id(base: str, profiles: dict[str, ModelProfile]) -> str:
    candidate = base
    index = 2
    while candidate in profiles:
        candidate = f"{base}-{index}"
        index += 1
    return candidate


def _api_key_env_for_provider(provider: str, fallback: str) -> str:
    try:
        return provider_config_api_key_env(provider)
    except ModelRegistryError:
        return fallback


def _payload_text(payload: dict[str, Any], key: str, fallback: str) -> str:
    value = payload[key] if key in payload and payload[key] is not None else fallback
    return str(value).strip()


def _payload_positive_int(payload: dict[str, Any], key: str, fallback: int, error_message: str) -> int:
    value = payload[key] if key in payload and payload[key] is not None else fallback
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=error_message) from exc
    if parsed <= 0:
        raise HTTPException(status_code=400, detail=error_message)
    return parsed


def _validate_provider(provider: str) -> None:
    if not provider.replace("_", "").replace("-", "").isalnum():
        raise HTTPException(status_code=400, detail="供应商名称只能包含字母、数字、横线或下划线。")


def _validate_base_url(base_url: str) -> None:
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="接口地址必须是有效的 http 或 https 地址。")


def _validate_api_key_env(api_key_env: str) -> None:
    if not api_key_env.replace("_", "").isalnum() or not api_key_env[0].isalpha():
        raise HTTPException(status_code=400, detail="密钥名称必须是环境变量格式，例如 KIMI_API_KEY。")


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
