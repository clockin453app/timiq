"""Dual independent PG18 cycles for VAT recoverability migration c9d0e1f2a3b4."""
from __future__ import annotations

import json
import subprocess
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote_plus

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.session import get_db_session
from app.main import app
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import SystemRole
from app.modules.finance.access import WRITE_DENIED, WRITE_ROLE_DENIED
from app.modules.finance.commercial_service import (
    create_cost_code,
    create_counterparty,
    create_project,
    project_cvr,
    record_cost_to_complete,
    set_contract_value,
)
from app.modules.finance.cost_register_errors import CostRegisterError
from app.modules.finance.cost_register_schemas import CostAllocationInput, CostDraftInput, CostLineInput
from app.modules.finance.cost_register_service import create_cost_draft, get_cost_document, post_cost_document

CONTAINER = "timiq-finance-pg18-isolated-20261117"
HOST_PORT = 5566
SOURCE_B8_DB = "timiq_test_finance_pg18_f8a7_20261117"
ENV_FILE = Path(__file__).resolve().parents[1] / "_pg18_env.json"
DUMP_PATH = Path(__file__).resolve().parents[1] / "_b8_schema_dump.sql"


def _env():
    if not ENV_FILE.exists():
        pytest.skip("PG18 env helper missing")
    return json.loads(ENV_FILE.read_text(encoding="utf-8"))


def _url(db_name: str) -> str:
    env = _env()
    return f"postgresql+psycopg://{env['user']}:{quote_plus(env['password'])}@127.0.0.1:{HOST_PORT}/{db_name}"


def _psql(db_name: str, sql: str) -> None:
    env = _env()
    subprocess.check_call(
        ["docker", "exec", "-e", f"PGPASSWORD={env['password']}", CONTAINER, "psql", "-U", env["user"], "-d", db_name, "-v", "ON_ERROR_STOP=1", "-c", sql],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )


def _require_docker_b8() -> None:
    try:
        subprocess.check_output(["docker", "inspect", CONTAINER], stderr=subprocess.DEVNULL)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Isolated PG18 container unavailable: {exc}")
    engine = create_engine(_url(SOURCE_B8_DB))
    with engine.connect() as conn:
        row = conn.execute(text("SELECT current_database(), current_setting('server_version'), (SELECT version_num FROM alembic_version), EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_cost_lines' AND column_name='vat_recoverability_status')")).one()
    engine.dispose()
    assert row[0] == SOURCE_B8_DB
    assert str(row[1]).startswith("18")
    assert row[2] == "b8c9d0e1f2a3"
    assert not row[3]


def _dump_b8_schema() -> None:
    env = _env()
    raw = subprocess.check_output(["docker", "exec", "-e", f"PGPASSWORD={env['password']}", CONTAINER, "pg_dump", "-U", env["user"], "-d", SOURCE_B8_DB, "--schema-only", "--no-owner", "--no-privileges"], text=True)
    DUMP_PATH.write_text(raw, encoding="utf-8")


def _drop_db(db_name: str) -> None:
    env = _env()
    subprocess.call(["docker", "exec", "-e", f"PGPASSWORD={env['password']}", CONTAINER, "psql", "-U", env["user"], "-d", "postgres", "-c", f"DROP DATABASE IF EXISTS {db_name} WITH (FORCE);"], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)


