"""Security gates for GET /api/finance/cvr/source-breakdown (no persistent DB writes)."""

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
from app.modules.finance.access import COMPANY_DISABLED, MODULE_DISABLED, PILOT_DISABLED
from app.modules.finance.cvr_source_breakdown import (
    SUPPORTED_METRICS,
    _require_project,
    build_cvr_source_breakdown,
)
from app.modules.finance.ledger_service import FinanceLedgerError


def _admin(*, user_id=None, role=SystemRole.ADMIN, company_id=None):
    return SimpleNamespace(
        id=user_id or uuid4(),
        system_role=role,
        company_id=company_id or uuid4(),
        email="cvr-security@example.invalid",
        is_active=True,
    )


def _client_for(actor) -> TestClient:
    app.dependency_overrides[get_current_user] = lambda: actor
    app.dependency_overrides[get_db_session] = lambda: MagicMock()
    return TestClient(app)


def _cleanup() -> None:
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_db_session, None)


def test_source_breakdown_blocked_when_finance_module_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "0")
    actor = _admin()
    client = _client_for(actor)
    try:
        response = client.get(
            "/api/finance/cvr/source-breakdown",
            params={
                "project_id": str(uuid4()),
                "metric": "actual_eligible",
                "company_id": str(actor.company_id),
            },
        )
        assert response.status_code == 403
        assert response.json()["detail"] == MODULE_DISABLED
    finally:
        _cleanup()


def test_source_breakdown_blocked_for_non_pilot_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", "production")
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "1")
    pilot_id = uuid4()
    company_id = uuid4()
    monkeypatch.setenv("FINANCE_PILOT_USER_IDS", str(pilot_id))
    monkeypatch.setenv("FINANCE_PILOT_COMPANY_IDS", str(company_id))

    outsider = _admin(role=SystemRole.ADMINISTRATOR, company_id=company_id)
    client = _client_for(outsider)
    try:
        response = client.get(
            "/api/finance/cvr/source-breakdown",
            params={
                "project_id": str(uuid4()),
                "metric": "actual_eligible",
                "company_id": str(company_id),
            },
        )
        assert response.status_code == 403
        assert response.json()["detail"] == PILOT_DISABLED
    finally:
        _cleanup()


def test_source_breakdown_blocked_for_unauthorized_company(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", "production")
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "1")
    pilot_id = uuid4()
    allowed_company = uuid4()
    other_company = uuid4()
    monkeypatch.setenv("FINANCE_PILOT_USER_IDS", str(pilot_id))
    monkeypatch.setenv("FINANCE_PILOT_COMPANY_IDS", str(allowed_company))

    pilot = _admin(user_id=pilot_id, role=SystemRole.ADMIN, company_id=allowed_company)
    client = _client_for(pilot)
    try:
        response = client.get(
            "/api/finance/cvr/source-breakdown",
            params={
                "project_id": str(uuid4()),
                "metric": "actual_eligible",
                "company_id": str(other_company),
            },
        )
        assert response.status_code == 403
        detail = str(response.json().get("detail", ""))
        assert "another company" in detail.lower() or detail == COMPANY_DISABLED
    finally:
        _cleanup()


def test_source_breakdown_pilot_readonly_allows_get(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", "production")
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "1")
    monkeypatch.setenv("FINANCE_PREVIEW_MODE", "readonly")
    pilot_id = uuid4()
    company_id = uuid4()
    monkeypatch.setenv("FINANCE_PILOT_USER_IDS", str(pilot_id))
    monkeypatch.setenv("FINANCE_PILOT_COMPANY_IDS", str(company_id))

    pilot = _admin(user_id=pilot_id, role=SystemRole.ADMIN, company_id=company_id)
    project_id = uuid4()
    payload = {
        "metric": "actual_eligible",
        "company_id": str(company_id),
        "project_id": str(project_id),
        "displayed_total": "10.0000",
        "formula": "test",
        "basis": "test",
        "reconcilable": True,
        "verification": "RECONCILED",
        "difference": "0.0000",
        "source_total": "10.0000",
        "groups": [],
        "warnings": [],
    }
    monkeypatch.setattr(
        "app.modules.finance.commercial_router.build_cvr_source_breakdown",
        lambda *args, **kwargs: payload,
    )
    client = _client_for(pilot)
    try:
        response = client.get(
            "/api/finance/cvr/source-breakdown",
            params={
                "project_id": str(project_id),
                "metric": "actual_eligible",
                "company_id": str(company_id),
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["company_id"] == str(company_id)
        assert body["project_id"] == str(project_id)
        assert "groups" in body
    finally:
        _cleanup()


def test_unsupported_metric_rejected_before_document_exposure() -> None:
    with pytest.raises(FinanceLedgerError) as exc:
        build_cvr_source_breakdown(
            MagicMock(),
            company_id=uuid4(),
            project_id=uuid4(),
            metric="invented_metric",
        )
    assert exc.value.code == "INVALID_METRIC"
    assert "Unsupported metric" in exc.value.message


def test_project_from_other_company_is_not_found() -> None:
    session = MagicMock()
    session.execute.return_value.scalar.return_value = None
    company_id = uuid4()
    project_id = uuid4()
    with pytest.raises(FinanceLedgerError) as exc:
        _require_project(session, company_id=company_id, project_id=project_id)
    assert exc.value.code == "NOT_FOUND"
    bound = session.execute.call_args.args[1]
    assert bound["company_id"] == company_id
    assert bound["project_id"] == project_id


def test_cost_breakdown_sql_joins_stay_company_scoped() -> None:
    from app.modules.finance.cvr_source_breakdown import COST_BREAKDOWN_SQL

    assert "company_id = :company_id" in COST_BREAKDOWN_SQL
    assert "document.company_id = line.company_id" in COST_BREAKDOWN_SQL
    assert "line.company_id = allocation.company_id" in COST_BREAKDOWN_SQL
    assert "code.company_id = allocation.company_id" in COST_BREAKDOWN_SQL


def test_supported_metrics_include_cost_to_date_without_inventing_registers() -> None:
    assert "cost_to_date" in SUPPORTED_METRICS
    assert "actual_eligible" in SUPPORTED_METRICS
    assert "cis_labour_gross" not in SUPPORTED_METRICS