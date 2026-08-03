"""Chatbot service for alert enquiry."""

from uuid import UUID

from app.models.schemas import AlertRecord
from app.services.alert_store import AlertStore
from app.services.llm_client import LLMClient

CHAT_SYSTEM = """You are Alert Streamer Assistant — an SRE copilot for the Alert Streamer platform.
Answer questions about alerts, investigations, human-in-the-loop reviews, priorities, and recommended actions.
Be concise, actionable, and reference specific alert details when provided.
Pipeline: validate → deduplicate → prioritize → assign team → LLM investigate → human review (P1/P2 only) → resolve. P3+ auto-resolve after investigation."""


class ChatService:
    def __init__(self, llm: LLMClient, store: AlertStore) -> None:
        self._llm = llm
        self._store = store

    async def reply(self, message: str, alert_id: UUID | None = None) -> tuple[str, bool]:
        context_used = False
        context_block = ""

        if alert_id:
            alert = await self._store.get(alert_id)
            if alert:
                context_used = True
                context_block = self._format_alert_context(alert)

        user_content = message
        if context_block:
            user_content = f"{context_block}\n\nUser question: {message}"

        reply = await self._llm.chat(
            [
                {"role": "system", "content": CHAT_SYSTEM},
                {"role": "user", "content": user_content},
            ],
            temperature=0.4,
        )
        return reply, context_used

    @staticmethod
    def _format_alert_context(alert: AlertRecord) -> str:
        inv = alert.investigation
        inv_text = ""
        if inv:
            inv_text = f"""
Investigation:
- Root cause: {inv.root_cause}
- Impact: {inv.impact_assessment}
- Urgency: {inv.urgency_score}/10
- Recommendations: {'; '.join(inv.recommendations)}
"""
        hr = alert.human_review
        hr_text = ""
        if hr:
            hr_text = f"""
Human review: {hr.decision.value} by {hr.reviewer}
Feedback: {hr.feedback or 'none'}
"""
        return f"""Alert context:
- ID: {alert.id}
- Title: {alert.title}
- Type: {alert.alert_type} ({alert.category.value})
- Severity: {alert.severity.value} | Priority: P{alert.priority}
- Service: {alert.service} | Env: {alert.environment}
- Team: {alert.team.value} | Status: {alert.status.value}
- Description: {alert.description}
{inv_text}{hr_text}"""
