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
        if not self._llm.is_configured:
            return await self._offline_agent_loop(message, alert_id)

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
                    try:
                        parsed = json.loads(text[start:end])
                    except json.JSONDecodeError:
                        return await self._offline_agent_loop(message, alert_id, partial_tools=tool_calls)
                else:
                    return await self._offline_agent_loop(message, alert_id, partial_tools=tool_calls)

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

    async def _offline_agent_loop(
        self,
        message: str,
        alert_id: UUID | None = None,
        *,
        partial_tools: list[str] | None = None,
    ) -> ChatAgentResult:
        """Rule-based multi-step agent when LLM is unavailable."""
        tool_calls = list(partial_tools or [])
        context_used = alert_id is not None
        lower = message.lower()
        groups: list[dict] = []
        reply_parts: list[str] = ["**Offline pipeline agent** — running tools without LLM.\n"]

        stats = await self._execute_tool("get_stats", {})
        tool_calls.append("get_stats")
        if isinstance(stats, dict):
            reply_parts.append(
                f"- **Stream:** {stats.get('total_alerts', 0)} alerts | "
                f"status: {stats.get('by_status', {})}"
            )

        if any(k in lower for k in ("generate", "ingest", "pipeline", "run", "create", "new alert")):
            result = await self._execute_tool("generate_and_ingest", {"hint": message})
            tool_calls.append("generate_and_ingest")
            if isinstance(result, dict) and result.get("accepted"):
                stages = result.get("pipeline_stages") or ["validate", "deduplicate", "prioritize"]
                reply_parts.append(
                    f"- **Ingested:** {result.get('title')} → P{result.get('priority')} "
                    f"({' → '.join(stages)})"
                )
            else:
                reply_parts.append(f"- **Ingest failed:** {result.get('message', result) if isinstance(result, dict) else result}")

        elif "group" in lower:
            groups = await self._execute_tool("group_alerts", {"status": "prioritized"})
            tool_calls.append("group_alerts")
            if isinstance(groups, list):
                self._last_groups = groups
                if groups:
                    for g in groups[:8]:
                        reply_parts.append(
                            f"- **{g.get('service')}** ({g.get('environment')}): {g.get('count')} alert(s)"
                        )
                else:
                    reply_parts.append("- No prioritized alerts to group.")

        elif any(k in lower for k in ("list", "p1", "p2", "priority", "show", "critical", "high")):
            priority = None
            if "p1" in lower or "critical" in lower:
                priority = 1
            elif "p2" in lower or ("priority 2" in lower):
                priority = 2
            status = "prioritized" if "prioritized" in lower or priority else "all"
            result = await self._execute_tool("list_alerts", {"status": status, "priority": priority})
            tool_calls.append("list_alerts")
            if isinstance(result, dict):
                alerts = result.get("alerts") or []
                if alerts:
                    for a in alerts[:10]:
                        stages = " → ".join(a.get("pipeline_stages") or [])
                        reply_parts.append(
                            f"- P{a.get('priority')} **{a.get('title')}** ({a.get('service')})"
                            + (f" — {stages}" if stages else "")
                        )
                else:
                    reply_parts.append("- No matching alerts in the stream.")

        elif alert_id:
            result = await self._execute_tool("get_alert", {"alert_id": str(alert_id)})
            tool_calls.append("get_alert")
            if isinstance(result, dict) and not result.get("error"):
                stages = " → ".join(result.get("pipeline_stages") or [])
                reply_parts.append(
                    f"- **Selected alert:** P{result.get('priority')} {result.get('title')} "
                    f"({result.get('status')})"
                    + (f" — pipeline: {stages}" if stages else "")
                )

        elif "pipeline" in lower or "validate" in lower or "dedup" in lower or "stage" in lower:
            reply_parts.append(
                "- Pipeline stages: **Ingest → Validate → Deduplicate → Prioritize** (fully autonomous, no human review)."
            )

        else:
            reply_parts.append(
                "- Ask me to **list alerts**, **group by service**, **generate & ingest**, or **summarize the stream**."
            )

        steps = tool_calls.copy()
        if "generate_and_ingest" in tool_calls:
            steps.extend(["Validate", "Deduplicate", "Prioritize"])

        return ChatAgentResult(
            reply="\n".join(reply_parts),
            alert_context_used=context_used,
            groups=groups or self._last_groups,
            tool_calls=tool_calls,
            steps=steps,
        )

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
