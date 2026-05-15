"""Build absolute URLs for transactional emails (always the web app origin, never the API)."""

from __future__ import annotations

from urllib.parse import urlencode, urlparse

from app.core.config import Settings


def resolve_web_origin(settings: Settings) -> str:
    raw = (settings.timiq_web_app_url or "").strip()
    if not raw:
        raise ValueError("WEB_ORIGIN or TIMIQ_WEB_APP_URL must be set.")
    base = raw.rstrip("/")
    parsed = urlparse(base)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("WEB_ORIGIN must be a valid http(s) origin with no path.")
    if parsed.path not in ("", "/"):
        raise ValueError("WEB_ORIGIN must not include a path.")
    return base


def is_localhost_web_origin(origin: str) -> bool:
    host = (urlparse(origin).hostname or "").lower()
    return host in ("localhost", "127.0.0.1", "::1")


def looks_like_api_web_origin(origin: str) -> bool:
    host = (urlparse(origin).hostname or "").lower()
    if not host:
        return True
    if "-api." in host or host.endswith("-api.onrender.com"):
        return True
    if host.startswith("api.") or host.split(".", 1)[0] == "api":
        return True
    return False


def build_frontend_url(
    settings: Settings,
    path: str,
    query: dict[str, str] | None = None,
) -> str:
    base = resolve_web_origin(settings)
    normalized = path if path.startswith("/") else f"/{path}"
    if not query:
        return f"{base}{normalized}"
    return f"{base}{normalized}?{urlencode(query)}"