def _create_fresh_db(db_name: str) -> None:
    env = _env()
    _drop_db(db_name)
    _psql("postgres", f"CREATE DATABASE {db_name};")
    subprocess.run(["docker", "exec", "-i", "-e", f"PGPASSWORD={env['password']}", CONTAINER, "psql", "-U", env["user"], "-d", db_name, "-v", "ON_ERROR_STOP=1"], input=DUMP_PATH.read_text(encoding="utf-8"), text=True, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    # schema-only dump omits alembic_version rows
    _psql(db_name, "CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) NOT NULL); DELETE FROM alembic_version; INSERT INTO alembic_version (version_num) VALUES ('b8c9d0e1f2a3');")
    engine = create_engine(_url(db_name))
    with engine.connect() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == "b8c9d0e1f2a3"
        assert not conn.execute(text("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_cost_lines' AND column_name='vat_recoverability_status')")).scalar()
    engine.dispose()


def _upgrade_to_c9(db_name: str) -> None:
    import os
    from alembic import command
    from alembic.config import Config
    url = _url(db_name)
    os.environ["TIMIQ_ENV"] = "test"
    os.environ["APP_ENV"] = "test"
    os.environ["TEST_DATABASE_URL"] = url
    os.environ["DATABASE_URL"] = url
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "c9d0e1f2a3b4")
    engine = create_engine(_url(db_name))
    with engine.connect() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == "c9d0e1f2a3b4"
        assert conn.execute(text("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_cost_lines' AND column_name='vat_recoverability_status')")).scalar()
        assert conn.execute(text("SELECT COUNT(*) FROM finance_cost_documents WHERE vat_recoverability_status IS NOT NULL")).scalar() == 0
    engine.dispose()


def _actor(*, role=SystemRole.ADMIN, company_id=None, user_id=None):
    return SimpleNamespace(id=user_id or uuid.uuid4(), system_role=role, company_id=company_id or uuid.uuid4(), email="vat-dual@example.invalid", is_active=True)


def _enable_write(monkeypatch, *, company_id, project_id):
    monkeypatch.setenv("FINANCE_MODULE_ENABLED", "1")
    monkeypatch.setenv("FINANCE_PREVIEW_MODE", "readonly")
    monkeypatch.setenv("FINANCE_WRITE_COMPANY_IDS", str(company_id))
    monkeypatch.setenv("FINANCE_WRITE_PROJECT_IDS", str(project_id))
    monkeypatch.setattr("app.modules.finance.access.settings.app_env", "local")
    for mod in ("router", "commercial_router"):
        monkeypatch.setattr(f"app.modules.finance.{mod}.assert_finance_access", lambda _a: None)
        monkeypatch.setattr(f"app.modules.finance.{mod}.assert_finance_company_access", lambda _c: None)
        monkeypatch.setattr(
            f"app.modules.finance.{mod}.resolve_operational_company_id",
            lambda _db, actor, requested: actor.company_id if requested in (None, actor.company_id) else (_ for _ in ()).throw(HTTPException(status_code=403, detail="denied")),
        )


def _seed(session: Session, *, company_name: str, project_name: str, reference: str):
    company_id = uuid.uuid4()
    actor_id = uuid.uuid4()
    session.execute(text("INSERT INTO companies (id, name, is_active, created_at, updated_at) VALUES (:id, :name, true, now(), now())"), {"id": company_id, "name": company_name})
    project_id = create_project(session, company_id=company_id, actor_user_id=actor_id, name=project_name, reference_code=reference, contract_value_net=Decimal("0.0000"))
    return company_id, project_id, actor_id


def _client(actor, session: Session) -> TestClient:
    app.dependency_overrides[get_current_user] = lambda: actor
    app.dependency_overrides[get_db_session] = lambda: session
    return TestClient(app)


def _cleanup():
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_db_session, None)


