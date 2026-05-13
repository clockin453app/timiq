"""Sanitize audit event details for API responses (never mutate persisted rows here)."""

from __future__ import annotations

import json
from typing import Any

_REDACT_SUBSTRINGS = (
    "password",
    "token",
    "secret",
    "storage_path",
    "file_path",
    "signature_image_path",
    "profile_photo_storage_path",
    "authorization",
    "cookie",
    "db_url",
    "database_url",
)


def _key_should_redact(key: str) -> bool:
    lk = key.lower()
    if any(s in lk for s in _REDACT_SUBSTRINGS):
        return True
    if "path" in lk:
        return True
    return False


def sanitize_audit_details(details: Any) -> Any:
    if isinstance(details, dict):
        out: dict[str, Any] = {}
        for k, v in details.items():
            if _key_should_redact(str(k)):
                out[str(k)] = "[redacted]"
            else:
                out[str(k)] = sanitize_audit_details(v)
        return out
    if isinstance(details, list):
        return [sanitize_audit_details(x) for x in details]
    if isinstance(details, str) and len(details) > 2000:
        return details[:2000] + "…"
    return details


def audit_details_summary(details: Any, *, max_len: int = 320) -> str:
    try:
        safe = sanitize_audit_details(details)
        raw = json.dumps(safe, default=str, separators=(",", ":"))
    except (TypeError, ValueError):
        return "[unserializable details]"
    if len(raw) <= max_len:
        return raw
    return raw[: max_len - 1] + "…"
