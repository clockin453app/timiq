"""Budget invoice payments phase 2 — service-level coverage (PostgreSQL)."""

from __future__ import annotations

import threading
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
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
    get_invoice,
    issue_invoice,
    patch_invoice,
    void_invoice,
)
from app.modules.budgets.invoice_documents import upload_invoice_document
from app.modules.budgets.models import BudgetInvoicePayment, BudgetProject
from app.modules.budgets.payments import create_payment, list_payments, reverse_payment
from app.modules.budgets.schemas import (
    InvoiceCreateRequest,
    InvoicePatchRequest,
    InvoiceVoidRequest,
    PaymentCreateRequest,
    PaymentReverseRequest,
)
from app.modules.companies.models import Company, CompanyTimePolicy

LOCAL_ADMIN_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres"
DB_NAME = "timiq_disposable_budget_payments_phase2"


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
    reason="Local Postgres required for budget payments phase 2 tests",
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
    company = Company(id=uuid.uuid4(), name=f"Pay Co {uuid.uuid4().hex[:6]}", is_active=True)
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
        name="Job Pay",
        description=None,
        workplace_id=None,
        location_id=None,
        client_name="Acme",
        reference_code="JP-1",
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
        "engine": session.get_bind(),
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


def _pay_req(**kwargs) -> PaymentCreateRequest:
    defaults = dict(
        client_action_id=uuid.uuid4(),
        payment_date=date(2026, 8, 5),
        amount=Decimal("50.00"),
        payment_method="bank_transfer",
    )
    defaults.update(kwargs)
    return PaymentCreateRequest(**defaults)


def _pdf_bytes() -> bytes:
    return b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


def _issue_invoice(
    session: Session,
    world: dict,
    *,
    gross: Decimal = Decimal("120.00"),
    net: Decimal | None = None,
    vat: Decimal | None = None,
    due_date: date = date(2099, 1, 1),
    invoice_number: str | None = None,
) -> object:
    if net is None:
        net = gross
        vat = Decimal("0.00")
    assert vat is not None
    inv = create_invoice(
        session,
        world["admin"],
        world["budget"].id,
        _create_req(net_amount=net, vat_amount=vat, gross_amount=gross),
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
            invoice_number=invoice_number or f"INV-{uuid.uuid4().hex[:8]}",
            invoice_date=date(2026, 8, 1),
            due_date=due_date,
        ),
    )
    return issue_invoice(session, world["admin"], world["budget"].id, inv.id)


def test_full_partial_multiple_payments(db_session: Session) -> None:
    world = _seed(db_session)
    inv = _issue_invoice(db_session, world, gross=Decimal("120.00"))

    p1 = create_payment(
        db_session,
        world["admin"],
        world["budget"].id,
        inv.id,
        _pay_req(amount=Decimal("40.00")),
    )
    assert p1.amount == Decimal("40.00")
    assert p1.is_reversed is False
    assert p1.created_by_display == world["admin"].email

    mid = get_invoice(db_session, world["admin"], world["budget"].id, inv.id)
    assert mid.display_status == "part_paid"
    assert mid.payments_received_gross == Decimal("40.00")
    assert mid.outstanding_gross == Decimal("80.00")

    p2 = create_payment(
        db_session,
        world["admin"],
        world["budget"].id,
        inv.id,
        _pay_req(amount=Decimal("30.00"), payment_method="card"),
    )
    assert p2.amount == Decimal("30.00")

    create_payment(
        db_session,
        world["admin"],
        world["budget"].id,
        inv.id,
        _pay_req(amount=Decimal("50.00"), payment_method="cash"),
    )
    paid = get_invoice(db_session, world["admin"], world["budget"].id, inv.id)
    assert paid.display_status == "paid"
    assert paid.payments_received_gross == Decimal("120.00")
    assert paid.outstanding_gross == Decimal("0.00")

    listed = list_payments(db_session, world["admin"], world["budget"].id, inv.id)
    assert len(listed) == 3


