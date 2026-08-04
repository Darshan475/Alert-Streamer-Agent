"""Tool-using chat agent — groups alerts and batch approves via agent loop."""

import json
import logging
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.schemas import AlertStatus, HumanReviewDecision, HumanReviewRequest, Team
from app.services.alert_generator_agent import AlertGeneratorAgent
from app.services.alert_pipeline import AlertPipeline
from app.services.alert_store import AlertStore
from app.services.llm_client import LLMClient
from app.services.review_actions import apply_human_review, batch_approve_alerts, group_alerts_by_service

logger = logging.getLogger(__name__)

CHAT_AGENT_SYSTEM = """You are Alert Streamer AI — an autonomous SRE agent copilot with tools.
You help operators investigate alerts, group related incidents, approve batches, and trigger new events.

Available tools (respond with JSON only):
1. {"type":"tool","tool":"list_alerts","args":{"status":"pending_review|investigating|all"}}
2. {"type":"tool","tool":"group_alerts","args":{"status":"pending_review"}}
3. {"type":"tool","tool":"approve_group","args":{"alert_ids":["uuid",...],"assigned_to":"engineer","feedback":"..."}}
4. {"type":"tool","tool":"approve_combined","args":{"group_key":"service/env","assigned_to":"engineer"}}
5. {"type":"tool","tool":"generate_alert","args":{"hint":"optional scenario"}}
6. {"type":"final","reply":"markdown message for user","actions":[{"type":"batch_approve","alert_ids":[],"label":"Approve group"}]}

Workflow for "approve grouped/combined alerts":
- Call group_alerts to find related pending alerts
- Summarize groups for the user
- When user confirms, call approve_group or approve_combined
- Include actions in final response so UI can show approve buttons

Always use tools to fetch live data — never invent alert IDs. Be concise and actionable."""


class ChatAction(BaseModel):
    type: str
    alert_ids: list[str] = Field(default_factory=list)
    label: str = ""


class ChatAgentResult(BaseModel):
    reply: str
    alert_context_used: bool = False
    actions: list[ChatAction] = Field(default_factory=list)
    groups: list[dict] = Field(default_factory=list)
    tool_calls: list[str] = Field(default_factory=list)


