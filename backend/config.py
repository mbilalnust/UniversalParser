from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


load_dotenv()


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class LLMConfig:
    provider: str
    base_url: str
    api_key: str | None
    model: str | None
    temperature: float
    max_output_tokens: int
    max_input_chars: int
    enabled: bool


@dataclass(frozen=True)
class Settings:
    allowed_origins: list[str]
    llm: LLMConfig


def get_settings() -> Settings:
    origins = os.getenv("UP_ALLOWED_ORIGINS", "*")
    allowed_origins = [origin.strip() for origin in origins.split(",") if origin.strip()]

    llm = LLMConfig(
        provider=os.getenv("UP_LLM_PROVIDER", "openai_compatible"),
        base_url=os.getenv("UP_LLM_BASE_URL", "http://localhost:8001"),
        api_key=os.getenv("UP_LLM_API_KEY"),
        model=os.getenv("UP_LLM_MODEL"),
        temperature=float(os.getenv("UP_LLM_TEMPERATURE", "0.2")),
        max_output_tokens=int(os.getenv("UP_LLM_MAX_OUTPUT_TOKENS", "1200")),
        max_input_chars=int(os.getenv("UP_LLM_MAX_INPUT_CHARS", "12000")),
        enabled=_env_bool("UP_LLM_ENABLED", False),
    )

    return Settings(allowed_origins=allowed_origins, llm=llm)


def apply_llm_overrides(base: LLMConfig, overrides: dict[str, object]) -> LLMConfig:
    return LLMConfig(
        provider=str(overrides.get("provider") or base.provider),
        base_url=str(overrides.get("base_url") or base.base_url),
        api_key=(overrides.get("api_key") or base.api_key),
        model=(overrides.get("model") or base.model),
        temperature=float(overrides.get("temperature") or base.temperature),
        max_output_tokens=int(overrides.get("max_output_tokens") or base.max_output_tokens),
        max_input_chars=base.max_input_chars,
        enabled=base.enabled,
    )
