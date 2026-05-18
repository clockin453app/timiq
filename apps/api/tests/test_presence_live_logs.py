"""Presence heartbeat and administrator live logs."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.modules.auth.dependencies import get_authenticated_user
from app.modules.auth.models import SystemRole, User
from app.modules.presence.models import UserPresenceSession
from app.modules.presence.schemas import LiveLogsResponse, PresenceHeartbeatRequest
from app.modules.presence.service import list_live_logs, record_presence_heartbeat, sanitize_current_path


def _user(role: SystemRole, *, company_id: uuid.UUID | None = None) -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        company_id=company_id,
        email=f"{role.value}-{uuid.uuid4()}@example.com",
        password_hash="hashed",
        system_role=role,
        is_active=True,
        created_at=now,
        updated_at=now,
    )


def _presence(user: User, *, last_heartbeat_at: datetime, path: str = "/dashboard") -> UserPresenceSession:
    now = datetime.now(timezone.utc)
    return UserPresenceSession(
        id=uuid.uuid4(),
        user_id=user.id,
        company_id=user.company_id,
        role=user.system_role.value,
        client_instance_id="client-123456",
        current_path=path,
        user_agent_summary="Chrome on Windows desktop",
        ip_address_masked="10.0.0.0",
        first_seen_at=now - timedelta(hours=1),
        last_seen_at=last_heartbeat_at,
        last_heartbeat_at=last_heartbeat_at,
        created_at=now - timedelta(hours=1),
        updated_at=last_heartbeat_at,
    )


def test_heartbeat_creates_presence_session() -> None:
    user = _user(SystemRole.EMPLOYEE, company_id=uuid.uuid4())
    db = MagicMock()
    now = datetime(2026, 5, 18, 12, 0, tzinfo=timezone.utc)
    with patch("app.modules.presence.repository.get_presence_session", return_value=None):
        row = record_presence_heartbeat(
            db,
            user=user,
            request=PresenceHeartbeatRequest(
                client_instance_id="client-123456",
                current_path="/payroll-report?token=secret#frag",
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36",
            ),
            ip_address="192.168.10.45",
            now=now,
        )
    assert row.user_id == user.id
    assert row.company_id == user.company_id
    assert row.role == "employee"
    assert row.current_path == "/payroll-report"
    assert row.user_agent_summary == "Chrome on Windows desktop"
    assert row.ip_address_masked == "192.168.10.0"
    db.commit.assert_called_once()


def test_heartbeat_updates_same_user_and_client_instance() -> None:
    user = _user(SystemRole.ADMIN, company_id=uuid.uuid4())
    existing = _presence(user, last_heartbeat_at=datetime(2026, 5, 18, 12, 0, tzinfo=timezone.utc))
    db = MagicMock()
    with patch("app.modules.presence.repository.get_presence_session", return_value=existing):
        row = record_presence_heartbeat(
            db,
            user=user,
            request=PresenceHeartbeatRequest(
                client_instance_id=existing.client_instance_id,
                current_path="/system/health",
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605.1",
            ),
            ip_address="10.1.2.3",
            now=datetime(2026, 5, 18, 12, 2, tzinfo=timezone.utc),
        )
    assert row.id == existing.id
    assert row.current_path == "/system/health"
    assert row.user_agent_summary == "Safari on macOS desktop"
    assert row.ip_address_masked == "10.1.2.0"
    db.commit.assert_called_once()


def test_heartbeat_allowed_for_non_administrator_authenticated_user() -> None:
    user = _user(SystemRole.EMPLOYEE, company_id=uuid.uuid4())
    client = TestClient(app)
    app.dependency_overrides[get_authenticated_user] = lambda: user
    try:
      with patch("app.modules.presence.router.record_presence_heartbeat") as record:
          response = client.post(
              "/api/presence/heartbeat",
              json={"client_instance_id": "client-123456", "current_path": "/clock", "user_agent": "Mozilla Chrome"},
          )
      assert response.status_code == 200
      record.assert_called_once()
    finally:
        app.dependency_overrides.clear()


def test_heartbeat_strips_query_hash_and_rejects_secret_paths() -> None:
    assert sanitize_current_path("/messages?token=secret#thread") == "/messages"
    assert sanitize_current_path("/reset-password/token/secret-value") is None
    assert sanitize_current_path("C:\\Users\\secret.txt") is None


def test_heartbeat_does_not_store_tokens_cookies_or_secrets() -> None:
    user = _user(SystemRole.EMPLOYEE, company_id=uuid.uuid4())
    db = MagicMock()
    with patch("app.modules.presence.repository.get_presence_session", return_value=None):
        row = record_presence_heartbeat(
            db,
            user=user,
            request=PresenceHeartbeatRequest(
                client_instance_id="client-123456",
                current_path="/profile?cookie=session-token&secret=value",
                user_agent="Mozilla/5.0 (X11; Linux x86_64) Firefox/125.0 private-token",
            ),
            ip_address="203.0.113.77",
            now=datetime(2026, 5, 18, 12, 0, tzinfo=timezone.utc),
        )
    stored = " ".join(str(v) for v in [row.current_path, row.user_agent_summary, row.ip_address_masked])
    assert "cookie" not in stored.lower()
    assert "secret" not in stored.lower()
    assert "token" not in stored.lower()
    assert row.current_path == "/profile"
    assert row.user_agent_summary == "Firefox on Linux desktop"


def test_administrator_can_read_live_logs() -> None:
    admin = _user(SystemRole.ADMINISTRATOR)
    client = TestClient(app)
    app.dependency_overrides[get_authenticated_user] = lambda: admin
    response_payload = LiveLogsResponse(
        summary={"online_now": 0, "idle": 0, "recent_sessions": 0, "seen_today": 0},
        items=[],
        total=0,
        limit=50,
        offset=0,
        server_time_utc=datetime.now(timezone.utc),
    )
    try:
        with patch("app.modules.presence.router.list_live_logs", return_value=response_payload):
            response = client.get("/api/system/live-logs")
        assert response.status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_company_admin_cannot_read_live_logs() -> None:
    admin = _user(SystemRole.ADMIN, company_id=uuid.uuid4())
    client = TestClient(app)
    app.dependency_overrides[get_authenticated_user] = lambda: admin
    try:
        response = client.get("/api/system/live-logs")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_employee_cannot_read_live_logs() -> None:
    employee = _user(SystemRole.EMPLOYEE, company_id=uuid.uuid4())
    client = TestClient(app)
    app.dependency_overrides[get_authenticated_user] = lambda: employee
    try:
        response = client.get("/api/system/live-logs")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_live_logs_statuses_are_based_on_thresholds() -> None:
    now = datetime(2026, 5, 18, 12, 0, tzinfo=timezone.utc)
    user = _user(SystemRole.EMPLOYEE, company_id=uuid.uuid4())
    rows = [
        (_presence(user, last_heartbeat_at=now - timedelta(minutes=1), path="/dashboard"), user, None, None),
        (_presence(user, last_heartbeat_at=now - timedelta(minutes=5), path="/clock"), user, None, None),
        (_presence(user, last_heartbeat_at=now - timedelta(minutes=20), path="/timesheets"), user, None, None),
    ]
    with (
        patch("app.modules.presence.repository.list_presence_sessions", return_value=(rows, 3)),
        patch("app.modules.presence.repository.count_sessions_since", return_value=0),
        patch("app.modules.presence.repository.count_seen_today", return_value=1),
    ):
        response = list_live_logs(MagicMock(), search=None, status_filter="recent", limit=50, offset=0, now=now)
    assert [item.status for item in response.items] == ["online", "idle", "recent"]


def test_live_logs_search_filter_and_limit_are_passed_to_repository() -> None:
    now = datetime(2026, 5, 18, 12, 0, tzinfo=timezone.utc)
    with (
        patch("app.modules.presence.repository.list_presence_sessions", return_value=([], 0)) as list_sessions,
        patch("app.modules.presence.repository.count_sessions_since", return_value=0),
        patch("app.modules.presence.repository.count_seen_today", return_value=0),
    ):
        response = list_live_logs(
            MagicMock(),
            search="New Era /payroll-report",
            status_filter="all",
            limit=25,
            offset=50,
            now=now,
        )
    assert response.limit == 25
    assert response.offset == 50
    list_sessions.assert_called_once()
    kwargs = list_sessions.call_args.kwargs
    assert kwargs["search"] == "New Era /payroll-report"
    assert kwargs["since"] is None
    assert kwargs["limit"] == 25
    assert kwargs["offset"] == 50
