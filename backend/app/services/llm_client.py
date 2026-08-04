"""Multi-provider LLM client — free OpenRouter/Groq for testing, NVIDIA for production."""

import json
import logging
import re
from typing import Any

import httpx

from app.config import LLMProvider, Settings

logger = logging.getLogger(__name__)


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
            return self._fallback_response(messages)

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
            return self._fallback_response(messages, error=self._format_http_error(exc, detail))
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

    def _format_http_error(self, exc: httpx.HTTPStatusError, detail: str) -> str:
        code = exc.response.status_code
        if code == 429:
            return (
                "Provider rate limit exceeded (HTTP 429). Using offline fallback — "
                "switch provider in the dashboard or add a key for OpenRouter/Groq."
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

        hint = self._key_hint()
        if error:
            if "429" in error or "rate limit" in error.lower():
                return self._offline_chat_reply(user_msg, quota_exceeded=True)
            return f"LLM call failed ({self.provider}): {error[:200]}. {hint}"
        return (
            f"No LLM API key configured. {self._key_hint()} "
            "Alerts still ingest and display — only AI investigation uses the fallback."
        )

    def _key_hint(self) -> str:
        if self.provider == "gemini":
            return "Set GEMINI_API_KEY in backend/.env (aistudio.google.com/apikey)."
        return (
            f"Set LLM_API_KEY in backend/.env (provider: {self.provider}). "
            "Free keys: aistudio.google.com/apikey, openrouter.ai, or console.groq.com"
        )

    def _offline_chat_reply(self, user_msg: str, *, quota_exceeded: bool = False) -> str:
        """Rule-based copilot when the LLM provider is unavailable."""
        lower = user_msg.lower()
        prefix = (
            "Gemini quota exceeded — replying offline. "
            if quota_exceeded
            else "Offline mode — "
        )

        if any(k in lower for k in ("p1", "priority 1", "critical")):
            return (
                f"{prefix}P1 alerts are highest severity. They require human review after LLM "
                "investigation. Check the Investigation panel, then Approve, Reject, or Escalate."
            )
        if any(k in lower for k in ("p2", "priority 2", "high")):
            return (
                f"{prefix}P2 alerts also require human-in-the-loop review before resolution. "
                "Select an alert from the stream for context-aware guidance."
            )
        if "human" in lower or "review" in lower or "hitl" in lower:
            return (
                f"{prefix}Human review applies to P1–P2 only. P3+ auto-resolve after investigation. "
                "Use Approve / Reject / Escalate on the selected alert."
            )
        if "alert" in lower or "data" in lower or "empty" in lower:
            return (
                f"{prefix}Alerts live in the in-memory store and reset on restart. "
                "Demo alerts auto-seed on startup; run `python scripts/trigger_alerts.py` for more."
            )
        return (
            f"{prefix}I can help with alert priorities, investigations, and human review. "
            "Select an alert for context, or ask about P1/P2 workflow."
        )


def json_mode_hint(text: str) -> bool:
    return "json" in text.lower() and "root_cause" in text.lower()
