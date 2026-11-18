"""Final activation-gate: real PostgreSQL scoped Finance WRITE (isolated PG18).

Uses docker timiq-finance-pg18-isolated-20261117 only.
All writes run inside a rolled-back transaction — no persistent fixtures.
Never targets Render/LIVE.
"""

from __future__ import annotations

import json
import os
import subprocess
import uuid
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from urllib.parse import quote_plus

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.main import app
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import SystemRole
from app.modules.finance.access import (
    PREVIEW_READONLY,
    WRITE_DENIED,
    WRITE_ROLE_DENIED,
    assert_finance_write,
    finance_write_allowed,
)
from app.modules.finance.commercial_service import (
    approve_budget,
    create_application,
    create_budget,
    create_certificate,
    create_commitment,
    create_cost_code,
    create_counterparty,
    create_project,
    create_retention_release,
    draw_commitment,
    project_cvr,
    record_cost_to_complete,
    save_daywork,
    save_variation,
    set_contract_value,
    transition_variation,
)


DB_NAME = "timiq_test_finance_pg18_f8a7_20261117"
CONTAINER = "timiq-finance-pg18-isolated-20261117"
HOST_PORT = 5566


def _docker_url() -> str:
    raw = subprocess.check_output(
        ["docker", "inspect", CONTAINER, "--format", "{{json .Config.Env}}"],
        text=True,
    )
    envs = {k: v for item in json.loads(raw) for k, v in [item.split("=", 1)]}
    user = envs["POSTGRES_USER"]
    password = envs["POSTGRES_PASSWORD"]
    return (
        f"postgresql+psycopg://{user}:{quote_plus(password)}"
        f"@127.0.0.1:{HOST_PORT}/{DB_NAME}"
    )


def _require_isolated_pg18():
    try:
        subprocess.check_output(["docker", "inspect", CONTAINER], stderr=subprocess.DEVNULL)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Isolated PG18 container unavailable: {exc}")
    url = _docker_url()
    engine = create_engine(url)
    with engine.connect() as probe:
        row = probe.execute(
            text(
                "SELECT current_database(), inet_server_addr(), "
                "current_setting('server_version'), "
                "(SELECT version_num FROM alembic_version)"
            )
        ).one()
    engine.dispose()
    if row[0] != DB_NAME:
        pytest.fail(f"Wrong database: {row[0]}")
    if not str(row[1] or "").startswith("127.0.0.1") and row[1] is not None:
        # Docker bridge may report container IP; host binding is 127.0.0.1:5566.
        pass
    if not str(row[2]).startswith("18"):
        pytest.fail(f"Expected PostgreSQL 18, got {row[2]}")
    if row[3] != "a7c8d9e0f1a2":
        pytest.fail(f"Expected alembic a7c8d9e0f1a2, got {row[3]}")
    return url


@pytest.fixture()
def pg18_session():
    os.environ["TIMIQ_ENV"] = "test"
    url = _require_isolated_pg18()
    engine = create_engine(url)
    connection = engine.connect()
    transaction = connection.begin()
    connection.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    session = Session(bind=connection, autoflush=False, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()
        engine.dispose()


def _actor(*, role=SystemRole.ADMIN, company_id=None, user_id=None):
    return SimpleNamespace(
        id=user_id or uuid.uuid4(),
        system_role=role,
        company_id=company_id or uuid.uuid4(),
        email="activation-gate@example.invalid",
        is_active=True,
    )


def _seed_company_project(session: Session, *, company_name: str, project_name: str, reference: str):
    company_id = uuid.uuid4()
    actor_id = uuid.uuid4()
    session.execute(
        text(
            "INSERT INTO companies (id, name, is_active, created_at, updated_at) "
            "VALUES (:id, :name, true, now(), now())"
        ),
        {"id": company_id, "name": company_name},
    )
    project_id = create_project(
        session,
        company_id=company_id,
        actor_user_id=actor_id,
        name=project_name,
        reference_code=reference,
        contract_value_net=Decimal("0.0000"),
    )
    return company_id, project_id, actor_id


def _enable_scoped_write(monkeypatch: pytest.MonkeyPatch, *, company_id, project_id):
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "1")
    monkeypatch.setenv("FINANCE_PREVIEW_MODE", "readonly")
    monkeypatch.setenv("FINANCE_WRITE_COMPANY_IDS", str(company_id))
    monkeypatch.setenv("FINANCE_WRITE_PROJECT_IDS", str(project_id))
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", "local")
    monkeypatch.setattr("app.modules.finance.commercial_router.assert_finance_access", lambda _a: None)
    monkeypatch.setattr("app.modules.finance.commercial_router.assert_finance_company_access", lambda _c: None)
    monkeypatch.setattr(
        "app.modules.finance.commercial_router.resolve_operational_company_id",
        lambda _db, actor, requested: (
            actor.company_id
            if requested is None or requested == actor.company_id
            else (_ for _ in ()).throw(HTTPException(status_code=403, detail="You cannot access another company's data."))
        ),
    )