def test_overpayment_rejected(db_session: Session) -> None:
    world = _seed(db_session)
    inv = _issue_invoice(db_session, world, gross=Decimal("100.00"))
    create_payment(
        db_session,
        world["admin"],
        world["budget"].id,
        inv.id,
        _pay_req(amount=Decimal("60.00")),
    )
    with pytest.raises(HTTPException) as exc:
        create_payment(
            db_session,
            world["admin"],
            world["budget"].id,
            inv.id,
            _pay_req(amount=Decimal("50.00")),
        )
    assert exc.value.status_code == 422
    assert "Payment exceeds the invoice outstanding balance." in str(exc.value.detail)


def test_zero_and_negative_rejected() -> None:
    with pytest.raises(ValidationError):
        PaymentCreateRequest(
            client_action_id=uuid.uuid4(),
            payment_date=date(2026, 8, 5),
            amount=Decimal("0.00"),
            payment_method="cash",
        )
    with pytest.raises(ValidationError):
        PaymentCreateRequest(
            client_action_id=uuid.uuid4(),
            payment_date=date(2026, 8, 5),
            amount=Decimal("-1.00"),
            payment_method="cash",
        )


def test_draft_and_void_rejected(db_session: Session) -> None:
    world = _seed(db_session)
    draft = create_invoice(db_session, world["admin"], world["budget"].id, _create_req())
    with pytest.raises(HTTPException) as draft_exc:
        create_payment(
            db_session,
            world["admin"],
            world["budget"].id,
            draft.id,
            _pay_req(amount=Decimal("10.00")),
        )
    assert draft_exc.value.status_code == 409

    inv = _issue_invoice(db_session, world, gross=Decimal("50.00"), invoice_number="INV-VOID-1")
    void_invoice(
        db_session,
        world["admin"],
        world["budget"].id,
        inv.id,
        InvoiceVoidRequest(confirm=True, reason="Not needed"),
    )
    with pytest.raises(HTTPException) as void_exc:
        create_payment(
            db_session,
            world["admin"],
            world["budget"].id,
            inv.id,
            _pay_req(amount=Decimal("10.00")),
        )
    assert void_exc.value.status_code == 409


def test_currency_mismatch(db_session: Session) -> None:
    world = _seed(db_session)
    inv = _issue_invoice(db_session, world, gross=Decimal("80.00"))
    with pytest.raises(HTTPException) as exc:
        create_payment(
            db_session,
            world["admin"],
            world["budget"].id,
            inv.id,
            _pay_req(amount=Decimal("10.00"), currency="USD"),
        )
    assert exc.value.status_code == 422
    assert "currency" in str(exc.value.detail).lower()


def test_idempotent_replay(db_session: Session) -> None:
    world = _seed(db_session)
    inv = _issue_invoice(db_session, world, gross=Decimal("90.00"))
    action_id = uuid.uuid4()
    first = create_payment(
        db_session,
        world["admin"],
        world["budget"].id,
        inv.id,
        _pay_req(client_action_id=action_id, amount=Decimal("20.00")),
    )
    second = create_payment(
        db_session,
        world["admin"],
        world["budget"].id,
        inv.id,
        _pay_req(client_action_id=action_id, amount=Decimal("20.00")),
    )
    assert first.id == second.id
    rows = list(
        db_session.scalars(
            select(BudgetInvoicePayment).where(BudgetInvoicePayment.invoice_id == inv.id)
        ).all()
    )
    assert len(rows) == 1
    events = list(
        db_session.scalars(
            select(AuditEvent).where(AuditEvent.action == "budget.invoice_payment_recorded")
        ).all()
    )
    assert len(events) == 1


