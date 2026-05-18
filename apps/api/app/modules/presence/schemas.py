from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class PresenceHeartbeatRequest(BaseModel):
    client_instance_id: str = Field(min_length=8, max_length=120)
    current_path: str | None = Field(default=None, max_length=500)
    user_agent: str | None = Field(default=None, max_length=500)


class PresenceHeartbeatResponse(BaseModel):
    ok: bool = True


class LiveLogSummary(BaseModel):
    online_now: int
    idle: int
    recent_sessions: int
    seen_today: int


class LiveLogSessionItem(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    user_email: str
    user_display: str | None = None
    role: str
    company_id: uuid.UUID | None = None
    company_name: str | None = None
    current_path: str | None = None
    user_agent_summary: str | None = None
    ip_address_masked: str | None = None
    status: str
    first_seen_at: datetime
    last_seen_at: datetime
    last_heartbeat_at: datetime


class LiveLogsResponse(BaseModel):
    summary: LiveLogSummary
    items: list[LiveLogSessionItem]
    total: int
    limit: int
    offset: int
    server_time_utc: datetime
    heartbeat_interval_seconds: int = 60