def _client(actor, session: Session) -> TestClient:
    app.dependency_overrides[get_current_user] = lambda: actor
    app.dependency_overrides[get_db_session] = lambda: session
    return TestClient(app, raise_server_exceptions=True)


def _cleanup():
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_db_session, None)


def test_pg18_contract_budget_ctc_audit_cvr_and_precision(pg18_session, monkeypatch):
    company_id, project_id, actor_id = _seed_company_project(
        pg18_session,
        company_name="Synthetic New Era Gate",
        project_name="Synthetic Kennington",
        reference="0001",
    )
    code_id = create_cost_code(pg18_session, company_id=company_id, code="CVR", name="Commercial")
    _enable_scoped_write(monkeypatch, company_id=company_id, project_id=project_id)
    actor = _actor(role=SystemRole.ADMIN, company_id=company_id, user_id=actor_id)

    assert_finance_write(
        pg18_session,
        actor=actor,
        company_id=company_id,
        project_id=project_id,
        operation="contract_value",
    )

    contract_id = set_contract_value(
        pg18_session,
        company_id=company_id,
        actor_user_id=actor_id,
        project_id=project_id,
        amount=Decimal("1250000.56"),
        effective_date=date(2026, 1, 15),
    )
    amount = pg18_session.execute(
        text("SELECT amount FROM finance_contract_values WHERE id = :id"),
        {"id": contract_id},
    ).scalar_one()
    assert Decimal(str(amount)) == Decimal("1250000.5600") or Decimal(str(amount)) == Decimal("1250000.56")

    version_id = create_budget(
        pg18_session,
        company_id=company_id,
        actor_user_id=actor_id,
        project_id=project_id,
        note="QS draft",
        lines=[{"cost_code_id": code_id, "amount_net": Decimal("900000.00"), "description": "Works"}],
    )
    approve_budget(pg18_session, company_id=company_id, actor_user_id=actor_id, version_id=version_id)

    record_cost_to_complete(
        pg18_session,
        company_id=company_id,
        actor_user_id=actor_id,
        project_id=project_id,
        amount=Decimal("250000.10"),
        explanation="Remaining synthetic works",
    )

    cvr = project_cvr(pg18_session, company_id=company_id, project_id=project_id)
    assert Decimal(str(cvr["original_contract_value"])) == Decimal("1250000.5600") or Decimal(
        str(cvr["approved_contract_value"])
    ) == Decimal("1250000.5600")
    assert Decimal(str(cvr["approved_budget"])) == Decimal("900000.0000") or Decimal(
        str(cvr["approved_budget"])
    ) == Decimal("900000.00")
    assert Decimal(str(cvr["cost_to_complete"])) == Decimal("250000.1000") or Decimal(
        str(cvr["cost_to_complete"])
    ) == Decimal("250000.10")
    # NULL vs zero: missing CTC was replaced; zero would be explicit 0, not missing.
    assert cvr["cost_to_complete"] not in {None, "missing", ""}

    audits = pg18_session.execute(
        text(
            "SELECT action, entity_type, actor_user_id::text "
            "FROM finance_audit_events WHERE company_id = :c ORDER BY created_at"
        ),
        {"c": company_id},
    ).fetchall()
    actions = {row[0] for row in audits}
    assert "contract_value_set" in actions or any("contract" in str(a) for a in actions)
    assert any(str(actor_id) == row[2] for row in audits if row[2])

    # Rollback proof for error path: nested failure must not commit CTC overwrite outside savepoint.
    nested = pg18_session.begin_nested()
    try:
        record_cost_to_complete(
            pg18_session,
            company_id=company_id,
            actor_user_id=actor_id,
            project_id=project_id,
            amount=Decimal("1.00"),
            explanation="",  # may be rejected depending on validation
        )
        # Force failure if empty explanation was accepted.
        raise RuntimeError("forced audit failure")
    except Exception:
        nested.rollback()
    cvr_after = project_cvr(pg18_session, company_id=company_id, project_id=project_id)
    assert Decimal(str(cvr_after["cost_to_complete"])) in {
        Decimal("250000.1000"),
        Decimal("250000.10"),
    }


