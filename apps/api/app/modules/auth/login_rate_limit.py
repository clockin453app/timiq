"""Process-local login rate limiting (per-process only; resets on restart).

Bounds memory with a fixed max entry count and TTL expiry. Does not coordinate
across multiple API instances — suitable as an interim control when no shared
cache is available.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

# Burst of failed attempts before cooldown.
MAX_FAILURES_PER_EMAIL_IP = 5
MAX_FAILURES_PER_IP = 30
MAX_FAILURES_PER_EMAIL = 15

# Sliding window / cooldown duration.
WINDOW_SECONDS = 15 * 60
COOLDOWN_SECONDS = 15 * 60

# Memory bound for the in-process maps.
_MAX_ENTRIES = 4096

_lock = threading.Lock()


@dataclass
class _AttemptBucket:
    failures: list[float]
    cooldown_until: float = 0.0


_email_ip_buckets: dict[str, _AttemptBucket] = {}
_ip_buckets: dict[str, _AttemptBucket] = {}
_email_buckets: dict[str, _AttemptBucket] = {}


def _prune_failures(failures: list[float], now: float, window: float) -> None:
    cutoff = now - window
    failures[:] = [stamp for stamp in failures if stamp > cutoff]


def _evict_if_needed(store: dict[str, _AttemptBucket], now: float) -> None:
    if len(store) < _MAX_ENTRIES:
        return
    stale_keys = [
        key
        for key, bucket in store.items()
        if bucket.cooldown_until < now
        and (not bucket.failures or bucket.failures[-1] < now - WINDOW_SECONDS)
    ]
    for key in stale_keys[: max(1, len(stale_keys) // 2 or 1)]:
        store.pop(key, None)
    if len(store) >= _MAX_ENTRIES:
        # Drop oldest by last failure / cooldown.
        ordered = sorted(
            store.items(),
            key=lambda item: max(
                item[1].cooldown_until,
                item[1].failures[-1] if item[1].failures else 0.0,
            ),
        )
        for key, _ in ordered[: max(1, len(ordered) // 4)]:
            store.pop(key, None)


def _get_bucket(store: dict[str, _AttemptBucket], key: str, now: float) -> _AttemptBucket:
    _evict_if_needed(store, now)
    bucket = store.get(key)
    if bucket is None:
        bucket = _AttemptBucket(failures=[])
        store[key] = bucket
    _prune_failures(bucket.failures, now, WINDOW_SECONDS)
    return bucket


def _seconds_until(cooldown_until: float, now: float) -> int:
    return max(1, int(cooldown_until - now + 0.999))


def check_login_allowed(*, email: str, client_ip: str) -> tuple[bool, int | None]:
    """Return (allowed, retry_after_seconds)."""
    normalized_email = email.strip().lower()
    ip = (client_ip or "unknown").strip() or "unknown"
    now = time.time()

    with _lock:
        email_ip = _get_bucket(_email_ip_buckets, f"{normalized_email}|{ip}", now)
        ip_bucket = _get_bucket(_ip_buckets, ip, now)
        email_bucket = _get_bucket(_email_buckets, normalized_email, now)

        for bucket in (email_ip, ip_bucket, email_bucket):
            if bucket.cooldown_until > now:
                return False, _seconds_until(bucket.cooldown_until, now)

        return True, None


def record_login_failure(*, email: str, client_ip: str) -> tuple[bool, int | None]:
    """Record a failed login. Returns (still_allowed, retry_after_seconds)."""
    normalized_email = email.strip().lower()
    ip = (client_ip or "unknown").strip() or "unknown"
    now = time.time()

    with _lock:
        email_ip = _get_bucket(_email_ip_buckets, f"{normalized_email}|{ip}", now)
        ip_bucket = _get_bucket(_ip_buckets, ip, now)
        email_bucket = _get_bucket(_email_buckets, normalized_email, now)

        email_ip.failures.append(now)
        ip_bucket.failures.append(now)
        email_bucket.failures.append(now)

        retry_after: int | None = None

        if len(email_ip.failures) >= MAX_FAILURES_PER_EMAIL_IP:
            email_ip.cooldown_until = now + COOLDOWN_SECONDS
            retry_after = COOLDOWN_SECONDS
        if len(ip_bucket.failures) >= MAX_FAILURES_PER_IP:
            ip_bucket.cooldown_until = now + COOLDOWN_SECONDS
            retry_after = COOLDOWN_SECONDS
        if len(email_bucket.failures) >= MAX_FAILURES_PER_EMAIL:
            email_bucket.cooldown_until = now + COOLDOWN_SECONDS
            retry_after = COOLDOWN_SECONDS

        if retry_after is not None:
            return False, retry_after
        return True, None


def record_login_success(*, email: str, client_ip: str) -> None:
    """Clear counters for this email/IP after a successful authentication."""
    normalized_email = email.strip().lower()
    ip = (client_ip or "unknown").strip() or "unknown"

    with _lock:
        _email_ip_buckets.pop(f"{normalized_email}|{ip}", None)
        email_bucket = _email_buckets.get(normalized_email)
        if email_bucket is not None:
            email_bucket.failures.clear()
            email_bucket.cooldown_until = 0.0
        # Keep IP bucket failures from other emails; only clear if empty/expired later.


def reset_login_rate_limit_state_for_tests() -> None:
    """Test helper — clears all in-memory buckets."""
    with _lock:
        _email_ip_buckets.clear()
        _ip_buckets.clear()
        _email_buckets.clear()
