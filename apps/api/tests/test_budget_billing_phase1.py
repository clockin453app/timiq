"""Budget customer billing phase 1 — service-level coverage (PostgreSQL)."""

from __future__ import annotations

import io
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi import HTTPException
from PIL import Image
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db import models as _models  # noqa: F401
from app.modules.audit.models import AuditEvent
from app.modules.auth.models import SystemRole, User
from app.modules.auth.security import hash_password
from app.modules.budgets.billing import (
    create_invoice,
    delete_invoice,
    get_billing_summary,
    issue_invoice,
    list_invoices,
    patch_invoice,
    update_contract_value,
    void_invoice,
)
from app.modules.budgets.invoice_documents import (
    MAX_INVOICE_DOCUMENT_BYTES,
    upload_invoice_document,
    validate_invoice_document,
)
from app.modules.budgets.models import BudgetCustomerInvoice, BudgetInvoiceDocument, BudgetProject
from app.modules.budgets.schemas import (
    ContractValueUpdateRequest,
    InvoiceCreateRequest,
    InvoicePatchRequest,
    InvoiceVoidRequest,
)
from app.modules.companies.models import Company, CompanyTimePolicy

LOCAL_ADMIN_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres"
DB_NAME = "timiq_budget_billing_phase1_it"


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
    reason="Local Postgres required for budget billing phase 1 tests",
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
    # Apply money non-negativity checks that migrations add (create_all skips them).
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
    company = Company(id=uuid.uuid4(), name=f"Bill Co {uuid.uuid4().hex[:6]}", is_active=True)
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
        name="Job Alpha",
        description=None,
        workplace_id=None,
        location_id=None,
        client_name="Acme",
        reference_code="JA-1",
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


def _jpeg_bytes() -> bytes:
    img = Image.new("RGB", (32, 32), color=(20, 40, 60))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _png_bytes() -> bytes:
    img = Image.new("RGB", (24, 24), color=(200, 10, 10))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_contract_value_null_and_update(db_session: Session) -> None:
    world = _seed(db_session)
    summary = get_billing_summary(db_session, world["admin"], world["budget"].id)
    assert summary.contract_value_net is None
    assert summary.remaining_to_invoice is None
    assert summary.over_invoiced is None

    updated = update_contract_value(
        db_session,
        world["admin"],
        world["budget"].id,
        ContractValueUpdateRequest(contract_value_net=Decimal("1000.00"), billing_currency="gbp"),
    )
    assert updated.contract_value_net == Decimal("1000.00")
    assert updated.billing_currency == "GBP"
    assert updated.remaining_to_invoice == Decimal("1000.00")
    assert updated.over_invoiced == Decimal("0.00")

    budget = db_session.get(BudgetProject, world["budget"].id)
    assert budget is not None
    assert float(budget.planned_budget_amount) == 10000.0

    events = list(
        db_session.scalars(select(AuditEvent).where(AuditEvent.action == "budget.contract_value_updated")).all()
    )
    assert len(events) == 1
    assert "storage_path" not in str(events[0].details)


def test_contract_rejects_below_active_invoiced(db_session: Session) -> None:
    world = _seed(db_session)
    update_contract_value(
        db_session,
        world["admin"],
        world["budget"].id,
        ContractValueUpdateRequest(contract_value_net=Decimal("500.00"), billing_currency="GBP"),
    )
    inv = create_invoice(db_session, world["admin"], world["budget"].id, _create_req(net_amount=Decimal("200.00"), vat_amount=Decimal("0"), gross_amount=Decimal("200.00")))
    upload_invoice_document(
        db_session,
        world["admin"],
        world["budget"].id,
        inv.id,
        file_bytes=_pdf_bytes(),
        filename="inv.pdf",
        content_type="application/pdf",
    )
    patch_invoice(
        db_session,
        world["admin"],
        world["budget"].id,
        inv.id,
        InvoicePatchRequest(
            invoice_number="INV-1",
            invoice_date=date(2026, 8, 1),
            due_date=date(2026, 8, 30),
        ),
    )
    issue_invoice(db_session, world["admin"], world["budget"].id, inv.id)

    with pytest.raises(HTTPException) as exc:
        update_contract_value(
            db_session,
            world["admin"],
            world["budget"].id,
            ContractValueUpdateRequest(contract_value_net=Decimal("100.00")),
        )
    assert exc.value.status_code == 422
    assert "Contract value cannot be lower than the active invoiced amount." in str(exc.value.detail)


def test_create_idempotent_client_action_id(db_session: Session) -> None:
    world = _seed(db_session)
    action_id = uuid.uuid4()
    first = create_invoice(db_session, world["admin"], world["budget"].id, _create_req(client_action_id=action_id))
    second = create_invoice(db_session, world["admin"], world["budget"].id, _create_req(client_action_id=action_id))
    assert first.id == second.id
    rows = list(
        db_session.scalars(
            select(BudgetCustomerInvoice).where(BudgetCustomerInvoice.budget_id == world["budget"].id)
        ).all()
    )
    assert len(rows) == 1
    created_events = list(
        db_session.scalars(select(AuditEvent).where(AuditEvent.action == "budget.invoice_created")).all()
    )
    assert len(created_events) == 1