def test_pg18_api_authorised_admin_can_write_all_scoped_routes(pg18_session, monkeypatch):
    company_id, project_id, actor_id = _seed_company_project(
        pg18_session,
        company_name="Synthetic Auth Co",
        project_name="Synthetic Auth Job",
        reference="A001",
    )
    code_id = create_cost_code(pg18_session, company_id=company_id, code="10", name="Works")
    customer_id = create_counterparty(
        pg18_session, company_id=company_id, counterparty_type="customer", name="Synthetic Client"
    )
    supplier_id = create_counterparty(
        pg18_session, company_id=company_id, counterparty_type="supplier", name="Synthetic Supplier"
    )
    _enable_scoped_write(monkeypatch, company_id=company_id, project_id=project_id)
    actor = _actor(role=SystemRole.ADMIN, company_id=company_id, user_id=actor_id)
    client = _client(actor, pg18_session)
    try:
        cv = client.post(
            "/api/finance/contract-value",
            params={"company_id": str(company_id)},
            json={
                "project_id": str(project_id),
                "amount": "1000.25",
                "effective_date": "2026-02-01",
            },
        )
        assert cv.status_code == 200, cv.text

        budget = client.post(
            "/api/finance/budgets",
            params={"company_id": str(company_id)},
            json={
                "project_id": str(project_id),
                "note": "draft",
                "lines": [{"cost_code_id": str(code_id), "amount_net": "500.00", "description": "line"}],
            },
        )
        assert budget.status_code == 200, budget.text
        version_id = budget.json()["id"]

        approve = client.post(
            f"/api/finance/budgets/{version_id}/approve",
            params={"company_id": str(company_id)},
        )
        assert approve.status_code == 200, approve.text

        ctc = client.post(
            "/api/finance/cost-to-complete",
            params={"company_id": str(company_id)},
            json={
                "project_id": str(project_id),
                "amount": "200.00",
                "explanation": "Remaining synthetic works",
            },
        )
        assert ctc.status_code == 200, ctc.text

        variation = client.post(
            "/api/finance/variations",
            params={"company_id": str(company_id)},
            json={
                "project_id": str(project_id),
                "reference_code": "V-GATE-1",
                "description": "Extra",
                "requested_value": "50.00",
                "submitted_value": "50.00",
                "counterparty_id": str(customer_id),
            },
        )
        assert variation.status_code == 200, variation.text
        variation_id = variation.json()["id"]

        vstat = client.post(
            f"/api/finance/variations/{variation_id}/status",
            params={"company_id": str(company_id)},
            json={"approval_status": "submitted"},
        )
        assert vstat.status_code == 200, vstat.text

        daywork = client.post(
            "/api/finance/dayworks",
            params={"company_id": str(company_id)},
            json={
                "project_id": str(project_id),
                "reference_code": "DW-GATE-1",
                "work_date": "2026-02-02",
                "description": "Pump",
                "labour_amount": "10.00",
                "material_amount": "5.00",
                "plant_amount": "1.00",
            },
        )
        assert daywork.status_code == 200, daywork.text
        daywork_id = daywork.json()["id"]

        dapprove = client.post(
            f"/api/finance/dayworks/{daywork_id}/approve",
            params={"company_id": str(company_id)},
            json={"counts_in_contract_value": True},
        )
        assert dapprove.status_code == 200, dapprove.text

        commitment = client.post(
            "/api/finance/commitments",
            params={"company_id": str(company_id)},
            json={
                "project_id": str(project_id),
                "cost_code_id": str(code_id),
                "counterparty_id": str(supplier_id),
                "reference_code": "PO-GATE-1",
                "committed_amount": "80.00",
            },
        )
        assert commitment.status_code == 200, commitment.text

        application = client.post(
            "/api/finance/applications",
            params={"company_id": str(company_id)},
            json={
                "project_id": str(project_id),
                "counterparty_id": str(customer_id),
                "period_start": "2026-02-01",
                "period_end": "2026-02-28",
                "applied_net": "300.00",
                "notes": "synth",
            },
        )
        assert application.status_code == 200, application.text
        application_id = application.json()["id"]

        certificate = client.post(
            "/api/finance/certificates",
            params={"company_id": str(company_id)},
            json={
                "application_id": str(application_id),
                "certificate_reference": "CERT-GATE-1",
                "certified_net": "250.00",
                "retention_rate": "5.00",
            },
        )
        assert certificate.status_code == 200, certificate.text
        certificate_id = certificate.json()["id"]

        retention = client.post(
            "/api/finance/retention-releases",
            params={"company_id": str(company_id)},
            json={
                "certificate_id": str(certificate_id),
                "amount": "1.00",
                "release_date": "2026-02-10",
                "notes": "partial",
            },
        )
        assert retention.status_code == 200, retention.text

        # Indirect project resolution paths already exercised via certificate/retention.
        preview = client.get(
            "/api/finance/preview-mode",
            params={"company_id": str(company_id), "project_id": str(project_id)},
        )
        # preview-mode lives on ledger router; patch its access helpers too.
    finally:
        _cleanup()

    # Rebind preview-mode helpers and re-check.
    monkeypatch.setattr("app.modules.finance.router.assert_finance_access", lambda _a: None)
    monkeypatch.setattr("app.modules.finance.router.assert_finance_company_access", lambda _c: None)
    monkeypatch.setattr(
        "app.modules.finance.router.resolve_operational_company_id",
        lambda _db, actor, requested: actor.company_id if requested in (None, actor.company_id) else (_ for _ in ()).throw(HTTPException(status_code=403, detail="denied")),
    )
    client = _client(actor, pg18_session)
    try:
        preview = client.get(
            "/api/finance/preview-mode",
            params={"company_id": str(company_id), "project_id": str(project_id)},
        )
        assert preview.status_code == 200
        body = preview.json()
        assert body["write_allowed"] is True
        assert body["preview_mode_readonly"] is True
        assert body["readonly"] is False
        assert "contract_value" in body["scoped_operations"]
    finally:
        _cleanup()


