from fastapi import APIRouter, Depends

from app.models.schemas import ChatRequest, ChatResponse
from app.services.chat_agent import ChatAgent

router = APIRouter(prefix="/chat", tags=["chat"])


def get_chat_agent() -> ChatAgent:
    from app.main import chat_agent

    return chat_agent


@router.post("", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    agent: ChatAgent = Depends(get_chat_agent),
) -> ChatResponse:
    result = await agent.reply(request.message, request.alert_id)
    return ChatResponse(
        reply=result.reply,
        alert_context_used=result.alert_context_used,
        actions=[a.model_dump() for a in result.actions],
        groups=result.groups,
        tool_calls=result.tool_calls,
        steps=result.steps,
    )
