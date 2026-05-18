from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import get_current_user, require_administrator
from app.modules.auth.models import User
from app.modules.presence.schemas import (
    LiveLogsResponse,
    PresenceHeartbeatRequest,
    PresenceHeartbeatResponse,
)
from app.modules.presence.service import list_live_logs, record_presence_heartbeat

router = APIRouter(tags=["presence"])


@router.post("/api/presence/heartbeat", response_model=PresenceHeartbeatResponse)
def heartbeat(
    body: PresenceHeartbeatRequest,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> PresenceHeartbeatResponse:
    ip_address = request.client.host if request.client else None
    record_presence_heartbeat(
        db_session,
        user=current_user,
        request=body,
        ip_address=ip_address,
    )
    return PresenceHeartbeatResponse()


@router.get("/api/system/live-logs", response_model=LiveLogsResponse)
def read_live_logs(
    db_session: Session = Depends(get_db_session),
    _current_user: User = Depends(require_administrator),
    search: str | None = Query(default=None, max_length=120),
    status: str = Query(default="recent", pattern="^(online|idle|recent|all)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=50_000),
) -> LiveLogsResponse:
    return list_live_logs(
        db_session,
        search=search,
        status_filter=status,
        limit=limit,
        offset=offset,
    )
