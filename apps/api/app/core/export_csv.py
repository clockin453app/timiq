"""Small CSV helpers for report exports (no heavy framework)."""

from __future__ import annotations

import re
from datetime import datetime
from zoneinfo import ZoneInfo


def seconds_to_hours_csv(seconds: int | None, *, decimals: int = 2) -> str:
    if seconds is None:
        return ""
    fmt = f"{{:.{decimals}f}}"
    return fmt.format(seconds / 3600.0)


def truncate_plain_text(value: str | None, max_len: int) -> str:
    if not value:
        return ""
    s = str(value).replace("\r\n", "\n").replace("\r", "\n").strip()
    if len(s) <= max_len:
        return s
    return s[: max_len - 1] + "…"


def format_dt_local(dt: datetime | None, tz: ZoneInfo, fmt: str = "%Y-%m-%d %H:%M") -> str:
    if dt is None:
        return ""
    aware = dt if dt.tzinfo is not None else dt.replace(tzinfo=ZoneInfo("UTC"))
    return aware.astimezone(tz).strftime(fmt)


_SLUG_RE = re.compile(r"[^a-zA-Z0-9._-]+")


def safe_export_filename(*parts: str) -> str:
    raw = "-".join(p.strip() for p in parts if p and p.strip()) or "export"
    slug = _SLUG_RE.sub("_", raw).strip("._") or "export"
    return slug[:180]