def test_reverse_and_double_reverse(db_session: Session) -> None:
    world = _seed(db_session)
    inv = _issue_invoice(db_session, world, gross=Decimal("100.00"))
    pay = create_payment(
        db_session,
        world["admin"],
        world["budget"].id,
        inv.id,
        _pay_req(amount=Decimal("40.00")),
    )
    reversed_pay = reverse_payment(
        db_session,
        world["admin"],
        world["budget"].id,
        inv.id,
        pay.id,
        PaymentReverseRequest(confirm=True, reason="Entered twice"),
    )
    assert reversed_pay.is_reversed is True
    assert reversed_pay.reversal_reason == "Entered twice"
    assert reversed_pay.reversed_at is not None

    after = get_invoice(db_session, world["admin"], world["budget"].id, inv.id)
    assert after.payments_received_gross == Decimal("0.00")
    assert after.outstanding_gross == Decimal("100.00")

    listed = list_payments(db_session, world["admin"], world["budget"].id, inv.id)
    assert len(listed) == 1
    assert listed[0].is_reversed is True

    with pytest.raises(HTTPException) as exc:
        reverse_payment(
            db_session,
            world["admin"],
            world["budget"].id,
            inv.id,
            pay.id,
            PaymentReverseRequest(confirm=True, reason="Again"),
        )
    assert exc.value.status_code == 409

    events = {
        e.action
        for e in db_session.scalars(
            select(AuditEvent).where(AuditEvent.action.like("budget.invoice_payment_%"))
        ).all()
    }
    assert "budget.invoice_payment_recorded" in events
    assert "budget.invoice_payment_reversed" in events


def test_void_blocked_with_active_payments(db_session: Session) -> None:
    world = _seed(db_session)
    inv = _issue_invoice(db_session, world, gross=Decimal("70.00"))
    create_payment(
        db_session,
        world["admin"],
        world["budget"].id,
        inv.id,
        _pay_req(amount=Decimal("10.00")),
    )
    with pytest.raises(HTTPException) as exc:
        void_invoice(
            db_session,
            world["admin"],
            world["budget"].id,
            inv.id,
            InvoiceVoidRequest(confirm=True, reason="Cancel"),
        )
    assert exc.value.status_code == 422
    assert "active payments" in str(exc.value.detail).lower()


def test_display_status_paid_part_paid_overdue(db_session: Session) -> None:
    world = _seed(db_session)

    overdue_inv = _issue_invoice(
        db_session,
        world,
        gross=Decimal("100.00"),
        due_date=date(2020, 1, 1),
        invoice_number="INV-OD-1",
    )
    od = get_invoice(db_session, world["admin"], world["budget"].id, overdue_inv.id)
    assert od.display_status == "overdue"

    create_payment(
        db_session,
        world["admin"],
        world["budget"].id,
        overdue_inv.id,
        _pay_req(amount=Decimal("25.00")),
    )
    part = get_invoice(db_session, world["admin"], world["budget"].id, overdue_inv.id)
    assert part.display_status == "part_paid"

    create_payment(
        db_session,
        world["admin"],
        world["budget"].id,
        overdue_inv.id,
        _pay_req(amount=Decimal("75.00")),
    )
    paid = get_invoice(db_session, world["admin"], world["budget"].id, overdue_inv.id)
    assert paid.display_status == "paid"
    # Fully paid past-due invoice must not remain overdue.
    assert paid.display_status != "overdue"

    future = _issue_invoice(
        db_session,
        world,
        gross=Decimal("50.00"),
        due_date=date(2099, 6, 1),
        invoice_number="INV-FUT-1",
    )
    fut = get_invoice(db_session, world["admin"], world["budget"].id, future.id)
    assert fut.display_status == "issued"


