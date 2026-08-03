from fastapi import APIRouter, Depends

from app.models.schemas import ChatRequest, ChatResponse
from app.services.alert_store import AlertStore
from app.services.chat_service import ChatService

router = APIRouter(prefix="/chat", tags=["chat"])


def get_store() -> AlertStore:
    from app.main import alert_store

    return alert_store


def get_chat() -> ChatService:
    from app.main import chat_service

    return chat_service


@router.post("", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    chat: ChatService = Depends(get_chat),
) -> ChatResponse:
    reply, context_used = await chat.reply(request.message, request.alert_id)
    return ChatResponse(reply=reply, alert_context_used=context_used)