class ChatAgent:
    """Multi-step agent loop with tool execution — not a single if-else chat call."""

    MAX_STEPS = 6

    def __init__(
        self,
        llm: LLMClient,
        store: AlertStore,
        generator: AlertGeneratorAgent,
        pipeline: AlertPipeline,
        run_investigation,
    ) -> None:
        self._llm = llm
        self._store = store
        self._generator = generator
        self._pipeline = pipeline
        self._run_investigation = run_investigation
        self._last_groups: list[dict] = []

    async def reply(self, message: str, alert_id: UUID | None = None) -> ChatAgentResult:
        context_used = False
        tool_calls: list[str] = []
        context_parts: list[str] = []

        if alert_id:
            alert = await self._store.get(alert_id)
            if alert:
                context_used = True
                context_parts.append(self._format_alert(alert))

        stats = await self._store.stats()
        context_parts.append(
            f"Stream stats: {stats.total_alerts} alerts | "
            f"needs review: {stats.by_status.get('pending_review', 0)} | "
            f"by status: {stats.by_status}"
        )

        messages: list[dict[str, str]] = [
            {"role": "system", "content": CHAT_AGENT_SYSTEM},
            {
                "role": "user",
                "content": "\n\n".join(context_parts) + f"\n\nUser: {message}",
            },
        ]

        actions: list[ChatAction] = []
        groups: list[dict] = []

        for step in range(self.MAX_STEPS):
            raw = await self._llm.chat(messages, json_mode=True, temperature=0.3)
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                text = raw
                start, end = text.find("{"), text.rfind("}") + 1
                if start >= 0 and end > start:
                    parsed = json.loads(text[start:end])
                else:
                    return ChatAgentResult(
                        reply=raw,
                        alert_context_used=context_used,
                        tool_calls=tool_calls,
                    )

            if parsed.get("type") == "final" or "reply" in parsed and parsed.get("type") != "tool":
                reply = parsed.get("reply", raw)
                for act in parsed.get("actions") or []:
                    actions.append(
                        ChatAction(
                            type=act.get("type", "batch_approve"),
                            alert_ids=act.get("alert_ids") or [],
                            label=act.get("label", "Approve"),
                        )
                    )
                if not actions and self._last_groups:
                    for g in self._last_groups:
                        if g.get("count", 0) > 1:
                            actions.append(
                                ChatAction(
                                    type="batch_approve",
                                    alert_ids=g.get("alert_ids", []),
                                    label=f"Approve {g['group_key']} ({g['count']} alerts)",
                                )
                            )
                return ChatAgentResult(
                    reply=reply,
                    alert_context_used=context_used,
                    actions=actions,
                    groups=groups or self._last_groups,
                    tool_calls=tool_calls,
                )

            tool = parsed.get("tool")
            args = parsed.get("args") or {}
            tool_calls.append(tool or "unknown")
            result = await self._execute_tool(tool, args)
            context_used = True

            if tool == "group_alerts":
                groups = result if isinstance(result, list) else []
                self._last_groups = groups

            messages.append({"role": "assistant", "content": json.dumps(parsed)})
            messages.append(
                {
                    "role": "user",
                    "content": f"Tool result ({tool}):\n{json.dumps(result, default=str)[:4000]}",
                }
            )

        return ChatAgentResult(
            reply="Agent reached max steps. Please refine your request.",
            alert_context_used=context_used,
            groups=self._last_groups,
            tool_calls=tool_calls,
        )

    async def _execute_tool(self, tool: str | None, args: dict) -> object:
        if tool == "list_alerts":
            status = args.get("status", "all")
            exclude = {AlertStatus.DUPLICATE}
            status_filter = None
            if status == "pending_review":
                status_filter = AlertStatus.PENDING_REVIEW
            elif status == "investigating":
                status_filter = AlertStatus.INVESTIGATING
            items, total = await self._store.list_alerts(
                status=status_filter,
                limit=20,
                exclude_statuses=exclude if status == "all" else None,
            )
            return {
                "total": total,
                "alerts": [
                    {
                        "id": str(a.id),
                        "title": a.title,
                        "priority": a.priority,
                        "status": a.status.value,
                        "service": a.service,
                    }
                    for a in items
                ],
            }

        if tool == "group_alerts":
            status = args.get("status", "pending_review")
            status_filter = AlertStatus.PENDING_REVIEW
            if status == "investigating":
                status_filter = AlertStatus.INVESTIGATING
            items, _ = await self._store.list_alerts(status=status_filter, limit=50)
            return group_alerts_by_service(items)

        if tool == "approve_group":
            ids = [UUID(i) for i in args.get("alert_ids", [])]
            return await batch_approve_alerts(
                self._store,
                ids,
                reviewer=args.get("reviewer", "chat-agent"),
                assigned_to=args.get("assigned_to", "on-call-engineer"),
                feedback=args.get("feedback", "Approved via chat agent"),
            )

        if tool == "approve_combined":
            group_key = args.get("group_key", "")
            matching = [g for g in self._last_groups if g.get("group_key") == group_key]
            if not matching:
                return {"error": f"No group found for key {group_key}"}
            ids = [UUID(i) for i in matching[0].get("alert_ids", [])]
            return await batch_approve_alerts(
                self._store,
                ids,
                assigned_to=args.get("assigned_to", "on-call-engineer"),
                feedback=args.get("feedback", f"Combined approve: {group_key}"),
            )

        if tool == "generate_alert":
            recent_items, _ = await self._store.list_alerts(limit=10)
            recent_titles = [a.title for a in recent_items]
            alert = await self._generator.generate(
                hint=args.get("hint"),
                recent_titles=recent_titles,
            )
            response, record = await self._pipeline.process(alert, store=self._store)
            if response.accepted and record:
                await self._store.save(record)
                import asyncio

                asyncio.create_task(self._run_investigation(record.id))
                return {
                    "accepted": True,
                    "alert_id": str(record.id),
                    "title": record.title,
                    "message": response.message,
                }
            return {"accepted": False, "message": response.message}

        return {"error": f"Unknown tool: {tool}"}

    @staticmethod
    def _format_alert(alert) -> str:
        inv = alert.investigation
        inv_text = ""
        if inv:
            inv_text = f"Investigation: {inv.root_cause} | Urgency {inv.urgency_score}/10"
        return (
            f"Selected alert: {alert.title} (ID: {alert.id})\n"
            f"P{alert.priority} {alert.severity.value} | {alert.service} | {alert.status.value}\n"
            f"{inv_text}"
        )