def test_billing_summary_payment_fields(db_session: Session) -> None:
    world = _seed(db_session)
    a = _issue_invoice(
        db_session,
        world,
        gross=Decimal("100.00"),
        due_date=date(2020, 1, 1),
        invoice_number="INV-SUM-A",
    )
    b = _issue_invoice(
        db_session,
        world,
        gross=Decimal("80.00"),
        due_date=date(2099, 1, 1),
        invoice_number="INV-SUM-B",
    )
    create_payment(
        db_session,
        world["admin"],
        world["budget"].id,
        a.id,
        _pay_req(amount=Decimal("100.00")),
    )
    create_payment(
        db_session,
        world["admin"],
        world["budget"].id,
        b.id,
        _pay_req(amount=Decimal("30.00")),
    )

    summary = get_billing_summary(db_session, world["admin"], world["budget"].id)
    assert summary.payments_received_gross == Decimal("130.00")
    assert summary.outstanding_gross == Decimal("50.00")
    assert summary.paid_count == 1
    assert summary.part_paid_count == 1
    assert summary.overdue_count == 0
    assert summary.overdue_outstanding_gross == Decimal("0.00")
    assert summary.issued_count == 2

    # Leave an overdue unpaid invoice to exercise overdue aggregates.
    _issue_invoice(
        db_session,
        world,
        gross=Decimal("40.00"),
        due_date=date(2021, 1, 1),
        invoice_number="INV-SUM-C",
    )
    summary2 = get_billing_summary(db_session, world["admin"], world["budget"].id)
    assert summary2.overdue_count == 1
    assert summary2.overdue_outstanding_gross == Decimal("40.00")
    assert summary2.outstanding_gross == Decimal("90.00")


def test_permissions_employee_and_cross_company(db_session: Session) -> None:
    world = _seed(db_session)
    inv = _issue_invoice(db_session, world, gross=Decimal("60.00"))

    with pytest.raises(HTTPException) as emp:
        create_payment(
            db_session,
            world["employee"],
            world["budget"].id,
            inv.id,
            _pay_req(amount=Decimal("10.00")),
        )
    assert emp.value.status_code == 403

    with pytest.raises(HTTPException) as cross:
        create_payment(
            db_session,
            world["other_admin"],
            world["budget"].id,
            inv.id,
            _pay_req(amount=Decimal("10.00")),
        )
    assert cross.value.status_code == 403

    with pytest.raises(HTTPException) as list_emp:
        list_payments(db_session, world["employee"], world["budget"].id, inv.id)
    assert list_emp.value.status_code == 403


def test_concurrent_overpay_one_succeeds(db_session: Session) -> None:
    world = _seed(db_session)
    inv = _issue_invoice(db_session, world, gross=Decimal("100.00"))
    engine = world["engine"]
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)

    results: list[str] = []
    barrier = threading.Barrier(2)

    def attempt(amount: Decimal, action: uuid.UUID) -> None:
        session = factory()
        try:
            barrier.wait(timeout=10)
            create_payment(
                session,
                world["admin"],
                world["budget"].id,
                inv.id,
                _pay_req(client_action_id=action, amount=amount),
            )
            results.append("ok")
        except HTTPException as exc:
            results.append(f"err:{exc.status_code}")
        except Exception as exc:  # pragma: no cover - unexpected
            results.append(f"exc:{type(exc).__name__}")
        finally:
            session.close()

    t1 = threading.Thread(target=attempt, args=(Decimal("100.00"), uuid.uuid4()))
    t2 = threading.Thread(target=attempt, args=(Decimal("100.00"), uuid.uuid4()))
    t1.start()
    t2.start()
    t1.join(timeout=30)
    t2.join(timeout=30)

    assert results.count("ok") == 1
    assert any(r.startswith("err:422") for r in results) or any(r.startswith("err:409") for r in results)

    db_session.expire_all()
    active = list(
        db_session.scalars(
            select(BudgetInvoicePayment)
            .where(BudgetInvoicePayment.invoice_id == inv.id)
            .where(BudgetInvoicePayment.reversed_at.is_(None))
        ).all()
    )
    assert len(active) == 1
    assert Decimal(str(active[0].amount)) == Decimal("100.00")
