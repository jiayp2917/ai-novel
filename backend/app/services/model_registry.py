from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


DEFAULT_REGISTRY_PATH = Path("config/model_registry.yaml")


@dataclass(frozen=True)
class ModelSpec:
    provider: str
    model: str
    base_url: str
    api_key_env: str
    roles: tuple[str, ...]
    enabled: bool
    cheap: bool
    supports_json: bool
    default_max_tokens: int
    low_cost_max_tokens: int | None = None

    def supports_role(self, role: str) -> bool:
        return role in self.roles or "*" in self.roles


class ModelRegistryError(ValueError):
    pass


class ModelRegistry:
    def __init__(self, path: Path | str = DEFAULT_REGISTRY_PATH) -> None:
        self.path = Path(path)
        self._models = self._load_models()

    def enabled_models_for_role(self, role: str, provider: str | None = None) -> list[ModelSpec]:
        models = [model for model in self._models if model.enabled and model.supports_role(role)]
        if provider:
            models = [model for model in models if model.provider == provider]
        return models

    def _load_models(self) -> list[ModelSpec]:
        if not self.path.exists():
            raise ModelRegistryError(f"Model registry not found: {self.path}")

        with self.path.open("r", encoding="utf-8") as file:
            raw = yaml.safe_load(file) or {}

        providers = raw.get("providers")
        if not isinstance(providers, dict):
            raise ModelRegistryError("Model registry must contain a providers mapping")

        models: list[ModelSpec] = []
        for provider_name, provider_config in providers.items():
            if not isinstance(provider_config, dict):
                raise ModelRegistryError(f"Provider {provider_name!r} must be a mapping")
            provider_enabled = bool(provider_config.get("enabled", True))
            provider_base_url = provider_config.get("base_url")
            provider_api_key_env = provider_config.get("api_key_env")
            provider_models = provider_config.get("models", [])
            if not isinstance(provider_models, list):
                raise ModelRegistryError(f"Provider {provider_name!r} models must be a list")
            for model_config in provider_models:
                models.append(
                    self._parse_model(
                        str(provider_name),
                        provider_enabled,
                        model_config,
                        provider_base_url=provider_base_url,
                        provider_api_key_env=provider_api_key_env,
                    )
                )
        return models

    def _parse_model(
        self,
        provider: str,
        provider_enabled: bool,
        model_config: Any,
        *,
        provider_base_url: str | None = None,
        provider_api_key_env: str | None = None,
    ) -> ModelSpec:
        if not isinstance(model_config, dict):
            raise ModelRegistryError(f"Model entry for provider {provider!r} must be a mapping")

        model_id = model_config.get("id")
        if not model_id:
            raise ModelRegistryError(f"Model entry for provider {provider!r} is missing id")

        roles = model_config.get("roles", [])
        if isinstance(roles, str):
            roles = [roles]
        if not isinstance(roles, list) or not roles:
            raise ModelRegistryError(f"Model {model_id!r} must define one or more roles")

        base_url = model_config.get("base_url") or provider_base_url or provider_config_base_url(provider)
        api_key_env = model_config.get("api_key_env") or provider_api_key_env or provider_config_api_key_env(provider)
        default_max_tokens = int(model_config.get("default_max_tokens", model_config.get("max_tokens", 0)))
        if default_max_tokens <= 0:
            raise ModelRegistryError(f"Model {model_id!r} must define a positive default_max_tokens")

        low_cost_max_tokens = model_config.get("low_cost_max_tokens")
        return ModelSpec(
            provider=provider,
            model=str(model_id),
            base_url=str(base_url),
            api_key_env=str(api_key_env),
            roles=tuple(str(role) for role in roles),
            enabled=provider_enabled and bool(model_config.get("enabled", True)),
            cheap=bool(model_config.get("cheap", False)),
            supports_json=bool(model_config.get("supports_json", False)),
            default_max_tokens=default_max_tokens,
            low_cost_max_tokens=int(low_cost_max_tokens) if low_cost_max_tokens is not None else None,
        )


def provider_config_base_url(provider: str) -> str:
    defaults = {
        "agnes": "https://apihub.agnes-ai.com/v1",
        "deepseek": "https://api.deepseek.com",
        "kimi": "https://api.moonshot.cn/v1",
        "qwen": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "glm": "https://open.bigmodel.cn/api/paas/v4",
    }
    if provider not in defaults:
        raise ModelRegistryError(f"Provider {provider!r} must define base_url")
    return defaults[provider]


def provider_config_api_key_env(provider: str) -> str:
    defaults = {
        "agnes": "AGNES_API_KEY",
        "deepseek": "DEEPSEEK_API_KEY",
        "kimi": "KIMI_API_KEY",
        "qwen": "QWEN_API_KEY",
        "glm": "GLM_API_KEY",
    }
    if provider not in defaults:
        raise ModelRegistryError(f"Provider {provider!r} must define api_key_env")
    return defaults[provider]
