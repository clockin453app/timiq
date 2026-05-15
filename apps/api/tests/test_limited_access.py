"""Deactivated employee limited self-service access."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from app.main import app
from app.modules.auth.dependencies import (
    get_authenticated_user,
    require_authenticated_employee_self_service,
)
from app.modules.auth.limited_access import has_limited_access, may_login_while_inactive
from app.modules.auth.models import SystemRole, User
from app.modules.auth.schemas import build_user_response
from app.modules.auth.service import authenticate_user


def _user(*, active: bool, role: SystemRole = SystemRole.EMPLOYEE) -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        company_id=uuid.uuid4(),
        email="user@example.com",
        password_hash="hashed",
        system_role=role,
        is_active=active,
        created_at=now,
        updated_at=now,
    )


def test_has_limited_access_only_inactive_employee() -> None:
    assert has_limited_access(_user(active=False, role=SystemRole.EMPLOYEE))
    assert not has_limited_access(_user(active=True, role=SystemRole.EMPLOYEE))
    assert not has_limited_access(_user(active=False, role=SystemRole.ADMIN))
    assert not has_limited_access(_user(active=False, role=SystemRole.ADMINISTRATOR))


def test_may_login_while_inactive() -> None:
    assert may_login_while_inactive(_user(active=False, role=SystemRole.EMPLOYEE))
    assert not may_login_while_inactive(_user(active=False, role=SystemRole.ADMIN))


def test_build_user_response_limited_access_flag() -> None:
    limited = build_user_response(_user(active=False, role=SystemRole.EMPLOYEE))
    assert limited.is_active is False
    assert limited.limited_access is True
    active = build_user_response(_user(active=True, role=SystemRole.EMPLOYEE))
    assert active.limited_access is False


def test_authenticate_inactive_employee_with_password(monkeypatch: pytest.MonkeyPatch) -> None:
    user = _user(active=False, role=SystemRole.EMPLOYEE)

    def fake_get_user(_db, _email):
        return user

    def fake_verify(_password, _hash):
        return True

    monkeypatch.setattr("app.modules.auth.service.get_user_by_email", fake_get_user)
    monkeypatch.setattr("app.modules.auth.service.verify_password", fake_verify)

    assert authenticate_user(None, user.email, "secret") is user


def test_authenticate_inactive_admin_blocked(monkeypatch: pytest.MonkeyPatch) -> None:
    user = _user(active=False, role=SystemRole.ADMIN)

    monkeypatch.setattr(
        "app.modules.auth.service.get_user_by_email",
        lambda _db, _email: user,
    )
    monkeypatch.setattr(
        "app.modules.auth.service.verify_password",
        lambda _password, _hash: True,
    )

    assert authenticate_user(None, user.email, "secret") is None


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_me_reports_limited_access(client: TestClient) -> None:
    user = _user(active=False, role=SystemRole.EMPLOYEE)
    app.dependency_overrides[get_authenticated_user] = lambda: user
    try:
        response = client.get("/api/auth/me")
        assert response.status_code == 200
        body = response.json()
        assert body["limited_access"] is True
        assert body["is_active"] is False
    finally:
        app.dependency_overrides.clear()


def test_clock_status_blocked_for_deactivated(client: TestClient) -> None:
    user = _user(active=False, role=SystemRole.EMPLOYEE)
    app.dependency_overrides[get_authenticated_user] = lambda: user
    try:
        response = client.get("/api/time-clock/status")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_timesheets_me_allowed_for_limited(client: TestClient) -> None:
    user = _user(active=False, role=SystemRole.EMPLOYEE)

    def override_user() -> User:
        return user

    app.dependency_overrides[require_authenticated_employee_self_service] = override_user
    try:
        # Missing week_start → 422 proves auth passed (not 401/403).
        response = client.get("/api/timesheets/me/week")
        assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_messaging_blocked_for_deactivated(client: TestClient) -> None:
    user = _user(active=False, role=SystemRole.EMPLOYEE)
    app.dependency_overrides[get_authenticated_user] = lambda: user
    try:
        response = client.get("/api/messaging/conversations")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_leave_blocked_for_deactivated(client: TestClient) -> None:
    user = _user(active=False, role=SystemRole.EMPLOYEE)
    app.dependency_overrides[get_authenticated_user] = lambda: user
    try:
        response = client.get("/api/leave/me")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_admin_users_blocked_for_deactivated(client: TestClient) -> None:
    user = _user(active=False, role=SystemRole.EMPLOYEE)
    app.dependency_overrides[get_authenticated_user] = lambda: user
    try:
        response = client.get("/api/auth/users")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_rams_list_blocked_for_deactivated(client: TestClient) -> None:
    user = _user(active=False, role=SystemRole.EMPLOYEE)
    app.dependency_overrides[get_authenticated_user] = lambda: user
    try:
        response = client.get("/api/rams/me")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()
