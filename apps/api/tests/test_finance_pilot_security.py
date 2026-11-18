"""Isolated Finance pilot security: user allowlist, company allowlist, readonly, UI status."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import SystemRole
from app.modules.finance.access import (
    COMPANY_DISABLED,
    MODULE_DISABLED,
    PILOT_DISABLED,
    assert_finance_access,
    assert_finance_company_access,
    finance_module_enabled,
    finance_preview_readonly,
    finance_user_authorized,
)
from app.modules.finance.commercial_router import reject_preview_mutation as commercial_guard
from app.modules.finance.commercial_router import router as commercial_router
from app.modules.finance.router import reject_preview_mutation as ledger_guard
from app.modules.finance.router import router as ledger_router


def _admin(*, user_id=None, role=SystemRole.ADMINISTRATOR, company_id=None):
    return SimpleNamespace(
        id=user_id or uuid4(),
        system_role=role,
        company_id=company_id or uuid4(),
        email="pilot@example.invalid",
        is_active=True,
    )


@pytest.mark.parametrize("env_name", ["production", "prod"])
def test_live_like_envs_require_user_and_company_allowlists(
    monkeypatch: pytest.MonkeyPatch,
    env_name: str,
) -> None:
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", env_name)
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "1")
    pilot_id = uuid4()
    company_id = uuid4()
    other_company = uuid4()
    monkeypatch.setenv("FINANCE_PILOT_USER_IDS", str(pilot_id))
    monkeypatch.setenv("FINANCE_PILOT_COMPANY_IDS", str(company_id))

    pilot = _admin(user_id=pilot_id)
    assert_finance_access(pilot)  # type: ignore[arg-type]
    assert_finance_company_access(company_id)

    with pytest.raises(HTTPException) as other_co:
        assert_finance_company_access(other_company)
    assert other_co.value.status_code == 403
    assert other_co.value.detail == COMPANY_DISABLED

    outsider = _admin()
    with pytest.raises(HTTPException) as denied:
        assert_finance_access(outsider)  # type: ignore[arg-type]
    assert denied.value.status_code == 403
    assert denied.value.detail == PILOT_DISABLED


@pytest.mark.parametrize("env_name", ["production", "prod", "staging"])
def test_live_like_empty_or_invalid_pilot_config_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
    env_name: str,
) -> None:
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", env_name)
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "1")
    actor = _admin()

    monkeypatch.delenv("FINANCE_PILOT_USER_IDS", raising=False)
    monkeypatch.delenv("FINANCE_PILOT_COMPANY_IDS", raising=False)
    with pytest.raises(HTTPException) as no_users:
        assert_finance_access(actor)  # type: ignore[arg-type]
    assert no_users.value.status_code == 403

    monkeypatch.setenv("FINANCE_PILOT_USER_IDS", "not-a-uuid")
    monkeypatch.setenv("FINANCE_PILOT_COMPANY_IDS", str(uuid4()))
    with pytest.raises(HTTPException) as bad_users:
        assert_finance_access(actor)  # type: ignore[arg-type]
    assert bad_users.value.status_code == 403

    monkeypatch.setenv("FINANCE_PILOT_USER_IDS", str(actor.id))
    monkeypatch.setenv("FINANCE_PILOT_COMPANY_IDS", "also-bad")
    with pytest.raises(HTTPException) as bad_config:
        assert_finance_access(actor)  # type: ignore[arg-type]
    assert bad_config.value.status_code == 403
    with pytest.raises(HTTPException) as bad_companies:
        assert_finance_company_access(uuid4())
    assert bad_companies.value.status_code == 403

    monkeypatch.setenv("FINANCE_PILOT_COMPANY_IDS", "")
    with pytest.raises(HTTPException) as empty_companies:
        assert_finance_access(actor)  # type: ignore[arg-type]
    assert empty_companies.value.status_code == 403


def test_employee_denied_in_live_like_even_when_listed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", "production")
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "1")
    employee_id = uuid4()
    monkeypatch.setenv("FINANCE_PILOT_USER_IDS", str(employee_id))
    monkeypatch.setenv("FINANCE_PILOT_COMPANY_IDS", str(uuid4()))
    employee = _admin(user_id=employee_id, role=SystemRole.EMPLOYEE)
    with pytest.raises(HTTPException) as denied:
        assert_finance_access(employee)  # type: ignore[arg-type]
    assert denied.value.status_code == 403


def test_module_off_blocks_everything(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", "production")
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "0")
    monkeypatch.setenv("FINANCE_PILOT_USER_IDS", str(uuid4()))
    monkeypatch.setenv("FINANCE_PILOT_COMPANY_IDS", str(uuid4()))
    assert finance_module_enabled() is False
    actor = _admin()
    with pytest.raises(HTTPException) as denied:
        assert_finance_access(actor)  # type: ignore[arg-type]
    assert denied.value.detail == MODULE_DISABLED


def test_readonly_blocks_mutations_on_both_finance_routers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FINANCE_PREVIEW_MODE", "readonly")
    assert finance_preview_readonly() is True
    blocked_path = SimpleNamespace(
        method="POST",
        url=SimpleNamespace(path="/api/finance/project-links/initialize"),
    )
    for guard in (ledger_guard, commercial_guard):
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            with pytest.raises(HTTPException) as denied:
                guard(SimpleNamespace(method=method, url=blocked_path.url))  # type: ignore[arg-type]
            assert denied.value.status_code == 403
        for method in ("GET", "HEAD", "OPTIONS"):
            guard(SimpleNamespace(method=method, url=blocked_path.url))  # type: ignore[arg-type]
    # Ledger remains hard-blocked even on paths that commercial soft-allows.
    with pytest.raises(HTTPException):
        ledger_guard(SimpleNamespace(method="POST", url=SimpleNamespace(path="/api/finance/contract-value")))  # type: ignore[arg-type]
    for finance_router, guard in (
        (ledger_router, ledger_guard),
        (commercial_router, commercial_guard),
    ):
        assert any(getattr(item, "dependency", None) is guard for item in finance_router.dependencies)


def test_module_status_hides_finance_from_non_pilot_in_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", "prod")
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "1")
    pilot_id = uuid4()
    company_id = uuid4()
    monkeypatch.setenv("FINANCE_PILOT_USER_IDS", str(pilot_id))
    monkeypatch.setenv("FINANCE_PILOT_COMPANY_IDS", str(company_id))

    pilot = _admin(user_id=pilot_id, company_id=company_id)
    outsider = _admin()

    app.dependency_overrides[get_current_user] = lambda: pilot
    try:
        client = TestClient(app)
        ok = client.get("/api/finance/module-status")
        assert ok.status_code == 200
        assert ok.json() == {"enabled": True, "readonly": False}
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    monkeypatch.setenv("FINANCE_PREVIEW_MODE", "readonly")
    app.dependency_overrides[get_current_user] = lambda: pilot
    try:
        client = TestClient(app)
        ro = client.get("/api/finance/module-status")
        assert ro.status_code == 200
        assert ro.json() == {"enabled": True, "readonly": True}
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    app.dependency_overrides[get_current_user] = lambda: outsider
    try:
        client = TestClient(app)
        hidden = client.get("/api/finance/module-status")
        assert hidden.status_code == 200
        assert hidden.json() == {"enabled": False, "readonly": True}
        body = hidden.json()
        assert "FINANCE_PILOT" not in str(body)
        assert str(pilot_id) not in str(body)
        assert str(company_id) not in str(body)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_finance_user_authorized_matches_assert_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", "production")
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "1")
    pilot_id = uuid4()
    monkeypatch.setenv("FINANCE_PILOT_USER_IDS", str(pilot_id))
    monkeypatch.setenv("FINANCE_PILOT_COMPANY_IDS", str(uuid4()))
    pilot = _admin(user_id=pilot_id)
    other = _admin()
    assert finance_user_authorized(pilot) is True  # type: ignore[arg-type]
    assert finance_user_authorized(other) is False  # type: ignore[arg-type]
