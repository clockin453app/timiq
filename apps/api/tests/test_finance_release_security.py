"""Release-security checks that do not open a database."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.company_scope import CompanyScopeError, resolve_operational_company_id
from app.main import app
from app.modules.auth.dependencies import get_authenticated_user, get_current_user
from app.modules.auth.models import SystemRole
from app.modules.finance.access import (
    MODULE_DISABLED,
    assert_finance_access,
    finance_module_enabled,
)


def test_missing_session_is_rejected_before_a_user_lookup() -> None:
    request = SimpleNamespace(cookies={})
    with pytest.raises(HTTPException) as exc:
        get_authenticated_user(request, db_session=None)  # type: ignore[arg-type]
    assert exc.value.status_code == 401


def test_employee_cannot_open_a_finance_company_scope() -> None:
    company_id = uuid4()
    actor = SimpleNamespace(system_role=SystemRole.EMPLOYEE, company_id=company_id)
    with pytest.raises(CompanyScopeError):
        resolve_operational_company_id(None, actor, company_id)  # type: ignore[arg-type]


def test_production_finance_is_closed_when_the_allowlist_is_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", "production")
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "1")
    monkeypatch.delenv("FINANCE_PILOT_USER_IDS", raising=False)
    actor = SimpleNamespace(id=uuid4(), system_role=SystemRole.ADMINISTRATOR)
    with pytest.raises(HTTPException) as exc:
        assert_finance_access(actor)  # type: ignore[arg-type]
    assert exc.value.status_code == 403


def test_finance_module_defaults_off_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", "production")
    monkeypatch.delenv("FINANCE_MODULE_ENABLED", raising=False)
    assert finance_module_enabled() is False


def test_finance_module_explicit_off_blocks_access(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", "local")
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "0")
    actor = SimpleNamespace(id=uuid4(), system_role=SystemRole.ADMINISTRATOR)
    with pytest.raises(HTTPException) as exc:
        assert_finance_access(actor)  # type: ignore[arg-type]
    assert exc.value.status_code == 403
    assert exc.value.detail == MODULE_DISABLED


def test_finance_module_explicit_on_allows_non_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", "local")
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "1")
    actor = SimpleNamespace(id=uuid4(), system_role=SystemRole.ADMINISTRATOR)
    assert_finance_access(actor)  # type: ignore[arg-type]


def test_finance_api_off_blocks_operations_but_module_status_works(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "0")
    actor = SimpleNamespace(
        id=uuid4(),
        system_role=SystemRole.ADMINISTRATOR,
        company_id=uuid4(),
        email="finance-flag@example.invalid",
        is_active=True,
    )

    def _actor() -> object:
        return actor

    app.dependency_overrides[get_current_user] = _actor
    try:
        client = TestClient(app)
        status = client.get("/api/finance/module-status")
        assert status.status_code == 200
        assert status.json() == {"enabled": False, "readonly": True}

        # preview-mode asserts the module gate without opening a DB session
        blocked = client.get("/api/finance/preview-mode")
        assert blocked.status_code == 403
        assert blocked.json()["detail"] == MODULE_DISABLED
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_finance_api_on_allows_module_status_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "1")
    actor = SimpleNamespace(
        id=uuid4(),
        system_role=SystemRole.ADMINISTRATOR,
        company_id=uuid4(),
        email="finance-flag-on@example.invalid",
        is_active=True,
    )

    def _actor() -> object:
        return actor

    app.dependency_overrides[get_current_user] = _actor
    try:
        client = TestClient(app)
        status = client.get("/api/finance/module-status")
        assert status.status_code == 200
        assert status.json()["enabled"] is True
    finally:
        app.dependency_overrides.pop(get_current_user, None)
