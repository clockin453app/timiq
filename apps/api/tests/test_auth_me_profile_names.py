"""Auth session user responses include the current user's employee profile names."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.auth.dependencies import get_authenticated_user
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_employee_profile_fields_for_user
from app.modules.auth.schemas import build_user_response


def _user() -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        company_id=uuid.uuid4(),
        email="admin@example.com",
        password_hash="hashed",
        system_role=SystemRole.ADMIN,
        is_active=True,
        created_at=now,
        updated_at=now,
    )


def test_build_user_response_includes_profile_names() -> None:
    user = _user()
    response = build_user_response(
        user,
        profile_first_name="Petre",
        profile_last_name="Stelian",
        profile_job_title="Payroll lead",
    )
    assert response.profile_first_name == "Petre"
    assert response.profile_last_name == "Stelian"
    assert response.profile_job_title == "Payroll lead"
    assert response.email == user.email


def test_get_employee_profile_fields_for_user_returns_none_when_missing() -> None:
    db = MagicMock()
    db.execute.return_value.first.return_value = None
    assert get_employee_profile_fields_for_user(db, uuid.uuid4()) == (None, None, None)


def test_get_employee_profile_fields_for_user_strips_whitespace() -> None:
    db = MagicMock()
    db.execute.return_value.first.return_value = ("  Petre ", " Stelian ", " Site manager ")
    first, last, job = get_employee_profile_fields_for_user(db, uuid.uuid4())
    assert first == "Petre"
    assert last == "Stelian"
    assert job == "Site manager"


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_me_includes_profile_names_from_employee_profile(client: TestClient) -> None:
    user = _user()
    app.dependency_overrides[get_authenticated_user] = lambda: user

    try:
        with pytest.MonkeyPatch.context() as patcher:
            patcher.setattr(
                "app.modules.auth.router.get_employee_profile_fields_for_user",
                lambda _db, _uid: ("Petre", "Stelian", "Payroll lead"),
            )
            response = client.get("/api/auth/me")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["profile_first_name"] == "Petre"
    assert body["profile_last_name"] == "Stelian"
    assert body["profile_job_title"] == "Payroll lead"
    assert body["email"] == user.email
