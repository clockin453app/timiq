from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.budgets.models import (
    BudgetCustomerInvoice,
    BudgetExpense,
    BudgetInvoiceDocument,
    BudgetInvoicePayment,
    BudgetProject,
)
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.locations.models import Location
from app.modules.time_clock.models import TimeShift


def list_company_shifts_clock_in_window(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    start_utc: datetime,
    end_utc: datetime,
    location_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
    limit: int,
) -> list[tuple[TimeShift, Location, User, EmployeeProfile | None]]:
    """Shifts with clock-in in [start_utc, end_utc) for company employees (no role-based viewer filter)."""
    statement = (
        select(TimeShift, Location, User, EmployeeProfile)
        .join(Location, TimeShift.location_id == Location.id)
        .join(User, TimeShift.user_id == User.id)
        .outerjoin(EmployeeProfile, EmployeeProfile.user_id == User.id)
        .where(User.company_id == company_id)
        .where(User.system_role == SystemRole.EMPLOYEE)
        .where(User.is_active.is_(True))
        .where(
            or_(
                TimeShift.company_id == company_id,
                Location.company_id == company_id,
            ),
        )
        .where(
            and_(
                TimeShift.clock_in_at >= start_utc,
                TimeShift.clock_in_at < end_utc,
            ),
        )
        .order_by(TimeShift.clock_in_at.asc())
        .limit(limit)
    )

    if location_id is not None:
        statement = statement.where(TimeShift.location_id == location_id)

    if user_id is not None:
        statement = statement.where(TimeShift.user_id == user_id)

    rows = db_session.execute(statement).all()
    return [(shift, location, owner, profile) for shift, location, owner, profile in rows]


def get_budget_project(db_session: Session, budget_id: uuid.UUID) -> BudgetProject | None:
    return db_session.get(BudgetProject, budget_id)


def save_budget_project(db_session: Session, row: BudgetProject) -> BudgetProject:
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def list_budget_projects(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    status: str | None,
    location_id: uuid.UUID | None,
    workplace_id: uuid.UUID | None,
    search: str | None,
    date_from: date | None,
    date_to: date | None,
    limit: int,
    offset: int,
) -> list[BudgetProject]:
    statement = select(BudgetProject).where(BudgetProject.company_id == company_id)
    if status:
        statement = statement.where(BudgetProject.status == status.strip().lower())
    if location_id is not None:
        statement = statement.where(BudgetProject.location_id == location_id)
    if workplace_id is not None:
        statement = statement.where(BudgetProject.workplace_id == workplace_id)
    if search and search.strip():
        q = f"%{search.strip()}%"
        statement = statement.where(
            or_(
                BudgetProject.name.ilike(q),
                BudgetProject.client_name.ilike(q),
                BudgetProject.reference_code.ilike(q),
            ),
        )
    if date_from is not None and date_to is not None:
        eff_from = date_from
        eff_to = date_to
        statement = statement.where(
            func.coalesce(BudgetProject.start_date, date(1970, 1, 1)) <= eff_to,
        ).where(
            func.coalesce(BudgetProject.end_date, date(9999, 12, 31)) >= eff_from,
        )
    statement = statement.order_by(BudgetProject.updated_at.desc()).limit(limit).offset(offset)
    return list(db_session.scalars(statement).all())


def delete_budget_expense(db_session: Session, expense_id: uuid.UUID) -> None:
    db_session.execute(delete(BudgetExpense).where(BudgetExpense.id == expense_id))
    db_session.commit()


def get_budget_expense(db_session: Session, expense_id: uuid.UUID) -> BudgetExpense | None:
    return db_session.get(BudgetExpense, expense_id)


def list_expenses_for_budget(
    db_session: Session,
    *,
    budget_id: uuid.UUID,
    limit: int = 500,
) -> list[BudgetExpense]:
    statement = (
        select(BudgetExpense)
        .where(BudgetExpense.budget_id == budget_id)
        .order_by(BudgetExpense.purchase_date.desc(), BudgetExpense.created_at.desc())
        .limit(limit)
    )
    return list(db_session.scalars(statement).all())


def save_budget_expense(db_session: Session, row: BudgetExpense) -> BudgetExpense:
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def sum_expense_amounts_by_category(db_session: Session, budget_id: uuid.UUID) -> dict[str, float]:
    statement = (
        select(BudgetExpense.category, func.coalesce(func.sum(BudgetExpense.amount), 0))
        .where(BudgetExpense.budget_id == budget_id)
        .group_by(BudgetExpense.category)
    )
    rows = db_session.execute(statement).all()
    return {str(cat): float(total or 0) for cat, total in rows}


def sum_expense_amount_total(db_session: Session, budget_id: uuid.UUID) -> float:
    statement = select(func.coalesce(func.sum(BudgetExpense.amount), 0)).where(BudgetExpense.budget_id == budget_id)
    v = db_session.scalar(statement)
    return float(v or 0)


def get_customer_invoice(db_session: Session, invoice_id: uuid.UUID) -> BudgetCustomerInvoice | None:
    return db_session.get(BudgetCustomerInvoice, invoice_id)


def get_customer_invoice_by_client_action_id(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    client_action_id: uuid.UUID,
) -> BudgetCustomerInvoice | None:
    statement = (
        select(BudgetCustomerInvoice)
        .where(BudgetCustomerInvoice.company_id == company_id)
        .where(BudgetCustomerInvoice.client_action_id == client_action_id)
        .limit(1)
    )
    return db_session.scalars(statement).first()


