"""Transactional email links must use the web app origin (WEB_ORIGIN / TIMIQ_WEB_APP_URL)."""

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.core.email.frontend_urls import (
    build_frontend_url,
    looks_like_api_web_origin,
    resolve_web_origin,
)
from app.modules.auth import account_access_service as access


def test_web_origin_env_sets_email_base() -> None:
    s = Settings(WEB_ORIGIN="https://timiq-web.onrender.com")
    assert resolve_web_origin(s) == "https://timiq-web.onrender.com"


def test_build_frontend_url_encodes_query() -> None:
    s = Settings(TIMIQ_WEB_APP_URL="https://timiq-web.onrender.com/")
    url = build_frontend_url(s, "/reset-password", {"token": "abc def"})
    assert url == "https://timiq-web.onrender.com/reset-password?token=abc+def"
    assert "timiq-api" not in url
    assert url.startswith("https://timiq-web.onrender.com/")


def test_build_frontend_url_paths() -> None:
    s = Settings(WEB_ORIGIN="https://app.example.com")
    assert build_frontend_url(s, "accept-invite", {"token": "t"}) == (
        "https://app.example.com/accept-invite?token=t"
    )
    assert build_frontend_url(s, "/verify-email", {"token": "v"}) == (
        "https://app.example.com/verify-email?token=v"
    )


@pytest.mark.parametrize(
    "origin",
    [
        "https://timiq-api.onrender.com",
        "https://my-api.example.com",
        "https://api.example.com",
    ],
)
def test_looks_like_api_web_origin(origin: str) -> None:
    assert looks_like_api_web_origin(origin)


def test_production_rejects_api_origin_for_web_app() -> None:
    with pytest.raises(ValidationError, match="web app"):
        Settings(
            TIMIQ_ENV="production",
            TIMIQ_WEB_APP_URL="https://timiq-api.onrender.com",
            DATABASE_URL="postgresql+psycopg://u:p@localhost/db",
        )


def test_production_rejects_localhost_web_origin() -> None:
    with pytest.raises(ValidationError, match="localhost"):
        Settings(
            TIMIQ_ENV="production",
            WEB_ORIGIN="http://localhost:3000",
            DATABASE_URL="postgresql+psycopg://u:p@localhost/db",
        )


def test_password_reset_email_body_uses_frontend_path_only() -> None:
    subj, body = access._password_reset_email_body(
        reset_url="https://timiq-web.onrender.com/reset-password?token=secret",
    )
    assert "timiq-api" not in body
    assert "/reset-password?token=secret" in body
    assert "Reset your TimIQ password" in subj


def test_invite_email_includes_company_and_role() -> None:
    from app.modules.auth.models import SystemRole

    _, body = access._invite_email_body(
        invite_url="https://timiq-web.onrender.com/accept-invite?token=x",
        note=None,
        company_name="Acme Ltd",
        role=SystemRole.EMPLOYEE,
    )
    assert "Company: Acme Ltd" in body
    assert "Role: Employee" in body
    assert "timiq-api" not in body
