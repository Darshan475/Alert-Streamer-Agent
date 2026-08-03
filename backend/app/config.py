from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

LLMProvider = Literal["openrouter", "groq", "huggingface", "nvidia", "offline"]

# Free-tier defaults for local testing (swap to nvidia later for production)
PROVIDER_DEFAULTS: dict[LLMProvider, dict[str, str]] = {
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "model": "meta-llama/llama-3.3-70b-instruct:free",
    },
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "model": "llama-3.3-70b-versatile",
    },
    "huggingface": {
        "base_url": "https://router.huggingface.co/v1",
        "model": "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4:fastest",
    },
    "nvidia": {
        "base_url": "https://integrate.api.nvidia.com/v1",
        "model": "nvidia/nemotron-3-super-120b-a12b",
    },
    "offline": {
        "base_url": "",
        "model": "offline-fallback",
    },
}

PLACEHOLDER_KEYS = frozenset({"your_api_key_here", "your_nvidia_api_key_here", "your_hf_token_here", ""})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # LLM — default to free OpenRouter for testing; set LLM_PROVIDER=nvidia later
    llm_provider: LLMProvider = "openrouter"
    llm_api_key: str = ""
    llm_base_url: str = ""
    llm_model: str = ""
    hf_token: str = ""  # HF_TOKEN — alternative to LLM_API_KEY for Hugging Face

    # Legacy NVIDIA vars (still supported when llm_provider=nvidia)
    nvidia_api_key: str = ""
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    nvidia_model: str = "nvidia/nemotron-3-super-120b-a12b"

    alert_streamer_api_key: str = "dev-secret-change-in-production"
    jwt_secret: str = "change-me-to-a-long-random-string"

    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: str = "http://localhost:3000"

    redis_url: str = ""
    database_url: str = "sqlite+aiosqlite:///./alert_streamer.db"

    dedup_ttl_seconds: int = 3600
    llm_max_tokens: int = 4096
    llm_temperature: float = 0.3

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def active_llm_base_url(self) -> str:
        if self.llm_base_url:
            return self.llm_base_url.rstrip("/")
        return PROVIDER_DEFAULTS[self.llm_provider]["base_url"].rstrip("/")

    @property
    def active_llm_model(self) -> str:
        if self.llm_model:
            return self.llm_model
        if self.llm_provider == "nvidia" and self.nvidia_model:
            return self.nvidia_model
        return PROVIDER_DEFAULTS[self.llm_provider]["model"]

    @property
    def active_llm_api_key(self) -> str:
        if self.llm_api_key and self.llm_api_key not in PLACEHOLDER_KEYS:
            return self.llm_api_key
        if self.llm_provider == "huggingface" and self.hf_token and self.hf_token not in PLACEHOLDER_KEYS:
            return self.hf_token
        if self.llm_provider == "nvidia" and self.nvidia_api_key and self.nvidia_api_key not in PLACEHOLDER_KEYS:
            return self.nvidia_api_key
        return ""

    @property
    def llm_is_live(self) -> bool:
        if self.llm_provider == "offline":
            return False
        return bool(self.active_llm_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
