"""API security for workplace <-> Finance project link endpoints."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db_session
from app.main import app
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import SystemRole
from app.modules.finance.access import MODULE_DISABLED, PILOT_DISABLED, PREVIEW_READONLY


def _admin(*, user_id=None, role=SystemRole.ADMIN, company_id=None):
    return SimpleNamespace(
        id=user_id or uuid4(),
        system_role=role,
        company_id=company_id or uuid4(),
        email="workplace-link@example.invalid",
        is_active=True,
    )


def _client_for(actor, db=None) -> TestClient:
    app.dependency_overrides[get_current_user] = lambda: actor
    app.dependency_overrides[get_db_session] = lambda: db if db is not None else MagicMock()
    return TestClient(app)


def _cleanup() -> None:
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_db_session, None)


def test_project_links_blocked_when_finance_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "0")
    client = _client_for(_admin())
    try:
        response = client.get("/api/finance/project-links", params={"company_id": str(uuid4())})
        assert response.status_code == 403
        assert response.json()["detail"] == MODULE_DISABLED
    finally:
        _cleanup()


def test_project_links_blocked_for_non_pilot_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", "production")
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "1")
    pilot_id = uuid4()
    company_id = uuid4()
    monkeypatch.setenv("FINANCE_PILOT_USER_IDS", str(pilot_id))
    monkeypatch.setenv("FINANCE_PILOT_COMPANY_IDS", str(company_id))
    outsider = _admin(role=SystemRole.ADMINISTRATOR, company_id=company_id)
    client = _client_for(outsider)
    try:
        response = client.get("/api/finance/project-links", params={"company_id": str(company_id)})
        assert response.status_code == 403
        assert response.json()["detail"] == PILOT_DISABLED
    finally:
        _cleanup()


def test_initialize_blocked_in_preview_readonly(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "1")
    monkeypatch.setenv("FINANCE_PREVIEW_MODE", "readonly")
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", "local")
    actor = _admin()
    client = _client_for(actor)
    try:
        response = client.post(
            "/api/finance/project-links/initialize",
            params={"company_id": str(actor.company_id)},
            json={"workplace_id": str(uuid4())},
        )
        assert response.status_code == 403
        assert response.json()["detail"] == PREVIEW_READONLY
    finally:
        _cleanup()


def test_dry_run_allowed_when_preview_readonly(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "1")
    monkeypatch.setenv("FINANCE_PREVIEW_MODE", "readonly")
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", "local")
    actor = _admin()
    db = MagicMock()
    db.execute.side_effect = [
        MagicMock(mappings=lambda: iter([])),
        MagicMock(mappings=lambda: iter([])),
    ]
    client = _client_for(actor, db=db)
    try:
        # Patch company scope to accept actor company.
        monkeypatch.setattr(
            "app.modules.finance.commercial_router.resolve_operational_company_id",
            lambda _db, _actor, company_id: company_id or actor.company_id,
        )
        monkeypatch.setattr("app.modules.finance.commercial_router.assert_finance_access", lambda _actor: None)
        monkeypatch.setattr("app.modules.finance.commercial_router.assert_finance_company_access", lambda _cid: None)
        response = client.get("/api/finance/project-links/dry-run", params={"company_id": str(actor.company_id)})
        assert response.status_code == 200
        body = response.json()
        assert body["mode"] == "DRY_RUN"
        assert body["writable"] is False
    finally:
        _cleanup()