def _run_cycle(db_name: str, *, label: str, monkeypatch) -> dict:
    import os
    os.environ['TIMIQ_ENV'] = 'test'
    os.environ['APP_ENV'] = 'test'
    os.environ['TEST_DATABASE_URL'] = _url(db_name)
    engine = create_engine(_url(db_name))
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, autoflush=False, join_transaction_mode="create_savepoint")
    try:
        company_id, project_id, actor_id = _seed(session, company_name=f"Synthetic {label} Co", project_name=f"Synthetic {label} Job", reference=label[:8].upper())
        other_company, other_project, _ = _seed(session, company_name=f"Other {label} Co", project_name=f"Other {label} Job", reference=f"O{label[:6].upper()}")
        code_id = create_cost_code(session, company_id=company_id, code=f"C{label[:3]}", name="Materials")
        supplier_id = create_counterparty(session, company_id=company_id, counterparty_type="supplier", name=f"Supplier {label}")
        set_contract_value(session, company_id=company_id, actor_user_id=actor_id, project_id=project_id, amount=Decimal("10000.00"), effective_date=date(2026, 1, 1))
        record_cost_to_complete(session, company_id=company_id, actor_user_id=actor_id, project_id=project_id, amount=Decimal("5000.00"), explanation="Remaining works")
        _enable_write(monkeypatch, company_id=company_id, project_id=project_id)
        actor = _actor(role=SystemRole.ADMIN, company_id=company_id, user_id=actor_id)
        client = _client(actor, session)
        draft_body = {
            "document_type": "supplier_invoice",
            "counterparty_id": str(supplier_id),
            "external_reference": f"SUP-{label}-1",
            "document_date": "2026-03-01",
            "service_date": "2026-03-01",
            "tax_point_date": "2026-03-01",
            "due_date": "2026-03-31",
            "lines": [{
                "line_number": 1,
                "description": "Bricks",
                "net_amount": "100.00",
                "tax_treatment": "standard",
                "tax_amount": "20.00",
                "recoverable_amount": "20.00",
                "vat_recoverability_status": "confirmed_recoverable",
                "allocations": [{"allocation_number": 1, "project_id": str(project_id), "cost_code_id": str(code_id), "is_overhead": False, "amount_net": "100.00", "amount_non_recoverable": "0.00"}],
            }],
        }
        draft = client.post("/api/finance/cost-documents", params={"company_id": str(company_id)}, json=draft_body)
        assert draft.status_code == 200, draft.text
        body = draft.json()
        document_id = body["id"]
        assert body["vat_recoverability_status"] == "confirmed_recoverable"
        assert Decimal(str(body["net_amount"])) == Decimal("100.0000")
        assert Decimal(str(body["tax_amount"])) == Decimal("20.0000")
        assert Decimal(str(body["gross_amount"])) == Decimal("120.0000")
        posted = client.post(f"/api/finance/cost-documents/{document_id}/post", params={"company_id": str(company_id)})
        assert posted.status_code == 200, posted.text
        posted_doc = posted.json().get("document", posted.json())
        assert posted_doc["status"] == "posted"
        assert posted_doc.get("vat_recoverability_status") == "confirmed_recoverable"
        dup = client.post("/api/finance/cost-documents", params={"company_id": str(company_id)}, json={**draft_body, "external_reference": f"SUP-{label}-1"})
        if dup.status_code == 200:
            dup_post = client.post(f"/api/finance/cost-documents/{dup.json()['id']}/post", params={"company_id": str(company_id)})
            assert dup_post.status_code == 400, dup_post.text
        pay = client.post("/api/finance/supplier-payments", params={"company_id": str(company_id)}, json={"counterparty_id": str(supplier_id), "payment_date": "2026-03-02", "payment_method": "bank_transfer", "external_reference": f"PAY-{label}-1", "amount": "120.00"})
        assert pay.status_code == 200, pay.text
        alloc = client.post(f"/api/finance/supplier-payments/{pay.json()['id']}/allocations", params={"company_id": str(company_id)}, json={"allocations": [{"cost_document_id": document_id, "amount": "120.00"}]})
        assert alloc.status_code == 200, alloc.text
        cvr = project_cvr(session, company_id=company_id, project_id=project_id)
        eligible = [Decimal(str(v)) for k, v in cvr.items() if "eligible" in str(k).lower() and str(v) not in {"missing", "None", ""}]
        assert eligible and max(eligible) >= Decimal("100.0000")
        audits = session.execute(text("SELECT action, entity_type FROM finance_audit_events WHERE company_id = :company_id"), {"company_id": company_id}).all()
        assert audits
        other = _client(_actor(role=SystemRole.ADMIN, company_id=other_company), session)
        denied = other.post("/api/finance/contract-value", params={"company_id": str(other_company)}, json={"project_id": str(other_project), "amount": "1.00", "effective_date": "2026-03-01"})
        assert denied.status_code == 403
        assert denied.json()["detail"] in {WRITE_DENIED, WRITE_ROLE_DENIED, "denied"}
        master = _client(_actor(role=SystemRole.ADMINISTRATOR, company_id=company_id, user_id=actor_id), session)
        assert master.post("/api/finance/contract-value", params={"company_id": str(company_id)}, json={"project_id": str(project_id), "amount": "1.00", "effective_date": "2026-03-01"}).status_code == 403
        bad_sp = session.begin_nested()
        try:
            bad = create_cost_draft(session, company_id=company_id, actor_user_id=actor_id, payload=CostDraftInput(document_type="supplier_invoice", counterparty_id=supplier_id, external_reference=f"SUP-{label}-BAD", document_date=date(2026, 3, 4), service_date=date(2026, 3, 4), tax_point_date=date(2026, 3, 4), due_date=date(2026, 4, 4), lines=[CostLineInput(line_number=1, description="Bad", net_amount=Decimal("10.00"), tax_treatment="standard", tax_amount=Decimal("2.00"), recoverable_amount=Decimal("0.00"), vat_recoverability_status="not_determined", allocations=[CostAllocationInput(allocation_number=1, project_id=project_id, cost_code_id=code_id, is_overhead=False, amount_net=Decimal("10.00"), amount_non_recoverable=Decimal("0.00"))])]))
            with pytest.raises((CostRegisterError, Exception)):
                post_cost_document(session, company_id=company_id, actor_user_id=actor_id, document_id=bad.id)
        finally:
            bad_sp.rollback()
        still = get_cost_document(session, company_id=company_id, document_id=uuid.UUID(document_id))
        assert still.status == "posted"
        assert Decimal(str(still.recoverable_amount)) == Decimal("20.0000")
        assert still.vat_recoverability_status == "confirmed_recoverable"
        return {"document_id": document_id, "gross": Decimal("120.0000"), "net": Decimal("100.0000"), "vat": Decimal("20.0000")}
    finally:
        session.close()
        transaction.rollback()
        connection.close()
        engine.dispose()
        _cleanup()