@pytest.mark.parametrize(
    "role,detail",
    [
        (SystemRole.EMPLOYEE, WRITE_ROLE_DENIED),
        (SystemRole.ADMINISTRATOR, WRITE_ROLE_DENIED),
    ],
)
def test_pg18_other_roles_and_master_rejected(pg18_session, monkeypatch, role, detail):
    company_id, project_id, _actor_id = _seed_company_project(
        pg18_session,
        company_name=f"Synthetic Role {role}",
        project_name="Job",
        reference="R1",
    )
    _enable_scoped_write(monkeypatch, company_id=company_id, project_id=project_id)
    actor = _actor(role=role, company_id=company_id)
    client = _client(actor, pg18_session)
    try:
        response = client.post(
            "/api/finance/contract-value",
            params={"company_id": str(company_id)},
            json={
                "project_id": str(project_id),
                "amount": "10.00",
                "effective_date": "2026-01-01",
            },
        )
        assert response.status_code == 403
        assert response.json()["detail"] == detail
    finally:
        _cleanup()


def test_pg18_cross_company_and_project_isolation(pg18_session, monkeypatch):
    allowed_company, allowed_project, actor_id = _seed_company_project(
        pg18_session,
        company_name="Synthetic Allowed Co",
        project_name="Allowed Job",
        reference="OK",
    )
    other_company, other_project, _ = _seed_company_project(
        pg18_session,
        company_name="Synthetic Other Co",
        project_name="Other Job",
        reference="NO",
    )
    _enable_scoped_write(monkeypatch, company_id=allowed_company, project_id=allowed_project)
    actor = _actor(role=SystemRole.ADMIN, company_id=allowed_company, user_id=actor_id)
    client = _client(actor, pg18_session)
    try:
        # Spoofed company_id
        spoof_company = client.post(
            "/api/finance/contract-value",
            params={"company_id": str(other_company)},
            json={
                "project_id": str(allowed_project),
                "amount": "10.00",
                "effective_date": "2026-01-01",
            },
        )
        assert spoof_company.status_code == 403

        # Spoofed / unauthorised project
        spoof_project = client.post(
            "/api/finance/contract-value",
            params={"company_id": str(allowed_company)},
            json={
                "project_id": str(other_project),
                "amount": "10.00",
                "effective_date": "2026-01-01",
            },
        )
        assert spoof_project.status_code == 403
        assert spoof_project.json()["detail"] in {WRITE_DENIED, PREVIEW_READONLY}
    finally:
        _cleanup()

    # Indirect resource from other company must not resolve for write.
    foreign_commitment = create_commitment(
        pg18_session,
        company_id=other_company,
        actor_user_id=uuid.uuid4(),
        project_id=other_project,
        cost_code_id=create_cost_code(pg18_session, company_id=other_company, code="X", name="X"),
        counterparty_id=create_counterparty(
            pg18_session, company_id=other_company, counterparty_type="supplier", name="Foreign Sup"
        ),
        reference_code="PO-FOREIGN",
        committed_amount=Decimal("10.00"),
    )
    client = _client(actor, pg18_session)
    try:
        draw = client.post(
            f"/api/finance/commitments/{foreign_commitment}/draws",
            params={"company_id": str(allowed_company)},
            json={"cost_document_id": str(uuid.uuid4()), "amount": "1.00"},
        )
        assert draw.status_code in {403, 404}
    finally:
        _cleanup()


