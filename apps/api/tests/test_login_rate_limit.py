"""Login rate-limit unit and route tests (no production database)."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db_session
from app.main import app
from app.modules.auth import login_rate_limit as limiter
from app.modules.auth.login_rate_limit import (
    MAX_FAILURES_PER_EMAIL_IP,
    check_login_allowed,
    record_login_failure,
    record_login_success,
    reset_login_rate_limit_state_for_tests,
)


@pytest.fixture(autouse=True)
def _clear_limiter() -> None:
    reset_login_rate_limit_state_for_tests()
    yield
    reset_login_rate_limit_state_for_tests()
    app.dependency_overrides.clear()


def test_email_normalisation_shares_bucket() -> None:
    assert check_login_allowed(email="User@Example.COM", client_ip="1.2.3.4")[0] is True
    for _ in range(MAX_FAILURES_PER_EMAIL_IP):
        allowed, _ = record_login_failure(email="user@example.com", client_ip="1.2.3.4")
    assert allowed is False
    allowed, retry = check_login_allowed(email="USER@example.com", client_ip="1.2.3.4")
    assert allowed is False
    assert retry is not None and retry >= 1


def test_distinct_ips_are_independent_until_email_cap() -> None:
    for _ in range(MAX_FAILURES_PER_EMAIL_IP - 1):
        record_login_failure(email="a@example.com", client_ip="10.0.0.1")
    assert check_login_allowed(email="a@example.com", client_ip="10.0.0.2")[0] is True


def test_successful_login_resets_email_ip_bucket() -> None:
    for _ in range(MAX_FAILURES_PER_EMAIL_IP - 1):
        record_login_failure(email="ok@example.com", client_ip="9.9.9.9")
    record_login_success(email="ok@example.com", client_ip="9.9.9.9")
    assert check_login_allowed(email="ok@example.com", client_ip="9.9.9.9")[0] is True
    for _ in range(MAX_FAILURES_PER_EMAIL_IP - 1):
        allowed, _ = record_login_failure(email="ok@example.com", client_ip="9.9.9.9")
        assert allowed is True


def test_cooldown_expires(monkeypatch: pytest.MonkeyPatch) -> None:
    now = {"t": 1_000_000.0}

    def fake_time() -> float:
        return now["t"]

    monkeypatch.setattr(limiter.time, "time", fake_time)
    for _ in range(MAX_FAILURES_PER_EMAIL_IP):
        record_login_failure(email="cool@example.com", client_ip="8.8.8.8")
    assert check_login_allowed(email="cool@example.com", client_ip="8.8.8.8")[0] is False
    now["t"] += limiter.COOLDOWN_SECONDS + 1
    assert check_login_allowed(email="cool@example.com", client_ip="8.8.8.8")[0] is True


def test_login_endpoint_returns_generic_401_and_429(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.modules.auth.router.authenticate_user",
        lambda db_session, email, password: None,
    )

    def override_db():
        yield MagicMock()

    app.dependency_overrides[get_db_session] = override_db
    client = TestClient(app)

    for _ in range(MAX_FAILURES_PER_EMAIL_IP - 1):
        response = client.post(
            "/api/auth/login",
            json={"email": "nobody@example.com", "password": "wrong-password-9"},
        )
        assert response.status_code == 401, response.text
        assert response.json()["detail"] == "Invalid email or password."

    response = client.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": "wrong-password-9"},
    )
    assert response.status_code == 429, response.text
    assert "Retry-After" in response.headers
    assert response.json()["detail"] == "Too many login attempts. Try again later."
    # Submitted password must never appear in the response body.
    assert "wrong-password-9" not in response.text
