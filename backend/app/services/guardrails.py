"""Input guardrails for generator chat — prompt injection and abuse prevention."""

import re
from dataclasses import dataclass

MAX_MESSAGE_LENGTH = 500

BLOCKED_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"ignore\s+(all\s+)?(previous|prior|above)\s+instructions?", re.I),
    re.compile(r"disregard\s+(the\s+)?(system|above)", re.I),
    re.compile(r"you\s+are\s+now", re.I),
    re.compile(r"new\s+instructions?\s*:", re.I),
    re.compile(r"system\s+prompt", re.I),
    re.compile(r"reveal\s+(your\s+)?(prompt|instructions?|rules)", re.I),
    re.compile(r"jailbreak", re.I),
    re.compile(r"<\s*/?\s*script", re.I),
    re.compile(r"\bDROP\s+TABLE\b", re.I),
)

ALLOWED_TOPIC_HINTS = (
    "alert",
    "duplicate",
    "reject",
    "resolved",
    "priorit",
    "generate",
    "create",
    "provide",
    "show",
    "give",
    "pss",
    "bws",
    "datadog",
    "incident",
    "pipeline",
    "help",
    "status",
    "data",
    "custom",
    "sqs",
    "api",
    "5xx",
)


@dataclass
class GuardrailResult:
    allowed: bool
    message: str
    sanitized: str
    blocked_reason: str | None = None


def sanitize_message(raw: str) -> GuardrailResult:
    text = (raw or "").strip()
    if not text:
        return GuardrailResult(
            allowed=False,
            message="Please describe what alerts you need (e.g. duplicate, rejected, or resolved data).",
            sanitized="",
            blocked_reason="empty",
        )

    if len(text) > MAX_MESSAGE_LENGTH:
        return GuardrailResult(
            allowed=False,
            message=f"Message too long — keep it under {MAX_MESSAGE_LENGTH} characters.",
            sanitized=text[:MAX_MESSAGE_LENGTH],
            blocked_reason="too_long",
        )

    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    for pattern in BLOCKED_PATTERNS:
        if pattern.search(cleaned):
            return GuardrailResult(
                allowed=False,
                message=(
                    "I can only help with PSS BWS alert generation — "
                    "try: \"generate 2 rejected alerts\" or \"show duplicate data\"."
                ),
                sanitized=cleaned,
                blocked_reason="injection_pattern",
            )

    lower = cleaned.lower()
    if not any(hint in lower for hint in ALLOWED_TOPIC_HINTS):
        return GuardrailResult(
            allowed=False,
            message=(
                "I specialize in PSS BWS Datadog alerts. Ask for prioritized, duplicate, "
                "rejected, or resolved alert data."
            ),
            sanitized=cleaned,
            blocked_reason="off_topic",
        )

    return GuardrailResult(allowed=True, message="", sanitized=cleaned)
