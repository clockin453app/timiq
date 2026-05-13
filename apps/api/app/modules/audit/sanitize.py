"""Sanitize audit event details for API responses (never mutate persisted rows here)."""

from __future__ import annotations

import json
import re
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
    "bank",
    "sort_code",
    "account_number",
    "national_insurance",
    "ni_number",
    "utr",
    "medical",
    "iban",
    "bic",
    "credential",
    "api_key",
    "private_key",
    "client_secret",
    "session_secret",
    "oauth",
)


def _key_should_redact(key: str) -> bool:
    lk = key.lower()
    if any(s in lk for s in _REDACT_SUBSTRINGS):
        return True
    if lk == "path" or lk.endswith("_path") or "filepath" in lk or "dirpath" in lk:
        return True
    return False


_WIN_ABS_PATH = re.compile(r"^[A-Za-z]:\\")
_UNIX_SENSITIVE_PREFIX = (
    "/home/",
    "/Users/",
    "/var/",
    "/usr/",
    "/etc/",
    "/opt/",
    "/tmp/",
    "/private/",
)
_URL_CREDS = re.compile(r"\b(postgresql|postgres|mysql|mariadb|redis|mongodb)://[^\s]+", re.IGNORECASE)


def _string_value_should_redact(value: str) -> bool:
    s = value.strip()
    if len(s) > 4000:
        return True
    if _WIN_ABS_PATH.search(s):
        return True
    if s.startswith("/") and any(s.startswith(p) for p in _UNIX_SENSITIVE_PREFIX):
        return True
    if _URL_CREDS.search(s):
        return True
    return False


def sanitize_audit_details(details: Any) -> Any:
    if isinstance(details, dict):
        out: dict[str, Any] = {}
        for k, v in details.items():
            ks = str(k)
            if _key_should_redact(ks):
                out[ks] = "[redacted]"
            else:
                out[ks] = sanitize_audit_details(v)
        return out
    if isinstance(details, list):
        return [sanitize_audit_details(x) for x in details]
    if isinstance(details, str):
        if len(details) > 2000:
            return details[:2000] + "…"
        if _string_value_should_redact(details):
            return "[redacted]"
        return details
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
