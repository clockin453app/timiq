from __future__ import annotations

import uuid

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.paye_payroll.models import (
    CompanyPayeSettings,
    EmployeePayeSettings,
    MonthlyPayeItem,
    MonthlyPayePeriod,
    PayeTaxYearRule,
)


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
