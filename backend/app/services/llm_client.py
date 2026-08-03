"""Multi-provider LLM client — free OpenRouter/Groq for testing, NVIDIA for production."""

import json
import logging
import re
from typing import Any

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

PLACEHOLDER_KEYS = {"your_api_key_here", "your_nvidia_api_key_here", ""}


class LLMClient:
    """OpenAI-compatible client for OpenRouter, Groq, and NVIDIA NIM."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    @property
    def provider(self) -> str:
        return self._settings.llm_provider

    @property
    def model(self) -> str:
        return self._settings.active_llm_model

    @property
    def is_configured(self) -> bool:
        return self._settings.llm_is_live

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
        json_mode: bool = False,
    ) -> str:
        if not self.is_configured:
            return self._fallback_response(messages)

        headers: dict[str, str] = {
            "Authorization": f"Bearer {self._settings.active_llm_api_key}",
            "Content-Type": "application/json",
        }
        if self.provider == "openrouter":
            headers["HTTP-Referer"] = "http://localhost:8000"
            headers["X-Title"] = "Alert Streamer"

        body: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature if temperature is not None else self._settings.llm_temperature,
            "max_tokens": max_tokens or self._settings.llm_max_tokens,
            "stream": False,
        }

        if json_mode:
            body["response_format"] = {"type": "json_object"}

        # Nemotron-specific thinking toggle (ignored by other providers)
        if self.provider == "nvidia":
            body["extra_body"] = {"chat_template_kwargs": {"enable_thinking": False}}

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(
                    f"{self._settings.active_llm_base_url}/chat/completions",
                    headers=headers,
                    json=body,
                )
                response.raise_for_status()
                data = response.json()
            content = data["choices"][0]["message"]["content"]
            return self._strip_thinking_tags(content)
        except httpx.HTTPStatusError as exc:
            logger.error("LLM HTTP error [%s]: %s", self.provider, exc.response.text[:300])
            return self._fallback_response(messages, error=str(exc))
        except Exception as exc:
            logger.exception("LLM request failed [%s]", self.provider)
            return self._fallback_response(messages, error=str(exc))

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

    def _fallback_response(self, messages: list[dict[str, str]], error: str | None = None) -> str:
        """Rule-based fallback when no API key or provider call fails."""
        user_msg = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")

        if "investigate" in user_msg.lower() or "root cause" in user_msg.lower() or json_mode_hint(user_msg):
            return json.dumps(
                {
                    "root_cause": "Simulated: Resource exhaustion or dependency failure (offline fallback)",
                    "impact_assessment": "Service degradation possible; verify metrics and recent deployments.",
                    "recommendations": [
                        "Check recent deployments and rollback if needed",
                        "Inspect pod logs and resource utilization",
                        "Verify upstream dependencies and connection pools",
                        "Scale replicas if sustained load spike detected",
                    ],
                    "urgency_score": 7,
                    "estimated_resolution_minutes": 30,
                    "related_runbooks": ["runbook/incident-response", "runbook/scaling"],
                }
            )

        hint = (
            f"Set LLM_API_KEY in backend/.env (provider: {self.provider}). "
            "Free keys: huggingface.co/settings/tokens, openrouter.ai, or console.groq.com"
        )
        if error:
            return f"LLM call failed ({self.provider}): {error[:200]}. {hint}"
        return (
            f"No LLM API key configured. {hint} "
            "Alerts still ingest and display — only AI investigation uses the fallback."
        )


def json_mode_hint(text: str) -> bool:
    return "json" in text.lower() and "root_cause" in text.lower()
