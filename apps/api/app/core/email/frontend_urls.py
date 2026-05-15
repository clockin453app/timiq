"""Build absolute URLs for transactional emails (always the web app origin, never the API)."""

from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import urlencode

from app.core.web_origin_validation import (
    is_localhost_web_origin,
    looks_like_api_web_origin,
    parse_web_origin,
)

if TYPE_CHECKING:
    from app.core.config import Settings

__all__ = [
    "build_frontend_url",
    "is_localhost_web_origin",
    "looks_like_api_web_origin",
    "resolve_web_origin",
]


def _web_app_url_from_settings(cfg: Settings) -> str:
    """Read web app URL from the provided Settings instance only (never CORS)."""
    raw = (getattr(cfg, "timiq_web_app_url", None) or getattr(cfg, "web_origin", None) or "").strip()
    return raw.rstrip("/")


def resolve_web_origin(settings_obj: Settings | None = None) -> str:
    if settings_obj is None:
        from app.core.config import settings as global_settings

        settings_obj = global_settings
    return parse_web_origin(_web_app_url_from_settings(settings_obj))


def build_frontend_url(
    settings_obj: Settings | None,
    path: str,
    query: dict[str, str] | None = None,
) -> str:
    base = resolve_web_origin(settings_obj)
    normalized = path if path.startswith("/") else f"/{path}"
    if not query:
        return f"{base}{normalized}"
    return f"{base}{normalized}?{urlencode(query)}"