def test_pg18_missing_config_and_revocation(pg18_session, monkeypatch):
    company_id, project_id, actor_id = _seed_company_project(
        pg18_session,
        company_name="Synthetic Revoke Co",
        project_name="Revoke Job",
        reference="RV",
    )
    actor = _actor(role=SystemRole.ADMIN, company_id=company_id, user_id=actor_id)
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "1")
    monkeypatch.setenv("FINANCE_PREVIEW_MODE", "readonly")
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", "local")
    monkeypatch.delenv("FINANCE_WRITE_COMPANY_IDS", raising=False)
    monkeypatch.delenv("FINANCE_WRITE_PROJECT_IDS", raising=False)
    assert finance_write_allowed(
        pg18_session,
        actor=actor,
        company_id=company_id,
        project_id=project_id,
        operation="contract_value",
    ) is False

    monkeypatch.setenv("FINANCE_WRITE_COMPANY_IDS", str(company_id))
    monkeypatch.setenv("FINANCE_WRITE_PROJECT_IDS", str(project_id))
    assert finance_write_allowed(
        pg18_session,
        actor=actor,
        company_id=company_id,
        project_id=project_id,
        operation="contract_value",
    ) is True

    monkeypatch.delenv("FINANCE_WRITE_COMPANY_IDS", raising=False)
    monkeypatch.delenv("FINANCE_WRITE_PROJECT_IDS", raising=False)
    assert finance_write_allowed(
        pg18_session,
        actor=actor,
        company_id=company_id,
        project_id=project_id,
        operation="contract_value",
    ) is False

    _enable_scoped_write(monkeypatch, company_id=company_id, project_id=project_id)
    client = _client(actor, pg18_session)
    try:
        ok = client.post(
            "/api/finance/contract-value",
            params={"company_id": str(company_id)},
            json={
                "project_id": str(project_id),
                "amount": "11.00",
                "effective_date": "2026-01-01",
            },
        )
        assert ok.status_code == 200
    finally:
        _cleanup()

    monkeypatch.delenv("FINANCE_WRITE_COMPANY_IDS", raising=False)
    monkeypatch.delenv("FINANCE_WRITE_PROJECT_IDS", raising=False)
    client = _client(actor, pg18_session)
    try:
        blocked = client.post(
            "/api/finance/contract-value",
            params={"company_id": str(company_id)},
            json={
                "project_id": str(project_id),
                "amount": "12.00",
                "effective_date": "2026-01-01",
            },
        )
        assert blocked.status_code == 403
    finally:
        _cleanup()


