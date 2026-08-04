from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

LLMProvider = Literal["gemini", "openrouter", "groq", "huggingface", "nvidia", "offline"]

# Provider defaults — Gemini is the default (Google AI Studio free tier)
PROVIDER_DEFAULTS: dict[LLMProvider, dict[str, str]] = {
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "model": "gemini-2.0-flash",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "model": "openai/gpt-4o-mini",
    },
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "model": "llama-3.3-70b-versatile",
    },
    "huggingface": {
        "base_url": "https://router.huggingface.co/v1",
        "model": "meta-llama/Meta-Llama-3-8B-Instruct:fastest",
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

PLACEHOLDER_KEYS = frozenset(
    {
        "your_api_key_here",
        "your_nvidia_api_key_here",
        "your_hf_token_here",
        "your_gemini_api_key_here",
        "your_google_api_key_here",
        "",
    }
)

DEFAULT_LLM_PROVIDER: LLMProvider = "gemini"

LLM_PROVIDER_META: dict[LLMProvider, dict[str, str | bool]] = {
    "gemini": {
        "label": "Google Gemini",
        "free": True,
        "key_hint": "GEMINI_API_KEY from aistudio.google.com/apikey",
        "signup_url": "https://aistudio.google.com/apikey",
    },
    "openrouter": {
        "label": "OpenRouter",
        "free": True,
        "key_hint": "LLM_API_KEY from openrouter.ai/keys",
        "signup_url": "https://openrouter.ai/keys",
    },
    "groq": {
        "label": "Groq",
        "free": True,
        "key_hint": "LLM_API_KEY from console.groq.com",
        "signup_url": "https://console.groq.com/keys",
    },
    "huggingface": {
        "label": "Hugging Face",
        "free": True,
        "key_hint": "Fine-grained HF token with 'Make calls to Inference Providers'",
        "signup_url": "https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained",
    },
    "nvidia": {
        "label": "NVIDIA NIM",
        "free": False,
        "key_hint": "LLM_API_KEY or NVIDIA_API_KEY from build.nvidia.com",
        "signup_url": "https://build.nvidia.com",
    },
    "offline": {
        "label": "Offline (rule-based)",
        "free": True,
        "key_hint": "No API key required",
        "signup_url": "",
    },
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # LLM — default Google Gemini; override via dashboard or LLM_PROVIDER env
    llm_provider: LLMProvider = DEFAULT_LLM_PROVIDER
    llm_api_key: str = ""
    llm_base_url: str = ""
    llm_model: str = ""
    gemini_api_key: str = ""
    google_api_key: str = ""  # alias for GEMINI_API_KEY
    hf_token: str = ""  # HF_TOKEN — alternative to LLM_API_KEY for Hugging Face

    # Legacy NVIDIA vars (still supported when llm_provider=nvidia)
    nvidia_api_key: str = ""
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    nvidia_model: str = "nvidia/nemotron-3-super-120b-a12b"

    alert_streamer_api_key: str = "dev-secret-change-in-production"
    jwt_secret: str = "change-me-to-a-long-random-string"

    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: str = "http://localhost:8000,http://localhost:3000"

    redis_url: str = ""
    database_url: str = "sqlite+aiosqlite:///./alert_streamer.db"

    dedup_ttl_seconds: int = 3600
    llm_max_tokens: int = 4096
    llm_temperature: float = 0.3
    seed_demo_alerts: bool = True
    openrouter_site_url: str = "https://alert-streamer-frontend.vercel.app"
    openrouter_app_name: str = "Alert Streamer"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    def base_url_for(self, provider: LLMProvider | None = None) -> str:
        active = provider or self.llm_provider
        if self.llm_base_url and (provider is None or provider == self.llm_provider):
            return self.llm_base_url.rstrip("/")
        return PROVIDER_DEFAULTS[active]["base_url"].rstrip("/")

    def model_for(self, provider: LLMProvider | None = None) -> str:
        active = provider or self.llm_provider
        if self.llm_model and (provider is None or provider == self.llm_provider):
            return self.llm_model
        if active == "nvidia" and self.nvidia_model:
            return self.nvidia_model
        return PROVIDER_DEFAULTS[active]["model"]

    def api_key_for(self, provider: LLMProvider | None = None) -> str:
        active = provider or self.llm_provider
        if active == "gemini":
            for key in (self.gemini_api_key, self.google_api_key, self.llm_api_key):
                if key and key not in PLACEHOLDER_KEYS:
                    return key
            return ""
        if self.llm_api_key and self.llm_api_key not in PLACEHOLDER_KEYS:
            return self.llm_api_key
        if active == "huggingface" and self.hf_token and self.hf_token not in PLACEHOLDER_KEYS:
            return self.hf_token
        if active == "nvidia" and self.nvidia_api_key and self.nvidia_api_key not in PLACEHOLDER_KEYS:
            return self.nvidia_api_key
        return ""

    def is_live_for(self, provider: LLMProvider | None = None) -> bool:
        active = provider or self.llm_provider
        if active == "offline":
            return False
        return bool(self.api_key_for(active))

    @property
    def active_llm_base_url(self) -> str:
        return self.base_url_for()

    @property
    def active_llm_model(self) -> str:
        return self.model_for()

    @property
    def active_llm_api_key(self) -> str:
        return self.api_key_for()

    @property
    def llm_is_live(self) -> bool:
        return self.is_live_for()


@lru_cache
def get_settings() -> Settings:
    return Settings()
