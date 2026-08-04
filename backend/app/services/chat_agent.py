"""Tool-using pipeline agent — multi-step loop for ingest → validate → dedup → prioritize."""

import json
import logging
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.schemas import AlertStatus
from app.services.alert_generator_agent import AlertGeneratorAgent
from app.services.alert_pipeline import AlertPipeline
from app.services.alert_store import AlertStore
from app.services.llm_client import LLMClient
from app.services.review_actions import group_alerts_by_service

logger = logging.getLogger(__name__)

CHAT_AGENT_SYSTEM = """You are Alert Streamer AI — an autonomous pipeline agent.
Your scope is ONLY the alert pipeline: Ingest → Validate → Deduplicate → Prioritize.
There is NO human-in-the-loop. Alerts are fully processed by agents.

You MUST work in multiple steps using tools — never answer from memory alone.
1. Call tools to gather live data or run pipeline actions
2. Synthesize results into a final reply after you have enough context

Available tools (respond with JSON only):
1. {"type":"tool","tool":"list_alerts","args":{"status":"all|prioritized|rejected","priority":null}}
2. {"type":"tool","tool":"get_stats","args":{}}
3. {"type":"tool","tool":"get_alert","args":{"alert_id":"uuid"}}
4. {"type":"tool","tool":"group_alerts","args":{"status":"all|prioritized"}}
5. {"type":"tool","tool":"generate_and_ingest","args":{"hint":"optional scenario"}}
6. {"type":"final","reply":"markdown message","steps":["Validate","Deduplicate","Prioritize"]}

When ingesting or generating alerts, report which pipeline stages completed and the assigned priority.
When summarizing, use get_stats and list_alerts first.
Include "steps" in final responses listing agent actions you took (tool names or pipeline stages).
Be concise and actionable. Never invent alert IDs."""


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
    steps: list[str] = Field(default_factory=list)


class ChatAgent:
    """Multi-step agent loop with tool execution — not a single-shot chat call."""

    MAX_STEPS = 8

    def __init__(
        self,
        llm: LLMClient,
        store: AlertStore,
        generator: AlertGeneratorAgent,
        pipeline: AlertPipeline,
    ) -> None:
        self._llm = llm
        self._store = store
        self._generator = generator
        self._pipeline = pipeline
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
            f"prioritized: {stats.by_status.get('prioritized', 0)} | "
            f"by status: {stats.by_status}"
        )

        messages: list[dict[str, str]] = [
            {"role": "system", "content": CHAT_AGENT_SYSTEM},
            {
                "role": "user",
                "content": "\n\n".join(context_parts) + f"\n\nUser: {message}",
            },
        ]

        groups: list[dict] = []

        for _step in range(self.MAX_STEPS):
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
                steps = parsed.get("steps") or tool_calls
                return ChatAgentResult(
                    reply=reply,
                    alert_context_used=context_used,
                    groups=groups or self._last_groups,
                    tool_calls=tool_calls,
                    steps=steps if isinstance(steps, list) else [str(steps)],
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
            steps=tool_calls,
        )

    async def _execute_tool(self, tool: str | None, args: dict) -> object:
        if tool == "list_alerts":
            status = args.get("status", "all")
            priority = args.get("priority")
            exclude = {AlertStatus.DUPLICATE}
            status_filter = None
            if status == "prioritized":
                status_filter = AlertStatus.PRIORITIZED
            elif status == "rejected":
                status_filter = AlertStatus.REJECTED
            items, total = await self._store.list_alerts(
                status=status_filter,
                limit=20,
                exclude_statuses=exclude if status == "all" else None,
            )
            if priority is not None:
                items = [a for a in items if a.priority == int(priority)]
            return {
                "total": total,
                "alerts": [
                    {
                        "id": str(a.id),
                        "title": a.title,
                        "priority": a.priority,
                        "status": a.status.value,
                        "service": a.service,
                        "pipeline_stages": [
                            s.get("stage")
                            for s in (a.metadata or {}).get("pipeline_agent_log", [])
                            if isinstance(s, dict)
                        ],
                    }
                    for a in items
                ],
            }

        if tool == "get_stats":
            stats = await self._store.stats()
            return {
                "total_alerts": stats.total_alerts,
                "by_status": stats.by_status,
                "by_priority": stats.by_priority,
                "by_team": stats.by_team,
            }

        if tool == "get_alert":
            alert_id = args.get("alert_id")
            if not alert_id:
                return {"error": "alert_id required"}
            try:
                alert = await self._store.get(UUID(str(alert_id)))
            except ValueError:
                return {"error": "invalid alert_id"}
            if not alert:
                return {"error": "alert not found"}
            return {
                "id": str(alert.id),
                "title": alert.title,
                "priority": alert.priority,
                "status": alert.status.value,
                "service": alert.service,
                "team": alert.team.value,
                "pipeline_stages": [
                    s.get("stage")
                    for s in (alert.metadata or {}).get("pipeline_agent_log", [])
                    if isinstance(s, dict)
                ],
            }

        if tool == "group_alerts":
            status = args.get("status", "all")
            status_filter = AlertStatus.PRIORITIZED if status == "prioritized" else None
            items, _ = await self._store.list_alerts(status=status_filter, limit=50)
            return group_alerts_by_service(items)

        if tool == "generate_and_ingest":
            recent_items, _ = await self._store.list_alerts(limit=10)
            recent_titles = [a.title for a in recent_items]
            alert = await self._generator.generate(
                hint=args.get("hint"),
                recent_titles=recent_titles,
            )
            response, record = await self._pipeline.process(alert, store=self._store)
            if response.accepted and record:
                await self._store.save(record)
                stages = [
                    s.get("stage")
                    for s in (record.metadata or {}).get("pipeline_agent_log", [])
                    if isinstance(s, dict)
                ]
                return {
                    "accepted": True,
                    "alert_id": str(record.id),
                    "title": record.title,
                    "priority": record.priority,
                    "status": record.status.value,
                    "pipeline_stages": stages or ["validate", "deduplicate", "prioritize"],
                    "message": response.message,
                }
            return {"accepted": False, "message": response.message}

        return {"error": f"Unknown tool: {tool}"}

    @staticmethod
    def _format_alert(alert) -> str:
        stages = [
            s.get("stage")
            for s in (alert.metadata or {}).get("pipeline_agent_log", [])
            if isinstance(s, dict)
        ]
        stage_text = " → ".join(stages) if stages else "pending"
        return (
            f"Selected alert: {alert.title} (ID: {alert.id})\n"
            f"P{alert.priority} {alert.severity.value} | {alert.service} | {alert.status.value}\n"
            f"Pipeline stages: {stage_text}"
        )
