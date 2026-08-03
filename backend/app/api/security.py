"""API security: API key auth and rate limiting."""

from fastapi import HTTPException, Request, Security, status
from fastapi.security import APIKeyHeader

from app.config import get_settings

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def verify_api_key(api_key: str | None = Security(api_key_header)) -> str:
    settings = get_settings()
    if not api_key or api_key != settings.alert_streamer_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key. Pass X-API-Key header.",
        )
    return api_key


async def optional_api_key(api_key: str | None = Security(api_key_header)) -> str | None:
    """For read endpoints that allow unauthenticated access in dev."""
    settings = get_settings()
    if api_key and api_key == settings.alert_streamer_api_key:
        return api_key
    return None
