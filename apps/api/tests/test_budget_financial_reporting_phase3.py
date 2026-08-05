"""Budget financial reporting phase 3 — service-level coverage (PostgreSQL)."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db import models as _models  # noqa: F401
from app.modules.audit.models import AuditEvent
from app.modules.auth.models import SystemRole, User
from app.modules.auth.security import hash_password
from app.modules.budgets.billing import (
    create_invoice,
    get_billing_summary,
    issue_invoice,
    patch_invoice,
    update_contract_value,
    void_invoice,
)
from app.modules.budgets.financial_reporting import (
    export_financial_summary_csv,
    export_invoice_register_csv,
    get_financial_summary,
)
from app.modules.budgets.invoice_documents import upload_invoice_document
from app.modules.budgets.models import BudgetProject
from app.modules.budgets.payments import create_payment
from app.modules.budgets.saved_budgets import (
    create_expense,
    export_budget_csv,
    export_budget_print_html,
    get_budget_detail,
)
from app.modules.budgets.schemas import (
    BudgetExpenseCreateRequest,
    ContractValueUpdateRequest,
    InvoiceCreateRequest,
    InvoicePatchRequest,
    InvoiceVoidRequest,
    PaymentCreateRequest,
)
from app.modules.companies.models import Company, CompanyTimePolicy

LOCAL_ADMIN_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres"
DB_NAME = "timiq_budget_financial_reporting_phase3_it"


def _local_postgres_available() -> bool:
    try:
        eng = create_engine(LOCAL_ADMIN_URL, isolation_level="AUTOCOMMIT")
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _local_postgres_available(),
    reason="Local Postgres required for budget financial reporting phase 3 tests",
)


@pytest.fixture()
def db_session(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Session:
    from app.core.config import settings
    from app.core.storage.factory import get_storage_backend

    monkeypatch.setattr(settings, "timiq_storage_backend", "local")
    monkeypatch.setattr(settings, "timiq_storage_root", str(tmp_path / "storage"))
    get_storage_backend.cache_clear()

    admin = create_engine(LOCAL_ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :n"),
            {"n": DB_NAME},
        ).scalar()
        if exists:
            conn.execute(text(f'DROP DATABASE "{DB_NAME}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{DB_NAME}"'))

    target_url = f"postgresql+psycopg://postgres:postgres@127.0.0.1:5432/{DB_NAME}"
    engine = create_engine(target_url)
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                ALTER TABLE budget_customer_invoices
                  ADD CONSTRAINT ck_budget_customer_invoices_net_amount_nonneg CHECK (net_amount >= 0);
                ALTER TABLE budget_customer_invoices
                  ADD CONSTRAINT ck_budget_customer_invoices_vat_amount_nonneg CHECK (vat_amount >= 0);
                ALTER TABLE budget_customer_invoices
                  ADD CONSTRAINT ck_budget_customer_invoices_gross_amount_nonneg CHECK (gross_amount >= 0);
                ALTER TABLE budget_invoice_payments
                  ADD CONSTRAINT ck_budget_invoice_payments_amount_positive CHECK (amount > 0);
                """
            )
        )
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()
        get_storage_backend.cache_clear()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE "{DB_NAME}" WITH (FORCE)'))
        admin.dispose()


def _user(*, company_id: uuid.UUID | None, role: SystemRole, email: str | None = None) -> User:
    return User(
        id=uuid.uuid4(),
        email=email or f"{uuid.uuid4().hex[:8]}@ex.com",
        password_hash=hash_password("Password123!"),
        system_role=role,
        company_id=company_id,
        is_active=True,
    )


def _seed(session: Session) -> dict:
    company = Company(id=uuid.uuid4(), name=f"Report Co {uuid.uuid4().hex[:6]}", is_active=True)
    other = Company(id=uuid.uuid4(), name=f"Other {uuid.uuid4().hex[:6]}", is_active=True)
    session.add_all([company, other])
    session.flush()
    policy = CompanyTimePolicy(
        company_id=company.id,
        timezone_name="Europe/London",
        standard_start_time="08:00",
        overtime_after_hours=8.5,
        overtime_multiplier=1.5,
        rounding_increment_minutes=15,
        rounding_mode="nearest",
        break_deduction_minutes=0,
        break_deduction_after_minutes=360,
    )
    admin = _user(company_id=company.id, role=SystemRole.ADMIN)
    administrator = _user(company_id=None, role=SystemRole.ADMINISTRATOR)
    employee = _user(company_id=company.id, role=SystemRole.EMPLOYEE)
    other_admin = _user(company_id=other.id, role=SystemRole.ADMIN)
    budget = BudgetProject(
        id=uuid.uuid4(),
        company_id=company.id,
        name="Job Report",
        description=None,
        workplace_id=None,
        location_id=None,
        client_name="Acme",
        reference_code="JR-1",
        status="active",
        start_date=date(2026, 1, 1),
        end_date=None,
        planned_budget_amount=10000.0,
        contract_value_net=None,
        billing_currency=None,
        notes=None,
        created_by_user_id=admin.id,
    )
    session.add_all([policy, admin, administrator, employee, other_admin, budget])
    session.commit()
    return {
        "company": company,
        "other": other,
        "admin": admin,
        "administrator": administrator,
        "employee": employee,
        "other_admin": other_admin,
        "budget": budget,
    }