@pytest.fixture(scope="module")
def dual_prepared():
    import os
    os.environ['TIMIQ_ENV'] = 'test'
    os.environ['APP_ENV'] = 'test'
    _require_docker_b8()
    _dump_b8_schema()
    run1, run2 = "timiq_test_vat_run1_20261118", "timiq_test_vat_run2_20261118"
    try:
        _create_fresh_db(run1)
        _upgrade_to_c9(run1)
        _create_fresh_db(run2)
        _upgrade_to_c9(run2)
        yield run1, run2
    finally:
        _drop_db(run1)
        _drop_db(run2)
        if DUMP_PATH.exists():
            DUMP_PATH.unlink()


def test_run1_independent_vat_cycle(dual_prepared, monkeypatch):
    result = _run_cycle(dual_prepared[0], label="R1A", monkeypatch=monkeypatch)
    assert result["gross"] == Decimal("120.0000")
    assert result["vat"] == Decimal("20.0000")


def test_run2_independent_vat_cycle(dual_prepared, monkeypatch):
    result = _run_cycle(dual_prepared[1], label="R2B", monkeypatch=monkeypatch)
    assert result["net"] == Decimal("100.0000")
    assert result["document_id"]


def test_migration_is_additive_and_null_by_default():
    """Fresh b8->c9 DB has VAT columns and no invented recoverability labels."""
    import os
    os.environ["TIMIQ_ENV"] = "test"
    os.environ["APP_ENV"] = "test"
    _require_docker_b8()
    _dump_b8_schema()
    db_name = "timiq_test_vat_migcheck_20261118"
    try:
        _create_fresh_db(db_name)
        _upgrade_to_c9(db_name)
        engine = create_engine(_url(db_name))
        with engine.connect() as conn:
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == "c9d0e1f2a3b4"
            assert conn.execute(text("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_cost_lines' AND column_name='vat_recoverability_status')")).scalar()
            assert conn.execute(text("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='finance_cost_documents' AND column_name='vat_classification_basis')")).scalar()
            assert conn.execute(text("SELECT COUNT(*) FROM finance_cost_documents WHERE vat_recoverability_status IS NOT NULL")).scalar() == 0
        engine.dispose()
    finally:
        _drop_db(db_name)
        if DUMP_PATH.exists():
            DUMP_PATH.unlink(missing_ok=True)
