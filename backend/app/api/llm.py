"""LLM provider selection and configuration."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import DEFAULT_LLM_PROVIDER, LLMProvider, LLM_PROVIDER_META, PROVIDER_DEFAULTS

router = APIRouter(prefix="/llm", tags=["llm"])


class LlmProviderInfo(BaseModel):
    id: LLMProvider
    label: str
    model: str
    free: bool
    is_default: bool
    configured: bool
    key_hint: str
    signup_url: str = ""


class LlmProvidersResponse(BaseModel):
    active_provider: LLMProvider
    default_provider: LLMProvider
    providers: list[LlmProviderInfo]


class SetLlmProviderRequest(BaseModel):
    provider: LLMProvider = Field(..., description="LLM provider id to activate")


class SetLlmProviderResponse(BaseModel):
    active_provider: LLMProvider
    label: str
    model: str
    configured: bool
    message: str


def get_llm_client():
    from app.main import llm_client

    return llm_client


@router.get("/providers", response_model=LlmProvidersResponse)
async def list_llm_providers():
    client = get_llm_client()
    providers: list[LlmProviderInfo] = []

    for provider_id in PROVIDER_DEFAULTS:
        meta = LLM_PROVIDER_META[provider_id]
        providers.append(
            LlmProviderInfo(
                id=provider_id,
                label=str(meta["label"]),
                model=client.model_for(provider_id),
                free=bool(meta["free"]),
                is_default=provider_id == DEFAULT_LLM_PROVIDER,
                configured=client.is_configured_for(provider_id),
                key_hint=str(meta["key_hint"]),
                signup_url=str(meta.get("signup_url", "")),
            )
        )

    return LlmProvidersResponse(
        active_provider=client.provider,
        default_provider=DEFAULT_LLM_PROVIDER,
        providers=providers,
    )


@router.put("/provider", response_model=SetLlmProviderResponse)
async def set_llm_provider(body: SetLlmProviderRequest):
    if body.provider not in PROVIDER_DEFAULTS:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {body.provider}")

    client = get_llm_client()
    client.set_provider(body.provider)
    meta = LLM_PROVIDER_META[body.provider]
    configured = client.is_configured_for(body.provider)

    if body.provider == "offline":
        message = "Using offline rule-based fallback — no API key needed."
    elif configured:
        message = f"Switched to {meta['label']} ({client.model})."
    else:
        message = f"Switched to {meta['label']}. Add {meta['key_hint']} in backend/.env to enable live AI."

    return SetLlmProviderResponse(
        active_provider=body.provider,
        label=str(meta["label"]),
        model=client.model,
        configured=configured,
        message=message,
    )