def _create_req(**kwargs) -> InvoiceCreateRequest:
    defaults = dict(
        client_action_id=uuid.uuid4(),
        customer_name="Acme Ltd",
        net_amount=Decimal("100.00"),
        vat_amount=Decimal("20.00"),
        gross_amount=Decimal("120.00"),
        currency="GBP",
    )
    defaults.update(kwargs)
    return InvoiceCreateRequest(**defaults)


def _pdf_bytes() -> bytes:
    return b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


def _issue(
    session: Session,
    world: dict,
    *,
    net: Decimal = Decimal("100.00"),
    vat: Decimal = Decimal("20.00"),
    gross: Decimal = Decimal("120.00"),
    due_date: date = date(2099, 1, 1),
    invoice_number: str = "INV-1",
    customer_name: str = "Acme Ltd",
    reference: str | None = None,
) -> object:
    inv = create_invoice(
        session,
        world["admin"],
        world["budget"].id,
        _create_req(
            net_amount=net,
            vat_amount=vat,
            gross_amount=gross,
            customer_name=customer_name,
            reference=reference,
        ),
    )
    upload_invoice_document(
        session,
        world["admin"],
        world["budget"].id,
        inv.id,
        file_bytes=_pdf_bytes(),
        filename="inv.pdf",
        content_type="application/pdf",
    )
    patch_invoice(
        session,
        world["admin"],
        world["budget"].id,
        inv.id,
        InvoicePatchRequest(
            invoice_number=invoice_number,
            invoice_date=date(2026, 7, 1),
            due_date=due_date,
        ),
    )
    return issue_invoice(session, world["admin"], world["budget"].id, inv.id)


def test_cost_fields_match_budget_detail(db_session: Session) -> None:
    world = _seed(db_session)
    create_expense(
        db_session,
        world["admin"],
        world["budget"].id,
        BudgetExpenseCreateRequest(
            category="materials",
            description="Timber",
            purchase_date=date(2026, 7, 1),
            amount=Decimal("250.50"),
        ),
    )
    detail = get_budget_detail(db_session, world["admin"], world["budget"].id)
    summary = get_financial_summary(db_session, world["admin"], world["budget"].id)

    assert summary.cost_position.planned_budget_amount == detail.totals.planned_budget_amount
    assert summary.cost_position.finalized_labour_cost == detail.totals.finalized_labour_cost
    assert summary.cost_position.estimated_labour_cost == detail.totals.estimated_labour_cost
    assert summary.cost_position.total_labour_cost == detail.totals.total_labour_cost
    assert summary.cost_position.total_expenses == detail.totals.total_expenses
    assert summary.cost_position.forecast_total_cost == detail.totals.total_spent
    assert summary.cost_position.remaining_budget == detail.totals.remaining_budget
    assert summary.cost_position.over_budget_amount == detail.totals.over_budget_amount
    assert summary.cost_position.budget_used_percent == detail.totals.budget_used_percent
    assert summary.cost_position.open_shift_count == detail.totals.open_shift_count
    assert summary.cost_position.missing_rate_count == detail.totals.missing_rate_count
    assert summary.cost_position.warnings == detail.totals.warnings
    assert summary.cost_position.estimate_note == detail.totals.estimate_note


def test_contract_null_profit_and_margin_null(db_session: Session) -> None:
    world = _seed(db_session)
    create_expense(
        db_session,
        world["admin"],
        world["budget"].id,
        BudgetExpenseCreateRequest(
            category="materials",
            description="Kits",
            purchase_date=date(2026, 7, 1),
            amount=Decimal("100.00"),
        ),
    )
    summary = get_financial_summary(db_session, world["admin"], world["budget"].id)
    assert summary.billing_position.contract_value_net is None
    assert summary.profitability.forecast_revenue_net is None
    assert summary.profitability.forecast_profit is None
    assert summary.profitability.forecast_margin_percent is None
    assert summary.profitability.forecast_total_cost == Decimal("100.00")