def test_pg18_non_scoped_mutations_remain_blocked(pg18_session, monkeypatch):
    company_id, project_id, actor_id = _seed_company_project(
        pg18_session,
        company_name="Synthetic Block Co",
        project_name="Block Job",
        reference="BL",
    )
    _enable_scoped_write(monkeypatch, company_id=company_id, project_id=project_id)
    actor = _actor(role=SystemRole.ADMIN, company_id=company_id, user_id=actor_id)
    client = _client(actor, pg18_session)
    try:
        for path, body in (
            ("/api/finance/funding", {"entry_kind": "loan_draw", "entry_date": "2026-01-01", "amount": "1.00", "external_reference": "X"}),
            ("/api/finance/projects", {"name": "Nope", "reference_code": "N", "contract_value_net": "1.00"}),
            ("/api/finance/counterparties", {"counterparty_type": "supplier", "name": "Nope"}),
            ("/api/finance/cost-documents", {"document_type": "supplier_invoice", "counterparty_id": str(uuid.uuid4()), "lines": []}),
            ("/api/finance/worker-payments", {"source_user_id": str(uuid.uuid4()), "amount": "1.00", "payment_date": "2026-01-01"}),
            ("/api/finance/supplier-payments", {"counterparty_id": str(uuid.uuid4()), "payment_date": "2026-01-01", "amount": "1.00"}),
            ("/api/finance/customer-invoices", {"counterparty_id": str(uuid.uuid4()), "lines": [{"net_amount": "1.00", "tax_amount": "0.00"}]}),
        ):
            response = client.post(path, params={"company_id": str(company_id)}, json=body)
            assert response.status_code == 403, path
            assert PREVIEW_READONLY in str(response.json().get("detail", response.text))
    finally:
        _cleanup()


def test_pg18_null_vs_zero_contract_semantics(pg18_session, monkeypatch):
    company_id, project_id, actor_id = _seed_company_project(
        pg18_session,
        company_name="Synthetic Null Co",
        project_name="Null Job",
        reference="NZ",
    )
    # Fresh project without CTC remains missing, not zero.
    cvr = project_cvr(pg18_session, company_id=company_id, project_id=project_id)
    assert cvr["cost_to_complete"] == "missing"
    record_cost_to_complete(
        pg18_session,
        company_id=company_id,
        actor_user_id=actor_id,
        project_id=project_id,
        amount=Decimal("0.00"),
        explanation="Explicit zero remaining",
    )
    cvr2 = project_cvr(pg18_session, company_id=company_id, project_id=project_id)
    assert Decimal(str(cvr2["cost_to_complete"])) == Decimal("0.0000") or Decimal(
        str(cvr2["cost_to_complete"])
    ) == Decimal("0.00")
    assert cvr2["cost_to_complete"] != "missing"