def test_edit_issue_void_delete_and_summary_maths(db_session: Session) -> None:
    world = _seed(db_session)
    update_contract_value(
        db_session,
        world["admin"],
        world["budget"].id,
        ContractValueUpdateRequest(contract_value_net=Decimal("250.00"), billing_currency="GBP"),
    )

    draft = create_invoice(
        db_session,
        world["admin"],
        world["budget"].id,
        _create_req(net_amount=Decimal("100.00"), vat_amount=Decimal("20.00"), gross_amount=Decimal("120.00")),
    )
    patched = patch_invoice(
        db_session,
        world["admin"],
        world["budget"].id,
        draft.id,
        InvoicePatchRequest(
            invoice_number="INV-100",
            invoice_date=date(2026, 7, 1),
            due_date=date(2026, 7, 10),
            customer_name="Acme Billing",
        ),
    )
    assert patched.status == "draft"
    assert patched.invoice_number == "INV-100"

    with pytest.raises(HTTPException) as missing_doc:
        issue_invoice(db_session, world["admin"], world["budget"].id, draft.id)
    assert missing_doc.value.status_code == 422

    upload_invoice_document(
        db_session,
        world["admin"],
        world["budget"].id,
        draft.id,
        file_bytes=_pdf_bytes(),
        filename="invoice.pdf",
        content_type="application/pdf",
    )
    issued = issue_invoice(db_session, world["admin"], world["budget"].id, draft.id)
    assert issued.status == "issued"
    assert issued.display_status == "overdue"
    assert issued.has_document is True
    assert issued.document_filename == "invoice.pdf"
    assert issued.document_version == 1
    assert "storage_path" not in issued.model_dump()

    overdue_inv = create_invoice(
        db_session,
        world["admin"],
        world["budget"].id,
        _create_req(net_amount=Decimal("50.00"), vat_amount=Decimal("0"), gross_amount=Decimal("50.00")),
    )
    # Keep as draft for counts
    future = create_invoice(
        db_session,
        world["admin"],
        world["budget"].id,
        _create_req(
            net_amount=Decimal("200.00"),
            vat_amount=Decimal("0"),
            gross_amount=Decimal("200.00"),
            customer_name="Future Co",
        ),
    )
    upload_invoice_document(
        db_session,
        world["admin"],
        world["budget"].id,
        future.id,
        file_bytes=_jpeg_bytes(),
        filename="future.jpg",
        content_type="image/jpeg",
    )
    patch_invoice(
        db_session,
        world["admin"],
        world["budget"].id,
        future.id,
        InvoicePatchRequest(
            invoice_number="INV-200",
            invoice_date=date(2026, 8, 1),
            due_date=date(2099, 1, 1),
        ),
    )
    issued_future = issue_invoice(db_session, world["admin"], world["budget"].id, future.id)
    assert issued_future.display_status == "issued"

    summary = get_billing_summary(db_session, world["admin"], world["budget"].id)
    assert summary.active_invoiced_net == Decimal("300.00")
    assert summary.vat_invoiced == Decimal("20.00")
    assert summary.gross_invoiced == Decimal("320.00")
    assert summary.remaining_to_invoice == Decimal("0.00")
    assert summary.over_invoiced == Decimal("50.00")
    assert summary.draft_count == 1
    assert summary.issued_count == 2
    assert summary.overdue_count == 1
    assert summary.active_count == 2
    assert summary.void_count == 0

    voided = void_invoice(
        db_session,
        world["admin"],
        world["budget"].id,
        draft.id,
        InvoiceVoidRequest(confirm=True, reason="Duplicate billing"),
    )
    assert voided.status == "void"
    assert voided.display_status == "void"
    assert voided.void_reason == "Duplicate billing"

    after_void = get_billing_summary(db_session, world["admin"], world["budget"].id)
    assert after_void.active_invoiced_net == Decimal("200.00")
    assert after_void.void_count == 1
    assert after_void.issued_count == 1

    with pytest.raises(HTTPException):
        delete_invoice(db_session, world["admin"], world["budget"].id, issued_future.id)

    delete_invoice(db_session, world["admin"], world["budget"].id, overdue_inv.id)
    assert db_session.get(BudgetCustomerInvoice, overdue_inv.id) is None

    actions = {
        e.action
        for e in db_session.scalars(
            select(AuditEvent).where(AuditEvent.action.like("budget.invoice_%"))
        ).all()
    }
    assert "budget.invoice_created" in actions
    assert "budget.invoice_updated" in actions
    assert "budget.invoice_issued" in actions
    assert "budget.invoice_voided" in actions
    assert "budget.invoice_deleted" in actions
    assert "budget.invoice_document_uploaded" in actions