def test_positive_and_negative_profit(db_session: Session) -> None:
    world = _seed(db_session)
    create_expense(
        db_session,
        world["admin"],
        world["budget"].id,
        BudgetExpenseCreateRequest(
            category="materials",
            description="Spend",
            purchase_date=date(2026, 7, 1),
            amount=Decimal("400.00"),
        ),
    )
    update_contract_value(
        db_session,
        world["admin"],
        world["budget"].id,
        ContractValueUpdateRequest(contract_value_net=Decimal("1000.00"), billing_currency="GBP"),
    )
    summary = get_financial_summary(db_session, world["admin"], world["budget"].id)
    assert summary.profitability.forecast_profit == Decimal("600.00")
    assert summary.profitability.forecast_margin_percent == Decimal("60.00")

    update_contract_value(
        db_session,
        world["admin"],
        world["budget"].id,
        ContractValueUpdateRequest(contract_value_net=Decimal("100.00")),
    )
    loss = get_financial_summary(db_session, world["admin"], world["budget"].id)
    assert loss.profitability.forecast_profit == Decimal("-300.00")
    assert loss.profitability.forecast_margin_percent == Decimal("-300.00")


def test_payments_do_not_affect_profit(db_session: Session) -> None:
    world = _seed(db_session)
    create_expense(
        db_session,
        world["admin"],
        world["budget"].id,
        BudgetExpenseCreateRequest(
            category="tools",
            description="Hire",
            purchase_date=date(2026, 7, 1),
            amount=Decimal("200.00"),
        ),
    )
    update_contract_value(
        db_session,
        world["admin"],
        world["budget"].id,
        ContractValueUpdateRequest(contract_value_net=Decimal("500.00"), billing_currency="GBP"),
    )
    before = get_financial_summary(db_session, world["admin"], world["budget"].id)
    inv = _issue(db_session, world, net=Decimal("100.00"), vat=Decimal("20.00"), gross=Decimal("120.00"))
    create_payment(
        db_session,
        world["admin"],
        world["budget"].id,
        inv.id,
        PaymentCreateRequest(
            client_action_id=uuid.uuid4(),
            payment_date=date(2026, 8, 1),
            amount=Decimal("50.00"),
            payment_method="bank_transfer",
        ),
    )
    after = get_financial_summary(db_session, world["admin"], world["budget"].id)
    assert after.profitability.forecast_profit == before.profitability.forecast_profit
    assert after.billing_position.payments_received_gross == Decimal("50.00")


def test_vat_not_in_net_profit(db_session: Session) -> None:
    world = _seed(db_session)
    create_expense(
        db_session,
        world["admin"],
        world["budget"].id,
        BudgetExpenseCreateRequest(
            category="materials",
            description="Goods",
            purchase_date=date(2026, 7, 1),
            amount=Decimal("100.00"),
        ),
    )
    update_contract_value(
        db_session,
        world["admin"],
        world["budget"].id,
        ContractValueUpdateRequest(contract_value_net=Decimal("500.00"), billing_currency="GBP"),
    )
    _issue(db_session, world, net=Decimal("200.00"), vat=Decimal("40.00"), gross=Decimal("240.00"))
    summary = get_financial_summary(db_session, world["admin"], world["budget"].id)
    # Profit uses contract net vs cost — VAT invoiced must not inflate profit.
    assert summary.profitability.forecast_profit == Decimal("400.00")
    assert summary.billing_position.vat_invoiced == Decimal("40.00")
    assert summary.billing_position.gross_invoiced == Decimal("240.00")
    assert summary.billing_position.active_invoiced_net == Decimal("200.00")


