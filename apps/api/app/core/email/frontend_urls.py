"""Build absolute URLs for transactional emails (always the web app origin, never the API)."""

from __future__ import annotations

from urllib.parse import urlencode, urlparse

from app.core.config import Settings, settings


def _web_app_url_from_settings(cfg: Settings) -> str:
    """Read web app URL from the provided Settings instance only (never CORS)."""
    raw = (getattr(cfg, "timiq_web_app_url", None) or cfg.web_origin or "").strip()
    return raw.rstrip("/")


def resolve_web_origin(settings_obj: Settings | None = None) -> str:
    cfg = settings_obj if settings_obj is not None else settings
    base = _web_app_url_from_settings(cfg)
    if not base:
        raise ValueError("WEB_ORIGIN or TIMIQ_WEB_APP_URL must be set.")
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
    settings_obj: Settings | None,
    path: str,
    query: dict[str, str] | None = None,
) -> str:
    base = resolve_web_origin(settings_obj)
    normalized = path if path.startswith("/") else f"/{path}"
    if not query:
        return f"{base}{normalized}"
    return f"{base}{normalized}?{urlencode(query)}"
