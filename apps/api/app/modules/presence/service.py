from __future__ import annotations

import ipaddress
import re
from datetime import datetime, time, timedelta, timezone

from sqlalchemy.orm import Session

from app.modules.auth.models import User
from app.modules.presence import repository
from app.modules.presence.models import UserPresenceSession
from app.modules.presence.schemas import (
    LiveLogSessionItem,
    LiveLogSummary,
    LiveLogsResponse,
    PresenceHeartbeatRequest,
)

ONLINE_WINDOW = timedelta(minutes=2)
IDLE_WINDOW = timedelta(minutes=10)
RECENT_WINDOW = timedelta(minutes=30)
WRITE_THROTTLE_WINDOW = timedelta(seconds=20)

_TOKENISH_RE = re.compile(r"(token|secret|password|cookie|session|key|signature|credential)", re.IGNORECASE)


def sanitize_current_path(raw: str | None) -> str | None:
    if not raw:
        return None
    path = raw.split("?", 1)[0].split("#", 1)[0].strip()
    if not path or not path.startswith("/") or "://" in path or "\\" in path:
        return None
    if _TOKENISH_RE.search(path):
        return None
    return path[:300]


def summarize_user_agent(raw: str | None) -> str | None:
    if not raw:
        return None
    ua = raw[:500]
    if "Edg/" in ua:
        browser = "Edge"
    elif "Chrome/" in ua and "Chromium" not in ua:
        browser = "Chrome"
    elif "Firefox/" in ua:
        browser = "Firefox"
    elif "Safari/" in ua and "Chrome/" not in ua:
        browser = "Safari"
    else:
        browser = "Browser"

    if "Windows" in ua:
        platform = "Windows"
    elif "Mac OS X" in ua or "Macintosh" in ua:
        platform = "macOS"
    elif "Android" in ua:
        platform = "Android"
    elif "iPhone" in ua or "iPad" in ua:
        platform = "iOS"
    elif "Linux" in ua:
        platform = "Linux"
    else:
        platform = "unknown OS"

    form = "mobile" if any(token in ua for token in ("Mobile", "Android", "iPhone")) else "desktop"
    return f"{browser} on {platform} {form}"[:160]


def mask_ip_address(raw: str | None) -> str | None:
    if not raw:
        return None
    first = raw.split(",", 1)[0].strip()
    try:
        ip = ipaddress.ip_address(first)
    except ValueError:
        return None
    if ip.version == 4:
        parts = first.split(".")
        return ".".join([*parts[:3], "0"])
    groups = ip.exploded.split(":")
    return ":".join(groups[:4]) + "::"


def _status_for(last_heartbeat_at: datetime, now: datetime) -> str:
    age = now - last_heartbeat_at
    if age <= ONLINE_WINDOW:
        return "online"
    if age <= IDLE_WINDOW:
        return "idle"
    if age <= RECENT_WINDOW:
        return "recent"
    return "offline"


def record_presence_heartbeat(
    db_session: Session,
    *,
    user: User,
    request: PresenceHeartbeatRequest,
    ip_address: str | None,
    now: datetime | None = None,
) -> UserPresenceSession:
    now = now or datetime.now(timezone.utc)
    current_path = sanitize_current_path(request.current_path)
    user_agent_summary = summarize_user_agent(request.user_agent)
    ip_address_masked = mask_ip_address(ip_address)
    role = getattr(user.system_role, "value", str(user.system_role))

    existing = repository.get_presence_session(
        db_session,
        user_id=user.id,
        client_instance_id=request.client_instance_id,
    )
    if existing is None:
        row = UserPresenceSession(
            user_id=user.id,
            company_id=user.company_id,
            role=role,
            client_instance_id=request.client_instance_id,
            current_path=current_path,
            user_agent_summary=user_agent_summary,
            ip_address_masked=ip_address_masked,
            first_seen_at=now,
            last_seen_at=now,
            last_heartbeat_at=now,
            created_at=now,
            updated_at=now,
        )
        repository.add_presence_session(db_session, row)
        db_session.commit()
        return row

    recent_noop = (
        now - existing.last_heartbeat_at < WRITE_THROTTLE_WINDOW
        and existing.current_path == current_path
        and existing.user_agent_summary == user_agent_summary
        and existing.ip_address_masked == ip_address_masked
        and existing.company_id == user.company_id
        and existing.role == role
    )
    if recent_noop:
        return existing

    existing.company_id = user.company_id
    existing.role = role
    existing.current_path = current_path
    existing.user_agent_summary = user_agent_summary
    existing.ip_address_masked = ip_address_masked
    existing.last_seen_at = now
    existing.last_heartbeat_at = now
    existing.updated_at = now
    db_session.commit()
    return existing


def _display_name(first_name: str | None, last_name: str | None) -> str | None:
    value = " ".join(part for part in [first_name, last_name] if part).strip()
    return value or None


def list_live_logs(
    db_session: Session,
    *,
    search: str | None,
    status_filter: str,
    limit: int,
    offset: int,
    now: datetime | None = None,
) -> LiveLogsResponse:
    now = now or datetime.now(timezone.utc)
    online_since = now - ONLINE_WINDOW
    idle_since = now - IDLE_WINDOW
    recent_since = now - RECENT_WINDOW

    normalized_status = status_filter if status_filter in {"online", "idle", "recent", "all"} else "recent"
    since = None if normalized_status == "all" else recent_since
    rows, total = repository.list_presence_sessions(
        db_session,
        since=since,
        search=(search or "").strip() or None,
        limit=limit,
        offset=offset,
    )

    if normalized_status != "all":
        rows = [
            row
            for row in rows
            if (
                normalized_status == "recent"
                or _status_for(row[0].last_heartbeat_at, now) == normalized_status
            )
        ]
        if normalized_status != "recent":
            total = len(rows)

    today_start = datetime.combine(now.date(), time.min, tzinfo=timezone.utc)
    summary = LiveLogSummary(
        online_now=repository.count_sessions_since(db_session, since=online_since),
        idle=max(
            repository.count_sessions_since(db_session, since=idle_since)
            - repository.count_sessions_since(db_session, since=online_since),
            0,
        ),
        recent_sessions=repository.count_sessions_since(db_session, since=recent_since),
        seen_today=repository.count_seen_today(db_session, since=today_start),
    )

    items: list[LiveLogSessionItem] = []
    for session, user, profile, company in rows:
        status = _status_for(session.last_heartbeat_at, now)
        if normalized_status in {"online", "idle"} and status != normalized_status:
            continue
        items.append(
            LiveLogSessionItem(
                id=session.id,
                user_id=session.user_id,
                user_email=user.email,
                user_display=_display_name(
                    getattr(profile, "first_name", None),
                    getattr(profile, "last_name", None),
                ),
                role=session.role,
                company_id=session.company_id,
                company_name=getattr(company, "name", None),
                current_path=session.current_path,
                user_agent_summary=session.user_agent_summary,
                ip_address_masked=session.ip_address_masked,
                status=status,
                first_seen_at=session.first_seen_at,
                last_seen_at=session.last_seen_at,
                last_heartbeat_at=session.last_heartbeat_at,
            ),
        )

    return LiveLogsResponse(
        summary=summary,
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        server_time_utc=now,
        heartbeat_interval_seconds=60,
    )

