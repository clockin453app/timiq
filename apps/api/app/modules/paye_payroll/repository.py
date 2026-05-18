from __future__ import annotations

import uuid

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.locations.models import Location
from app.modules.paye_payroll.models import (
    CompanyPayeSettings,
    EmployeePayeSettings,
    MonthlyPayeItem,
    MonthlyPayePayComponent,
    MonthlyPayePeriod,
    PayeTaxYearRule,
)
from app.modules.time_clock.models import TimeShift


def get_tax_year_rule(db_session: Session, tax_year: str) -> PayeTaxYearRule | None:
    return db_session.get(PayeTaxYearRule, tax_year)


def save_tax_year_rule(db_session: Session, row: PayeTaxYearRule) -> PayeTaxYearRule:
    db_session.add(row)
    db_session.flush()
    return row


def get_monthly_period(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    tax_year: str,
    tax_month: int,
) -> MonthlyPayePeriod | None:
    statement = select(MonthlyPayePeriod).where(
        MonthlyPayePeriod.company_id == company_id,
        MonthlyPayePeriod.tax_year == tax_year,
        MonthlyPayePeriod.tax_month == tax_month,
    )
    return db_session.scalar(statement)


def get_monthly_period_by_id(db_session: Session, period_id: uuid.UUID) -> MonthlyPayePeriod | None:
    return db_session.get(MonthlyPayePeriod, period_id)


def get_monthly_item_by_id(db_session: Session, item_id: uuid.UUID) -> MonthlyPayeItem | None:
    return db_session.get(MonthlyPayeItem, item_id)


def get_pay_component_by_id(db_session: Session, component_id: uuid.UUID) -> MonthlyPayePayComponent | None:
    return db_session.get(MonthlyPayePayComponent, component_id)


def list_pay_components(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    tax_year: str,
    tax_month: int,
    user_id: uuid.UUID | None = None,
) -> list[MonthlyPayePayComponent]:
    statement = (
        select(MonthlyPayePayComponent)
        .where(MonthlyPayePayComponent.company_id == company_id)
        .where(MonthlyPayePayComponent.tax_year == tax_year)
        .where(MonthlyPayePayComponent.tax_month == tax_month)
        .order_by(MonthlyPayePayComponent.created_at.asc())
    )
    if user_id is not None:
        statement = statement.where(MonthlyPayePayComponent.user_id == user_id)
    return list(db_session.scalars(statement).all())


def list_completed_time_shifts_for_tax_month(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    start_utc,
    end_utc,
) -> list[tuple[TimeShift, Location]]:
    statement = (
        select(TimeShift, Location)
        .join(Location, TimeShift.location_id == Location.id)
        .where(TimeShift.user_id == user_id)
        .where(or_(TimeShift.company_id == company_id, Location.company_id == company_id))
        .where(TimeShift.clock_in_at >= start_utc)
        .where(TimeShift.clock_in_at < end_utc)
        .where(TimeShift.status == "completed")
        .where(TimeShift.clock_out_at.is_not(None))
        .order_by(TimeShift.clock_in_at.asc())
    )
    return [(shift, location) for shift, location in db_session.execute(statement).all()]


def count_open_time_shifts_for_tax_month(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    start_utc,
    end_utc,
) -> int:
    statement = (
        select(TimeShift)
        .join(Location, TimeShift.location_id == Location.id)
        .where(TimeShift.user_id == user_id)
        .where(or_(TimeShift.company_id == company_id, Location.company_id == company_id))
        .where(TimeShift.clock_in_at >= start_utc)
        .where(TimeShift.clock_in_at < end_utc)
        .where(TimeShift.status == "open")
    )
    return len(list(db_session.scalars(statement).all()))


def save_pay_component(db_session: Session, component: MonthlyPayePayComponent) -> MonthlyPayePayComponent:
    db_session.add(component)
    db_session.flush()
    return component


def delete_pay_component(db_session: Session, component: MonthlyPayePayComponent) -> None:
    db_session.delete(component)
    db_session.flush()


def list_employee_paye_pay_history(
    db_session: Session,
    *,
    user_id: uuid.UUID,
) -> list[tuple[MonthlyPayeItem, MonthlyPayePeriod]]:
    statement = (
        select(MonthlyPayeItem, MonthlyPayePeriod)
        .join(MonthlyPayePeriod, MonthlyPayePeriod.id == MonthlyPayeItem.period_id)
        .where(MonthlyPayeItem.user_id == user_id)
        .where(MonthlyPayeItem.status.in_(("approved", "paid")))
        .where(or_(MonthlyPayeItem.unsupported_reason.is_(None), MonthlyPayeItem.unsupported_reason == ""))
        .order_by(MonthlyPayePeriod.pay_date.desc(), MonthlyPayePeriod.tax_year.desc(), MonthlyPayePeriod.tax_month.desc())
    )
    return [(item, period) for item, period in db_session.execute(statement).all()]


def list_items_for_period(db_session: Session, period_id: uuid.UUID) -> list[MonthlyPayeItem]:
    statement = (
        select(MonthlyPayeItem)
        .where(MonthlyPayeItem.period_id == period_id)
        .order_by(MonthlyPayeItem.created_at.asc())
    )
    return list(db_session.scalars(statement).all())


def delete_pending_items_for_period(db_session: Session, period_id: uuid.UUID) -> None:
    db_session.execute(
        delete(MonthlyPayeItem).where(
            MonthlyPayeItem.period_id == period_id,
            MonthlyPayeItem.status == "pending",
        ),
    )


def clear_component_item_links_for_period(db_session: Session, period_id: uuid.UUID) -> None:
    components = db_session.scalars(
        select(MonthlyPayePayComponent).where(MonthlyPayePayComponent.period_id == period_id)
    ).all()
    for component in components:
        component.item_id = None


def list_paye_candidates_for_company(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    employee_id: uuid.UUID | None = None,
) -> list[tuple[User, EmployeeProfile | None, EmployeePayeSettings | None]]:
    statement = (
        select(User, EmployeeProfile, EmployeePayeSettings)
        .outerjoin(EmployeeProfile, EmployeeProfile.user_id == User.id)
        .outerjoin(EmployeePayeSettings, EmployeePayeSettings.user_id == User.id)
        .where(User.company_id == company_id)
        .where(User.system_role == SystemRole.EMPLOYEE)
        .where(User.is_active.is_(True))
        .where(EmployeeProfile.payroll_type == "paye_employee")
        .order_by(User.email.asc())
    )
    if employee_id is not None:
        statement = statement.where(User.id == employee_id)
    rows = db_session.execute(statement).all()
    return [(user, profile, settings) for user, profile, settings in rows]


def list_prior_items_for_user_tax_year(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    tax_year: str,
    before_tax_month: int,
) -> list[MonthlyPayeItem]:
    statement = (
        select(MonthlyPayeItem)
        .join(MonthlyPayePeriod, MonthlyPayePeriod.id == MonthlyPayeItem.period_id)
        .where(MonthlyPayeItem.company_id == company_id)
        .where(MonthlyPayeItem.user_id == user_id)
        .where(MonthlyPayePeriod.tax_year == tax_year)
        .where(MonthlyPayePeriod.tax_month < before_tax_month)
        .where(MonthlyPayeItem.status.in_(("pending", "approved", "paid")))
        .order_by(MonthlyPayePeriod.tax_month.asc())
    )
    return list(db_session.scalars(statement).all())


def get_company_settings(db_session: Session, company_id: uuid.UUID) -> CompanyPayeSettings | None:
    return db_session.get(CompanyPayeSettings, company_id)
