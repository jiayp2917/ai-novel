import os
from dataclasses import dataclass
from pathlib import Path

from backend.app.core.config import Settings, get_settings
from backend.app.services.model_registry import DEFAULT_REGISTRY_PATH, ModelRegistry, ModelSpec


@dataclass(frozen=True)
class ModelRoute:
    role: str
    provider: str
    model: str
    base_url: str
    api_key_env: str
    max_tokens: int
    cheap: bool
    supports_json: bool


class ModelRouteNotFoundError(LookupError):
    pass


ROLE_PROVIDER_PRIORITY: dict[str, tuple[str, ...]] = {
    "reviewer": ("agnes", "deepseek", "qwen", "glm"),
    "writer": ("agnes", "kimi", "glm", "qwen"),
    "fixer": ("agnes", "kimi", "glm", "deepseek"),
    "quick_fix": ("agnes", "kimi", "deepseek", "glm"),
    "long_context": ("agnes", "qwen", "deepseek", "glm"),
    "memory": ("agnes", "qwen", "deepseek", "glm"),
    "outliner": ("agnes", "qwen", "glm"),
    "structural_fix": ("agnes", "glm", "qwen", "kimi"),
    # Arbiter is decision support only. It must not be wired to publish or source-write flows.
    "arbiter": ("agnes", "qwen", "deepseek", "glm"),
}


class ModelRouter:
    def __init__(
        self,
        registry: ModelRegistry | None = None,
        settings: Settings | None = None,
        registry_path: Path | str = DEFAULT_REGISTRY_PATH,
        use_runtime_overrides: bool = True,
    ) -> None:
        self.settings = settings or get_settings()
        self.registry = registry or ModelRegistry(registry_path)
        self.use_runtime_overrides = use_runtime_overrides

    def route(self, role: str) -> ModelRoute:
        if self.use_runtime_overrides:
            from backend.app.services.model_config import ModelConfigService

            override = ModelConfigService().route_for_role(role)
            if override is not None:
                return override

        candidates = self._candidates_for_role(role)
        if not candidates:
            raise ModelRouteNotFoundError(f"No enabled model found for role: {role}")

        selected = self._select_candidate(role, candidates)
        return ModelRoute(
            role=role,
            provider=selected.provider,
            model=selected.model,
            base_url=selected.base_url,
            api_key_env=selected.api_key_env,
            max_tokens=self._max_tokens_for(selected),
            cheap=selected.cheap,
            supports_json=selected.supports_json,
        )

    def _candidates_for_role(self, role: str) -> list[ModelSpec]:
        candidates = self.registry.enabled_models_for_role(role)
        provider_override = os.getenv(f"{role.upper()}_PROVIDER", "").strip()
        model_override = os.getenv(f"{role.upper()}_MODEL", "").strip()
        if provider_override:
            candidates = [candidate for candidate in candidates if candidate.provider == provider_override]
        if model_override:
            candidates = [candidate for candidate in candidates if candidate.model == model_override]
        return candidates

    def _select_candidate(self, role: str, candidates: list[ModelSpec]) -> ModelSpec:
        indexed = list(enumerate(candidates))

        def priority(item: tuple[int, ModelSpec]) -> tuple[int, int]:
            index, model = item
            providers = ROLE_PROVIDER_PRIORITY.get(role, ())
            provider_rank = providers.index(model.provider) if model.provider in providers else len(providers)
            return provider_rank, index

        if self.settings.low_cost_mode:
            return sorted(indexed, key=lambda item: (not item[1].cheap, *priority(item), item[1].default_max_tokens))[0][1]
        return sorted(indexed, key=priority)[0][1]

    def _max_tokens_for(self, model: ModelSpec) -> int:
        max_tokens = min(model.default_max_tokens, self.settings.max_output_tokens_per_call)
        if self.settings.low_cost_mode:
            low_cost_limit = model.low_cost_max_tokens or max(1, max_tokens // 2)
            return min(max_tokens, low_cost_limit)
        return max_tokens
