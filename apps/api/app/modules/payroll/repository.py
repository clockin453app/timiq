import uuid
from datetime import date

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.payroll.models import PayrollItem, PayrollPeriod
from app.modules.workplaces.models import Workplace


def list_employee_users_for_company(
    db_session: Session,
    company_id: uuid.UUID,
) -> list[User]:
    statement = (
        select(User)
        .where(User.company_id == company_id)
        .where(User.system_role == SystemRole.EMPLOYEE)
        .order_by(User.email.asc())
    )
    return list(db_session.scalars(statement).all())


def get_period_by_company_week(
    db_session: Session,
    company_id: uuid.UUID,
    week_start: date,
) -> PayrollPeriod | None:
    statement = select(PayrollPeriod).where(
        PayrollPeriod.company_id == company_id,
        PayrollPeriod.week_start == week_start,
    )
    return db_session.scalar(statement)


def save_period(db_session: Session, period: PayrollPeriod) -> PayrollPeriod:
    db_session.add(period)
    db_session.commit()
    db_session.refresh(period)
    return period


def save_item(db_session: Session, item: PayrollItem) -> PayrollItem:
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)
    return item


def update_item(db_session: Session, item: PayrollItem) -> PayrollItem:
    db_session.add(item)
    db_session.commit()
    db_session.refresh(item)
    return item


def list_items_for_period(db_session: Session, period_id: uuid.UUID) -> list[PayrollItem]:
    statement = (
        select(PayrollItem)
        .where(PayrollItem.period_id == period_id)
        .order_by(PayrollItem.created_at.asc())
    )
    return list(db_session.scalars(statement).all())


def get_item_by_id(db_session: Session, item_id: uuid.UUID) -> PayrollItem | None:
    return db_session.get(PayrollItem, item_id)


def period_has_paid_item(db_session: Session, period_id: uuid.UUID) -> bool:
    statement = (
        select(PayrollItem.id)
        .where(PayrollItem.period_id == period_id)
        .where(PayrollItem.status == "paid")
        .limit(1)
    )
    return db_session.scalar(statement) is not None


def delete_non_paid_items_for_period(db_session: Session, period_id: uuid.UUID) -> None:
    statement = delete(PayrollItem).where(
        PayrollItem.period_id == period_id,
        PayrollItem.status != "paid",
    )
    db_session.execute(statement)
    db_session.commit()


def first_workplace_tax(db_session: Session, company_id: uuid.UUID) -> float | None:
    statement = (
        select(Workplace)
        .where(Workplace.company_id == company_id)
        .order_by(Workplace.name.asc())
        .limit(1)
    )
    wp = db_session.scalar(statement)
    if wp is None or wp.tax_rate is None:
        return None
    return float(wp.tax_rate)


def list_items_for_user_pay_history(
    db_session: Session,
    user_id: uuid.UUID,
) -> list[PayrollItem]:
    statement = (
        select(PayrollItem)
        .where(PayrollItem.user_id == user_id)
        .where(PayrollItem.status.in_(("approved", "paid")))
        .order_by(PayrollItem.updated_at.desc())
    )
    return list(db_session.scalars(statement).all())
