"""Multi-provider LLM client for agent pipeline and generator."""

import logging
import re
from typing import Any

import httpx

from app.config import LLMProvider, Settings

logger = logging.getLogger(__name__)


class LLMError(RuntimeError):
    """Raised when the LLM provider is unavailable or returns an error."""


class LLMClient:
    """OpenAI-compatible client for OpenRouter, Groq, Hugging Face, and NVIDIA NIM."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._provider_override: LLMProvider | None = None
        self._model_override: str | None = None

    @property
    def provider(self) -> LLMProvider:
        return self._provider_override or self._settings.llm_provider

    def set_provider(self, provider: LLMProvider) -> None:
        self._provider_override = provider
        logger.info(
            "LLM provider switched to %s (configured=%s, model=%s)",
            provider,
            self.is_configured,
            self.model,
        )

    def set_model(self, model: str) -> None:
        self._model_override = model
        logger.info("LLM model switched to %s", model)

    def model_for(self, provider: LLMProvider | None = None) -> str:
        return self._settings.model_for(provider or self.provider)

    def is_configured_for(self, provider: LLMProvider) -> bool:
        if provider == "offline":
            return True
        return self._settings.is_live_for(provider)

    @property
    def model(self) -> str:
        if self._model_override:
            return self._model_override
        return self.model_for()

    @property
    def is_configured(self) -> bool:
        if self.provider == "offline":
            return False
        return self._settings.is_live_for(self.provider)

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
        json_mode: bool = False,
    ) -> str:
        if self.provider == "offline" or not self.is_configured:
            raise LLMError(f"LLM not configured. {self._key_hint()}")

        headers: dict[str, str] = {
            "Authorization": f"Bearer {self._settings.api_key_for(self.provider)}",
            "Content-Type": "application/json",
        }
        if self.provider == "openrouter":
            headers["HTTP-Referer"] = self._settings.openrouter_site_url
            headers["X-Title"] = self._settings.openrouter_app_name

        body: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature if temperature is not None else self._settings.llm_temperature,
            "max_tokens": max_tokens or self._settings.llm_max_tokens,
            "stream": False,
        }

        if json_mode:
            body["response_format"] = {"type": "json_object"}

        if self.provider == "nvidia":
            body["extra_body"] = {"chat_template_kwargs": {"enable_thinking": False}}

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(
                    f"{self._settings.base_url_for(self.provider)}/chat/completions",
                    headers=headers,
                    json=body,
                )
                response.raise_for_status()
                data = response.json()
            content = data["choices"][0]["message"]["content"]
            return self._strip_thinking_tags(content)
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:300]
            logger.error("LLM HTTP error [%s]: %s", self.provider, detail)
            raise LLMError(self._format_http_error(exc, detail)) from exc
        except LLMError:
            raise
        except Exception as exc:
            logger.exception("LLM request failed [%s]", self.provider)
            raise LLMError(f"LLM request failed ({self.provider}): {exc}") from exc

    def _strip_thinking_tags(self, text: str) -> str:
        """Remove reasoning/thinking blocks from model output."""
        tag = "redacted_reasoning"
        patterns = [
            rf"<{tag}>.*?</{tag}>",
            r"<thinking>.*?</thinking>",
        ]
        cleaned = text
        for pattern in patterns:
            cleaned = re.sub(pattern, "", cleaned, flags=re.DOTALL | re.IGNORECASE)
        return cleaned.strip()

    def _format_http_error(self, exc: httpx.HTTPStatusError, detail: str) -> str:
        code = exc.response.status_code
        if code == 429:
            return (
                "Provider rate limit exceeded (HTTP 429). "
                "Switch provider in the dashboard or add a key for OpenRouter/Groq."
            )
        if code == 402:
            return (
                "OpenRouter credits exhausted (HTTP 402). Add credits at openrouter.ai/settings/credits "
                "or switch to Gemini/Groq in the LLM dropdown."
            )
        if self.provider == "gemini" and code in (401, 403):
            return (
                f"HTTP {code}: Invalid Gemini API key. "
                "Set GEMINI_API_KEY in backend/.env from aistudio.google.com/apikey"
            )
        if self.provider == "huggingface" and code in (401, 403):
            if "sufficient permissions" in detail.lower() or "inference providers" in detail.lower():
                return (
                    f"HTTP {code}: HF token lacks 'Make calls to Inference Providers' permission. "
                    "Create a fine-grained token at huggingface.co/settings/tokens with that permission enabled."
                )
            return (
                f"HTTP {code}: Invalid or expired HF token. "
                "Create a fine-grained token with 'Make calls to Inference Providers' at huggingface.co/settings/tokens"
            )
        if self.provider == "openrouter" and code == 404:
            return (
                f"HTTP 404: Model '{self.model}' not found on OpenRouter. "
                "Set LLM_MODEL=openai/gpt-4o-mini or openai/gpt-4o in backend env."
            )
        return str(exc)

    def _key_hint(self) -> str:
        if self.provider == "gemini":
            return "Set GEMINI_API_KEY in backend/.env (aistudio.google.com/apikey)."
        return (
            f"Set LLM_API_KEY in backend/.env (provider: {self.provider}). "
            "Free keys: aistudio.google.com/apikey, openrouter.ai, or console.groq.com"
        )
