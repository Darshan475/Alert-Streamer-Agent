"""LLM provider selection and configuration."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import (
    DEFAULT_LLM_PROVIDER,
    LLMProvider,
    LLM_PROVIDER_META,
    OPENROUTER_MODELS,
    PROVIDER_DEFAULTS,
)

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
    models: list[str] = Field(default_factory=list)


class LlmProvidersResponse(BaseModel):
    active_provider: LLMProvider
    default_provider: LLMProvider
    active_model: str
    providers: list[LlmProviderInfo]


class SetLlmProviderRequest(BaseModel):
    provider: LLMProvider = Field(..., description="LLM provider id to activate")


class SetLlmModelRequest(BaseModel):
    model: str = Field(..., min_length=3, max_length=128)


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
        models = OPENROUTER_MODELS if provider_id == "openrouter" else []
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
                models=models,
            )
        )

    return LlmProvidersResponse(
        active_provider=client.provider,
        default_provider=DEFAULT_LLM_PROVIDER,
        active_model=client.model,
        providers=providers,
    )


@router.put("/provider", response_model=SetLlmProviderResponse)
async def set_llm_provider(body: SetLlmProviderRequest):
    if body.provider not in PROVIDER_DEFAULTS:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {body.provider}")

    client = get_llm_client()
    client.set_provider(body.provider)
    if body.provider == "openrouter":
        client.set_model(PROVIDER_DEFAULTS["openrouter"]["model"])
    else:
        client.set_model(client.model_for(body.provider))
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


@router.put("/model", response_model=SetLlmProviderResponse)
async def set_llm_model(body: SetLlmModelRequest):
    client = get_llm_client()
    if client.provider != "openrouter":
        raise HTTPException(status_code=400, detail="Model selection is available for OpenRouter only.")

    if body.model not in OPENROUTER_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown model. Choose from: {', '.join(OPENROUTER_MODELS)}",
        )

    client.set_model(body.model)
    meta = LLM_PROVIDER_META["openrouter"]
    configured = client.is_configured_for("openrouter")
    message = f"OpenRouter model set to {body.model}."
    if not configured:
        message += f" Add {meta['key_hint']} to enable live AI."

    return SetLlmProviderResponse(
        active_provider="openrouter",
        label=str(meta["label"]),
        model=client.model,
        configured=configured,
        message=message,
    )