def get_customer_invoice_by_number(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    invoice_number: str,
) -> BudgetCustomerInvoice | None:
    statement = (
        select(BudgetCustomerInvoice)
        .where(BudgetCustomerInvoice.company_id == company_id)
        .where(BudgetCustomerInvoice.invoice_number == invoice_number)
        .limit(1)
    )
    return db_session.scalars(statement).first()


def list_customer_invoices_for_budget(
    db_session: Session,
    *,
    budget_id: uuid.UUID,
    limit: int = 500,
) -> list[BudgetCustomerInvoice]:
    statement = (
        select(BudgetCustomerInvoice)
        .where(BudgetCustomerInvoice.budget_id == budget_id)
        .order_by(
            BudgetCustomerInvoice.invoice_date.desc().nulls_last(),
            BudgetCustomerInvoice.created_at.desc(),
        )
        .limit(limit)
    )
    return list(db_session.scalars(statement).all())


def save_customer_invoice(db_session: Session, row: BudgetCustomerInvoice) -> BudgetCustomerInvoice:
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def delete_customer_invoice(db_session: Session, invoice_id: uuid.UUID) -> None:
    db_session.execute(delete(BudgetCustomerInvoice).where(BudgetCustomerInvoice.id == invoice_id))
    db_session.commit()


def get_current_invoice_document(
    db_session: Session,
    invoice_id: uuid.UUID,
) -> BudgetInvoiceDocument | None:
    statement = (
        select(BudgetInvoiceDocument)
        .where(BudgetInvoiceDocument.invoice_id == invoice_id)
        .where(BudgetInvoiceDocument.is_current.is_(True))
        .limit(1)
    )
    return db_session.scalars(statement).first()


def list_invoice_documents(
    db_session: Session,
    invoice_id: uuid.UUID,
) -> list[BudgetInvoiceDocument]:
    statement = (
        select(BudgetInvoiceDocument)
        .where(BudgetInvoiceDocument.invoice_id == invoice_id)
        .order_by(BudgetInvoiceDocument.version.asc())
    )
    return list(db_session.scalars(statement).all())


def next_invoice_document_version(db_session: Session, invoice_id: uuid.UUID) -> int:
    statement = select(func.coalesce(func.max(BudgetInvoiceDocument.version), 0)).where(
        BudgetInvoiceDocument.invoice_id == invoice_id,
    )
    current_max = db_session.scalar(statement)
    return int(current_max or 0) + 1


def save_invoice_document(db_session: Session, row: BudgetInvoiceDocument) -> BudgetInvoiceDocument:
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def sum_issued_invoice_amounts(
    db_session: Session,
    budget_id: uuid.UUID,
) -> tuple[float, float, float]:
    statement = (
        select(
            func.coalesce(func.sum(BudgetCustomerInvoice.net_amount), 0),
            func.coalesce(func.sum(BudgetCustomerInvoice.vat_amount), 0),
            func.coalesce(func.sum(BudgetCustomerInvoice.gross_amount), 0),
        )
        .where(BudgetCustomerInvoice.budget_id == budget_id)
        .where(BudgetCustomerInvoice.status == "issued")
    )
    row = db_session.execute(statement).one()
    return float(row[0] or 0), float(row[1] or 0), float(row[2] or 0)


def get_invoice_payment(
    db_session: Session,
    payment_id: uuid.UUID,
) -> BudgetInvoicePayment | None:
    return db_session.get(BudgetInvoicePayment, payment_id)


def get_invoice_payment_by_client_action_id(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    client_action_id: uuid.UUID,
) -> BudgetInvoicePayment | None:
    statement = (
        select(BudgetInvoicePayment)
        .where(BudgetInvoicePayment.company_id == company_id)
        .where(BudgetInvoicePayment.client_action_id == client_action_id)
        .limit(1)
    )
    return db_session.scalars(statement).first()


def list_payments_for_invoice(
    db_session: Session,
    invoice_id: uuid.UUID,
) -> list[BudgetInvoicePayment]:
    statement = (
        select(BudgetInvoicePayment)
        .where(BudgetInvoicePayment.invoice_id == invoice_id)
        .order_by(
            BudgetInvoicePayment.payment_date.asc(),
            BudgetInvoicePayment.created_at.asc(),
        )
    )
    return list(db_session.scalars(statement).all())


def sum_active_payments_for_invoice(db_session: Session, invoice_id: uuid.UUID) -> float:
    statement = (
        select(func.coalesce(func.sum(BudgetInvoicePayment.amount), 0))
        .where(BudgetInvoicePayment.invoice_id == invoice_id)
        .where(BudgetInvoicePayment.reversed_at.is_(None))
    )
    return float(db_session.scalar(statement) or 0)


def sum_active_payments_for_budget(db_session: Session, budget_id: uuid.UUID) -> float:
    """Sum all active (non-reversed) payments on invoices for the budget."""
    statement = (
        select(func.coalesce(func.sum(BudgetInvoicePayment.amount), 0))
        .where(BudgetInvoicePayment.budget_id == budget_id)
        .where(BudgetInvoicePayment.reversed_at.is_(None))
    )
    return float(db_session.scalar(statement) or 0)


def lock_customer_invoice_for_update(
    db_session: Session,
    invoice_id: uuid.UUID,
) -> BudgetCustomerInvoice | None:
    statement = (
        select(BudgetCustomerInvoice)
        .where(BudgetCustomerInvoice.id == invoice_id)
        .with_for_update()
    )
    return db_session.scalars(statement).first()


def save_payment(
    db_session: Session,
    row: BudgetInvoicePayment,
    *,
    commit: bool = True,
) -> BudgetInvoicePayment:
    db_session.add(row)
    if commit:
        db_session.commit()
    else:
        db_session.flush()
    db_session.refresh(row)
    return row