def test_gross_must_equal_net_plus_vat(db_session: Session) -> None:
    world = _seed(db_session)
    with pytest.raises(HTTPException) as exc:
        create_invoice(
            db_session,
            world["admin"],
            world["budget"].id,
            _create_req(net_amount=Decimal("10.00"), vat_amount=Decimal("1.00"), gross_amount=Decimal("12.00")),
        )
    assert exc.value.status_code == 422


def test_permissions_employee_and_cross_company(db_session: Session) -> None:
    world = _seed(db_session)
    with pytest.raises(HTTPException) as emp:
        get_billing_summary(db_session, world["employee"], world["budget"].id)
    assert emp.value.status_code == 403

    with pytest.raises(HTTPException) as cross:
        create_invoice(db_session, world["other_admin"], world["budget"].id, _create_req())
    assert cross.value.status_code == 403


def test_document_upload_accept_and_reject(db_session: Session) -> None:
    world = _seed(db_session)
    inv = create_invoice(db_session, world["admin"], world["budget"].id, _create_req())

    pdf_resp = upload_invoice_document(
        db_session,
        world["admin"],
        world["budget"].id,
        inv.id,
        file_bytes=_pdf_bytes(),
        filename="a.pdf",
        content_type="application/pdf",
    )
    assert pdf_resp.has_document is True
    assert pdf_resp.document_version == 1

    jpeg_resp = upload_invoice_document(
        db_session,
        world["admin"],
        world["budget"].id,
        inv.id,
        file_bytes=_jpeg_bytes(),
        filename="b.jpg",
        content_type="image/jpeg",
    )
    assert jpeg_resp.document_version == 2
    assert jpeg_resp.document_content_type == "image/jpeg"

    docs = list(
        db_session.scalars(
            select(BudgetInvoiceDocument).where(BudgetInvoiceDocument.invoice_id == inv.id)
        ).all()
    )
    assert len(docs) == 2
    current = [d for d in docs if d.is_current]
    assert len(current) == 1
    assert current[0].version == 2
    old = [d for d in docs if not d.is_current][0]
    assert old.replaced_at is not None

    png_resp = upload_invoice_document(
        db_session,
        world["admin"],
        world["budget"].id,
        inv.id,
        file_bytes=_png_bytes(),
        filename="c.png",
        content_type="image/png",
    )
    assert png_resp.document_version == 3

    with pytest.raises(HTTPException):
        validate_invoice_document(
            filename="x.bin",
            content_type="application/octet-stream",
            file_bytes=b"not-a-real-file",
        )

    with pytest.raises(HTTPException):
        validate_invoice_document(
            filename="lie.pdf",
            content_type="application/pdf",
            file_bytes=_jpeg_bytes(),
        )

    with pytest.raises(HTTPException):
        validate_invoice_document(
            filename="big.pdf",
            content_type="application/pdf",
            file_bytes=b"%PDF" + (b"x" * (MAX_INVOICE_DOCUMENT_BYTES + 1)),
        )

    replaced_events = list(
        db_session.scalars(
            select(AuditEvent).where(AuditEvent.action == "budget.invoice_document_replaced")
        ).all()
    )
    assert len(replaced_events) >= 1
    for ev in replaced_events:
        assert "storage_path" not in (ev.details or {})


def test_void_requires_confirm(db_session: Session) -> None:
    world = _seed(db_session)
    inv = create_invoice(db_session, world["admin"], world["budget"].id, _create_req())
    upload_invoice_document(
        db_session,
        world["admin"],
        world["budget"].id,
        inv.id,
        file_bytes=_pdf_bytes(),
        filename="v.pdf",
        content_type="application/pdf",
    )
    patch_invoice(
        db_session,
        world["admin"],
        world["budget"].id,
        inv.id,
        InvoicePatchRequest(
            invoice_number="INV-V",
            invoice_date=date(2026, 8, 1),
            due_date=date(2099, 1, 1),
        ),
    )
    issue_invoice(db_session, world["admin"], world["budget"].id, inv.id)
    with pytest.raises(HTTPException) as exc:
        void_invoice(
            db_session,
            world["admin"],
            world["budget"].id,
            inv.id,
            InvoiceVoidRequest(confirm=False, reason="nope"),
        )
    assert exc.value.status_code == 422


def test_list_invoices_returns_display_status(db_session: Session) -> None:
    world = _seed(db_session)
    inv = create_invoice(db_session, world["admin"], world["budget"].id, _create_req())
    rows = list_invoices(db_session, world["admin"], world["budget"].id)
    assert len(rows) == 1
    assert rows[0].id == inv.id
    assert rows[0].display_status == "draft"
