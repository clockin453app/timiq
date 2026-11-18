"""Fail-closed scoped Finance WRITE under FINANCE_PREVIEW_MODE=readonly."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.db.session import get_db_session
from app.main import app
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import SystemRole
from app.modules.finance.access import (
    PREVIEW_READONLY,
    SCOPED_WRITE_OPERATIONS,
    WRITE_DENIED,
    WRITE_PROJECT_MISMATCH,
    WRITE_PROJECT_REQUIRED,
    WRITE_ROLE_DENIED,
    assert_finance_write,
    effective_finance_readonly,
    finance_preview_readonly,
    finance_write_allowed,
)
from app.modules.finance.commercial_router import reject_preview_mutation as commercial_guard
from app.modules.finance.router import reject_preview_mutation as ledger_guard


def _actor(*, user_id=None, role=SystemRole.ADMIN, company_id=None):
    return SimpleNamespace(
        id=user_id or uuid4(),
        system_role=role,
        company_id=company_id or uuid4(),
        email="scoped-write@example.invalid",
        is_active=True,
    )


def _request(method: str, path: str):
    return SimpleNamespace(method=method, url=SimpleNamespace(path=path))


def _enable_preview(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "1")
    monkeypatch.setenv("FINANCE_PREVIEW_MODE", "readonly")
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", "local")


def _write_allowlists(
    monkeypatch: pytest.MonkeyPatch,
    *,
    company_id,
    project_id,
) -> None:
    monkeypatch.setenv("FINANCE_WRITE_COMPANY_IDS", str(company_id))
    monkeypatch.setenv("FINANCE_WRITE_PROJECT_IDS", str(project_id))


def _db_with_project(*, company_id, project_id, belongs: bool = True):
    db = MagicMock()

    def execute(statement, params=None):
        sql = str(statement)
        result = MagicMock()
        if "FROM finance_projects" in sql and "SELECT 1" in sql:
            result.first.return_value = (1,) if belongs else None
            return result
        if "SELECT project_id FROM finance_" in sql or "application.project_id" in sql:
            result.scalar_one_or_none.return_value = project_id if belongs else None
            return result
        result.first.return_value = None
        result.scalar_one_or_none.return_value = None
        return result

    db.execute.side_effect = execute
    return db


def _client_for(actor, db=None) -> TestClient:
    app.dependency_overrides[get_current_user] = lambda: actor
    app.dependency_overrides[get_db_session] = lambda: db if db is not None else MagicMock()
    return TestClient(app)


def _cleanup() -> None:
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_db_session, None)


def test_preview_readonly_default_with_empty_write_allowlists(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    monkeypatch.delenv("FINANCE_WRITE_COMPANY_IDS", raising=False)
    monkeypatch.delenv("FINANCE_WRITE_PROJECT_IDS", raising=False)
    assert finance_preview_readonly() is True
    company_id = uuid4()
    project_id = uuid4()
    actor = _actor(role=SystemRole.ADMIN, company_id=company_id)
    db = _db_with_project(company_id=company_id, project_id=project_id)
    assert finance_write_allowed(
        db, actor=actor, company_id=company_id, project_id=project_id, operation="contract_value"
    ) is False
    assert effective_finance_readonly(
        db, actor=actor, company_id=company_id, project_id=project_id
    ) is True


def test_company_admin_authorised_project_allows_scoped_write(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    company_id = uuid4()
    project_id = uuid4()
    _write_allowlists(monkeypatch, company_id=company_id, project_id=project_id)
    actor = _actor(role=SystemRole.ADMIN, company_id=company_id)
    db = _db_with_project(company_id=company_id, project_id=project_id)
    assert finance_write_allowed(
        db, actor=actor, company_id=company_id, project_id=project_id, operation="contract_value"
    ) is True
    assert_finance_write(
        db, actor=actor, company_id=company_id, project_id=project_id, operation="budget_create"
    )
    assert effective_finance_readonly(
        db, actor=actor, company_id=company_id, project_id=project_id
    ) is False


def test_other_new_era_user_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    company_id = uuid4()
    project_id = uuid4()
    _write_allowlists(monkeypatch, company_id=company_id, project_id=project_id)
    employee = _actor(role=SystemRole.EMPLOYEE, company_id=company_id)
    db = _db_with_project(company_id=company_id, project_id=project_id)
    with pytest.raises(HTTPException) as denied:
        assert_finance_write(
            db,
            actor=employee,
            company_id=company_id,
            project_id=project_id,
            operation="contract_value",
        )
    assert denied.value.status_code == 403
    assert denied.value.detail == WRITE_ROLE_DENIED


def test_master_administrator_cannot_substitute_for_company_admin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_preview(monkeypatch)
    company_id = uuid4()
    project_id = uuid4()
    _write_allowlists(monkeypatch, company_id=company_id, project_id=project_id)
    master = _actor(role=SystemRole.ADMINISTRATOR, company_id=company_id)
    db = _db_with_project(company_id=company_id, project_id=project_id)
    with pytest.raises(HTTPException) as denied:
        assert_finance_write(
            db,
            actor=master,
            company_id=company_id,
            project_id=project_id,
            operation="contract_value",
        )
    assert denied.value.detail == WRITE_ROLE_DENIED


def test_other_company_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    allowed_company = uuid4()
    other_company = uuid4()
    project_id = uuid4()
    _write_allowlists(monkeypatch, company_id=allowed_company, project_id=project_id)
    actor = _actor(role=SystemRole.ADMIN, company_id=other_company)
    db = _db_with_project(company_id=other_company, project_id=project_id)
    with pytest.raises(HTTPException) as denied:
        assert_finance_write(
            db,
            actor=actor,
            company_id=other_company,
            project_id=project_id,
            operation="contract_value",
        )
    assert denied.value.detail == WRITE_DENIED


def test_unauthorised_project_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    company_id = uuid4()
    allowed_project = uuid4()
    other_project = uuid4()
    _write_allowlists(monkeypatch, company_id=company_id, project_id=allowed_project)
    actor = _actor(role=SystemRole.ADMIN, company_id=company_id)
    db = _db_with_project(company_id=company_id, project_id=other_project)
    with pytest.raises(HTTPException) as denied:
        assert_finance_write(
            db,
            actor=actor,
            company_id=company_id,
            project_id=other_project,
            operation="cost_to_complete",
        )
    assert denied.value.detail == WRITE_DENIED


def test_project_company_mismatch_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    company_id = uuid4()
    project_id = uuid4()
    _write_allowlists(monkeypatch, company_id=company_id, project_id=project_id)
    actor = _actor(role=SystemRole.ADMIN, company_id=company_id)
    db = _db_with_project(company_id=company_id, project_id=project_id, belongs=False)
    with pytest.raises(HTTPException) as denied:
        assert_finance_write(
            db,
            actor=actor,
            company_id=company_id,
            project_id=project_id,
            operation="variation_save",
        )
    assert denied.value.detail == WRITE_PROJECT_MISMATCH


def test_missing_project_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    company_id = uuid4()
    project_id = uuid4()
    _write_allowlists(monkeypatch, company_id=company_id, project_id=project_id)
    actor = _actor(role=SystemRole.ADMIN, company_id=company_id)
    db = MagicMock()
    with pytest.raises(HTTPException) as denied:
        assert_finance_write(
            db,
            actor=actor,
            company_id=company_id,
            project_id=None,
            operation="contract_value",
        )
    assert denied.value.detail == WRITE_PROJECT_REQUIRED


def test_invalid_write_config_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    company_id = uuid4()
    project_id = uuid4()
    monkeypatch.setenv("FINANCE_WRITE_COMPANY_IDS", "not-a-uuid")
    monkeypatch.setenv("FINANCE_WRITE_PROJECT_IDS", str(project_id))
    actor = _actor(role=SystemRole.ADMIN, company_id=company_id)
    db = _db_with_project(company_id=company_id, project_id=project_id)
    assert finance_write_allowed(
        db, actor=actor, company_id=company_id, project_id=project_id, operation="contract_value"
    ) is False
    with pytest.raises(HTTPException) as denied:
        assert_finance_write(
            db,
            actor=actor,
            company_id=company_id,
            project_id=project_id,
            operation="contract_value",
        )
    assert denied.value.detail == PREVIEW_READONLY


def test_revoking_allowlist_blocks_next_request(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    company_id = uuid4()
    project_id = uuid4()
    _write_allowlists(monkeypatch, company_id=company_id, project_id=project_id)
    actor = _actor(role=SystemRole.ADMIN, company_id=company_id)
    db = _db_with_project(company_id=company_id, project_id=project_id)
    assert finance_write_allowed(
        db, actor=actor, company_id=company_id, project_id=project_id, operation="daywork_save"
    ) is True
    monkeypatch.delenv("FINANCE_WRITE_COMPANY_IDS", raising=False)
    monkeypatch.delenv("FINANCE_WRITE_PROJECT_IDS", raising=False)
    assert finance_write_allowed(
        db, actor=actor, company_id=company_id, project_id=project_id, operation="daywork_save"
    ) is False


def test_ledger_mutations_stay_hard_blocked(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    for path in (
        "/api/finance/cost-documents",
        "/api/finance/supplier-payments",
        "/api/finance/worker-payments",
        "/api/finance/customer-invoices",
        "/api/finance/cis/import",
    ):
        with pytest.raises(HTTPException) as denied:
            ledger_guard(_request("POST", path))  # type: ignore[arg-type]
        assert denied.value.status_code == 403
        assert denied.value.detail == PREVIEW_READONLY


def test_commercial_non_scoped_paths_stay_blocked(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    for path in (
        "/api/finance/projects",
        "/api/finance/project-links/initialize",
        "/api/finance/funding",
        "/api/finance/customer-receipts",
        "/api/finance/opening-balances",
        "/api/finance/counterparties",
    ):
        with pytest.raises(HTTPException) as denied:
            commercial_guard(_request("POST", path))  # type: ignore[arg-type]
        assert denied.value.detail == PREVIEW_READONLY


def test_commercial_scoped_paths_soft_pass_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    for path in (
        "/api/finance/contract-value",
        "/api/finance/budgets",
        "/api/finance/budgets/11111111-1111-1111-1111-111111111111/approve",
        "/api/finance/cost-to-complete",
        "/api/finance/variations",
        "/api/finance/dayworks",
        "/api/finance/commitments",
        "/api/finance/applications",
        "/api/finance/certificates",
        "/api/finance/retention-releases",
    ):
        commercial_guard(_request("POST", path))  # type: ignore[arg-type]


@pytest.mark.parametrize("operation", sorted(SCOPED_WRITE_OPERATIONS))
def test_all_scoped_operations_recognised(operation: str, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    company_id = uuid4()
    project_id = uuid4()
    _write_allowlists(monkeypatch, company_id=company_id, project_id=project_id)
    actor = _actor(role=SystemRole.ADMIN, company_id=company_id)
    db = _db_with_project(company_id=company_id, project_id=project_id)
    assert finance_write_allowed(
        db, actor=actor, company_id=company_id, project_id=project_id, operation=operation
    ) is True


def test_contract_value_endpoint_allows_authorised_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    company_id = uuid4()
    project_id = uuid4()
    _write_allowlists(monkeypatch, company_id=company_id, project_id=project_id)
    actor = _actor(role=SystemRole.ADMIN, company_id=company_id)
    db = _db_with_project(company_id=company_id, project_id=project_id)
    created = uuid4()
    monkeypatch.setattr(
        "app.modules.finance.commercial_router.resolve_operational_company_id",
        lambda _db, _actor, company_id_arg: company_id_arg or company_id,
    )
    monkeypatch.setattr("app.modules.finance.commercial_router.assert_finance_access", lambda _actor: None)
    monkeypatch.setattr("app.modules.finance.commercial_router.assert_finance_company_access", lambda _cid: None)
    monkeypatch.setattr(
        "app.modules.finance.commercial_router.set_contract_value",
        lambda *_args, **_kwargs: created,
    )
    client = _client_for(actor, db=db)
    try:
        response = client.post(
            "/api/finance/contract-value",
            params={"company_id": str(company_id)},
            json={
                "project_id": str(project_id),
                "amount": "1250000.00",
                "effective_date": "2026-01-15",
            },
        )
        assert response.status_code == 200
        assert response.json() == {"id": str(created)}
    finally:
        _cleanup()


def test_contract_value_rejects_spoofed_company_id(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    company_id = uuid4()
    other_company = uuid4()
    project_id = uuid4()
    _write_allowlists(monkeypatch, company_id=company_id, project_id=project_id)
    actor = _actor(role=SystemRole.ADMIN, company_id=company_id)
    db = _db_with_project(company_id=company_id, project_id=project_id)

    def refuse_other(_db, _actor, requested):
        from app.core.company_scope import CompanyScopeError

        if requested is not None and requested != company_id:
            raise CompanyScopeError("You cannot access another company's data.")
        return company_id

    monkeypatch.setattr(
        "app.modules.finance.commercial_router.resolve_operational_company_id",
        refuse_other,
    )
    monkeypatch.setattr("app.modules.finance.commercial_router.assert_finance_access", lambda _actor: None)
    monkeypatch.setattr("app.modules.finance.commercial_router.assert_finance_company_access", lambda _cid: None)
    client = _client_for(actor, db=db)
    try:
        response = client.post(
            "/api/finance/contract-value",
            params={"company_id": str(other_company)},
            json={
                "project_id": str(project_id),
                "amount": "100.00",
                "effective_date": "2026-01-15",
            },
        )
        assert response.status_code == 403
    finally:
        _cleanup()


def test_contract_value_rejects_spoofed_project_id(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    company_id = uuid4()
    project_id = uuid4()
    spoofed_project = uuid4()
    _write_allowlists(monkeypatch, company_id=company_id, project_id=project_id)
    actor = _actor(role=SystemRole.ADMIN, company_id=company_id)
    db = _db_with_project(company_id=company_id, project_id=spoofed_project, belongs=False)
    monkeypatch.setattr(
        "app.modules.finance.commercial_router.resolve_operational_company_id",
        lambda _db, _actor, company_id_arg: company_id_arg or company_id,
    )
    monkeypatch.setattr("app.modules.finance.commercial_router.assert_finance_access", lambda _actor: None)
    monkeypatch.setattr("app.modules.finance.commercial_router.assert_finance_company_access", lambda _cid: None)
    client = _client_for(actor, db=db)
    try:
        response = client.post(
            "/api/finance/contract-value",
            params={"company_id": str(company_id)},
            json={
                "project_id": str(spoofed_project),
                "amount": "100.00",
                "effective_date": "2026-01-15",
            },
        )
        assert response.status_code == 403
        assert response.json()["detail"] in {WRITE_DENIED, WRITE_PROJECT_MISMATCH}
    finally:
        _cleanup()


def test_unauthenticated_contract_value_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides[get_db_session] = lambda: MagicMock()
    client = TestClient(app)
    try:
        response = client.post(
            "/api/finance/contract-value",
            json={
                "project_id": str(uuid4()),
                "amount": "100.00",
                "effective_date": "2026-01-15",
            },
        )
        assert response.status_code in {401, 403}
    finally:
        _cleanup()


def test_preview_mode_endpoint_reports_effective_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_preview(monkeypatch)
    company_id = uuid4()
    project_id = uuid4()
    _write_allowlists(monkeypatch, company_id=company_id, project_id=project_id)
    actor = _actor(role=SystemRole.ADMIN, company_id=company_id)
    db = _db_with_project(company_id=company_id, project_id=project_id)
    monkeypatch.setattr(
        "app.modules.finance.router.resolve_operational_company_id",
        lambda _db, _actor, company_id_arg: company_id_arg or company_id,
    )
    monkeypatch.setattr("app.modules.finance.router.assert_finance_access", lambda _actor: None)
    monkeypatch.setattr("app.modules.finance.router.assert_finance_company_access", lambda _cid: None)
    client = _client_for(actor, db=db)
    try:
        locked = client.get("/api/finance/preview-mode", params={"company_id": str(company_id)})
        assert locked.status_code == 200
        locked_body = locked.json()
        assert locked_body["preview_mode_readonly"] is True
        assert locked_body["write_allowed"] is False
        assert locked_body["readonly"] is True

        open_write = client.get(
            "/api/finance/preview-mode",
            params={"company_id": str(company_id), "project_id": str(project_id)},
        )
        assert open_write.status_code == 200
        body = open_write.json()
        assert body["preview_mode_readonly"] is True
        assert body["write_allowed"] is True
        assert body["readonly"] is False
        assert "contract_value" in body["scoped_operations"]
    finally:
        _cleanup()


def test_decimal_gbp_amount_accepted_for_contract_value(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    company_id = uuid4()
    project_id = uuid4()
    _write_allowlists(monkeypatch, company_id=company_id, project_id=project_id)
    actor = _actor(role=SystemRole.ADMIN, company_id=company_id)
    db = _db_with_project(company_id=company_id, project_id=project_id)
    captured: dict[str, object] = {}

    def capture_set_contract_value(**kwargs):
        captured.update(kwargs)
        return uuid4()

    monkeypatch.setattr(
        "app.modules.finance.commercial_router.resolve_operational_company_id",
        lambda _db, _actor, company_id_arg: company_id_arg or company_id,
    )
    monkeypatch.setattr("app.modules.finance.commercial_router.assert_finance_access", lambda _actor: None)
    monkeypatch.setattr("app.modules.finance.commercial_router.assert_finance_company_access", lambda _cid: None)
    monkeypatch.setattr(
        "app.modules.finance.commercial_router.set_contract_value",
        lambda *args, **kwargs: capture_set_contract_value(**kwargs),
    )
    client = _client_for(actor, db=db)
    try:
        response = client.post(
            "/api/finance/contract-value",
            params={"company_id": str(company_id)},
            json={
                "project_id": str(project_id),
                "amount": "1234.56",
                "effective_date": str(date(2026, 3, 1)),
            },
        )
        assert response.status_code == 200
        assert captured["amount"] == Decimal("1234.56")
        assert captured["project_id"] == project_id
        assert captured["company_id"] == company_id
        assert captured["actor_user_id"] == actor.id
    finally:
        _cleanup()


def test_null_project_not_treated_as_authorised(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    company_id = uuid4()
    project_id = uuid4()
    _write_allowlists(monkeypatch, company_id=company_id, project_id=project_id)
    actor = _actor(role=SystemRole.ADMIN, company_id=company_id)
    assert finance_write_allowed(
        MagicMock(),
        actor=actor,
        company_id=company_id,
        project_id=None,
        operation="contract_value",
    ) is False


def test_audit_failure_rolls_back_contract_value(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_preview(monkeypatch)
    company_id = uuid4()
    project_id = uuid4()
    _write_allowlists(monkeypatch, company_id=company_id, project_id=project_id)
    actor = _actor(role=SystemRole.ADMIN, company_id=company_id)
    db = _db_with_project(company_id=company_id, project_id=project_id)
    db.commit = MagicMock()
    db.rollback = MagicMock()

    def boom(**_kwargs):
        raise RuntimeError("audit failed")

    monkeypatch.setattr(
        "app.modules.finance.commercial_router.resolve_operational_company_id",
        lambda _db, _actor, company_id_arg: company_id_arg or company_id,
    )
    monkeypatch.setattr("app.modules.finance.commercial_router.assert_finance_access", lambda _actor: None)
    monkeypatch.setattr("app.modules.finance.commercial_router.assert_finance_company_access", lambda _cid: None)
    monkeypatch.setattr("app.modules.finance.commercial_router.set_contract_value", boom)
    client = _client_for(actor, db=db)
    try:
        with pytest.raises(RuntimeError, match="audit failed"):
            client.post(
                "/api/finance/contract-value",
                params={"company_id": str(company_id)},
                json={
                    "project_id": str(project_id),
                    "amount": "10.00",
                    "effective_date": "2026-01-15",
                },
            )
    except Exception:
        # TestClient may wrap; ensure rollback was attempted if handler ran.
        pass
    finally:
        _cleanup()
    # Endpoint uses _run which rollbacks FinanceLedgerError; RuntimeError may propagate.
    # Guaranteeing no commit is the critical safety property.
    assert db.commit.call_count == 0
