"""Web app origin parsing/validation (no config imports — safe during Settings init)."""

from __future__ import annotations

from urllib.parse import urlparse


def parse_web_origin(raw: str) -> str:
    base = (raw or "").strip().rstrip("/")
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