def test_draft_and_void_excluded_from_invoiced(db_session: Session) -> None:
    world = _seed(db_session)
    update_contract_value(
        db_session,
        world["admin"],
        world["budget"].id,
        ContractValueUpdateRequest(contract_value_net=Decimal("1000.00"), billing_currency="GBP"),
    )
    create_invoice(
        db_session,
        world["admin"],
        world["budget"].id,
        _create_req(net_amount=Decimal("50.00"), vat_amount=Decimal("0"), gross_amount=Decimal("50.00")),
    )
    issued = _issue(
        db_session,
        world,
        net=Decimal("100.00"),
        vat=Decimal("0"),
        gross=Decimal("100.00"),
        invoice_number="INV-ACTIVE",
    )
    to_void = _issue(
        db_session,
        world,
        net=Decimal("75.00"),
        vat=Decimal("0"),
        gross=Decimal("75.00"),
        invoice_number="INV-VOID",
    )
    void_invoice(
        db_session,
        world["admin"],
        world["budget"].id,
        to_void.id,
        InvoiceVoidRequest(confirm=True, reason="Cancelled"),
    )
    summary = get_financial_summary(db_session, world["admin"], world["budget"].id)
    billing = get_billing_summary(db_session, world["admin"], world["budget"].id)
    assert summary.billing_position.active_invoiced_net == Decimal("100.00")
    assert summary.billing_position.active_invoiced_net == billing.active_invoiced_net
    assert summary.invoice_status_counts.draft == 1
    assert summary.invoice_status_counts.void == 1
    assert summary.billing_position.draft_count == 1
    assert summary.billing_position.void_count == 1
    assert issued.id is not None


def test_financial_summary_csv_contains_net_gross_labels(db_session: Session) -> None:
    world = _seed(db_session)
    update_contract_value(
        db_session,
        world["admin"],
        world["budget"].id,
        ContractValueUpdateRequest(contract_value_net=Decimal("500.00"), billing_currency="GBP"),
    )
    body, _fname = export_financial_summary_csv(db_session, world["admin"], world["budget"].id)
    text_body = body.decode("utf-8")
    assert "Net" in text_body
    assert "Gross" in text_body
    assert "Financial summary" in text_body

    events = list(
        db_session.scalars(
            select(AuditEvent).where(AuditEvent.action == "budget.financial_summary_exported")
        ).all()
    )
    assert len(events) == 1
    assert events[0].details.get("report_type") == "financial_summary"
    assert events[0].details.get("format") == "csv"
    assert events[0].details.get("budget_id") == str(world["budget"].id)


def test_invoice_register_csv_formula_protection(db_session: Session) -> None:
    world = _seed(db_session)
    _issue(
        db_session,
        world,
        invoice_number="=CMD()",
        customer_name="+Danger",
        reference="@SUM(A1)",
        net=Decimal("10.00"),
        vat=Decimal("0"),
        gross=Decimal("10.00"),
    )
    body, _fname = export_invoice_register_csv(db_session, world["admin"], world["budget"].id)
    text_body = body.decode("utf-8")
    assert "'=CMD()" in text_body
    assert "'+Danger" in text_body
    assert "'@SUM(A1)" in text_body
    assert "Invoice number" in text_body
    assert "Effective status" in text_body

    events = list(
        db_session.scalars(
            select(AuditEvent).where(AuditEvent.action == "budget.invoice_register_exported")
        ).all()
    )
    assert len(events) == 1
    assert events[0].details.get("report_type") == "invoice_register"
    assert events[0].details.get("format") == "csv"


def test_legacy_budget_csv_unchanged_headers(db_session: Session) -> None:
    world = _seed(db_session)
    body, _fname = export_budget_csv(db_session, world["admin"], world["budget"].id)
    text_body = body.decode("utf-8")
    assert text_body.startswith("Budget report")
    assert "Planned budget" in text_body.splitlines()[7] or any(
        line.startswith("Planned budget") for line in text_body.splitlines()
    )
    first_lines = text_body.splitlines()[:10]
    assert first_lines[0] == "Budget report"
    assert any(line.startswith("Planned budget") for line in first_lines)

    html_body = export_budget_print_html(db_session, world["admin"], world["budget"].id)
    assert "Planned budget" in html_body
    assert "<h1>" in html_body


def test_permissions_employee_and_cross_company(db_session: Session) -> None:
    world = _seed(db_session)
    with pytest.raises(HTTPException) as emp:
        get_financial_summary(db_session, world["employee"], world["budget"].id)
    assert emp.value.status_code == 403

    with pytest.raises(HTTPException) as cross:
        get_financial_summary(db_session, world["other_admin"], world["budget"].id)
    assert cross.value.status_code == 403

    with pytest.raises(HTTPException) as emp_csv:
        export_financial_summary_csv(db_session, world["employee"], world["budget"].id)
    assert emp_csv.value.status_code == 403

    with pytest.raises(HTTPException) as emp_reg:
        export_invoice_register_csv(db_session, world["employee"], world["budget"].id)
    assert emp_reg.value.status_code == 403
