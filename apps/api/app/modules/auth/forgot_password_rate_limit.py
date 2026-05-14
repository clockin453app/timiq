"""Simple in-memory rate limit for public forgot-password (per-process only)."""

from __future__ import annotations

import time

_buckets: dict[str, list[float]] = {}


def allow_forgot_password_attempt(client_key: str, *, max_per_hour: int = 5) -> bool:
    now = time.time()
    cutoff = now - 3600
    bucket = _buckets.setdefault(client_key, [])
    bucket[:] = [t for t in bucket if t > cutoff]
    if len(bucket) >= max_per_hour:
        return False
    bucket.append(now)
    return True
