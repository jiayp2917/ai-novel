from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_db_path: Path = Field(default=Path("runtime/app.db"), alias="APP_DB_PATH")
    content_root: Path = Field(default=Path("content"), alias="CONTENT_ROOT")
    runtime_root: Path = Field(default=Path("runtime"), alias="RUNTIME_ROOT")
    app_runtime_root: Path | None = Field(default=None, alias="APP_RUNTIME_ROOT")
    workspace_runtime_root_override: Path | None = Field(default=None, alias="WORKSPACE_RUNTIME_ROOT_OVERRIDE")
    low_cost_mode: bool = Field(default=False, alias="LOW_COST_MODE")
    enable_model_concurrency: bool = Field(default=False, alias="ENABLE_MODEL_CONCURRENCY")
    model_max_concurrency: int = Field(default=2, alias="MODEL_MAX_CONCURRENCY")
    writer_max_concurrency: int = Field(default=2, alias="WRITER_MAX_CONCURRENCY")
    reviewer_max_concurrency: int = Field(default=1, alias="REVIEWER_MAX_CONCURRENCY")
    memory_max_concurrency: int = Field(default=1, alias="MEMORY_MAX_CONCURRENCY")
    provider_max_concurrency: int = Field(default=2, alias="PROVIDER_MAX_CONCURRENCY")
    model_timeout_seconds: int = Field(default=300, alias="MODEL_TIMEOUT_SECONDS")
    daily_max_model_calls: int = Field(default=200, alias="DAILY_MAX_MODEL_CALLS")
    daily_max_estimated_cost: float = Field(default=20.0, alias="DAILY_MAX_ESTIMATED_COST")
    max_input_chars_per_call: int = Field(default=60000, alias="MAX_INPUT_CHARS_PER_CALL")
    max_output_tokens_per_call: int = Field(default=12000, alias="MAX_OUTPUT_TOKENS_PER_CALL")
    default_model_provider: str = Field(default="agnes", alias="DEFAULT_MODEL_PROVIDER")
    enable_test_support: bool = Field(default=False, alias="ENABLE_TEST_SUPPORT")
    allow_pipeline_direct_publish: bool = Field(default=False, alias="ALLOW_PIPELINE_DIRECT_PUBLISH")
    kimi_thinking_mode: str = Field(default="disabled", alias="KIMI_THINKING_MODE")
    glm_thinking_mode: str = Field(default="disabled", alias="GLM_THINKING_MODE")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
