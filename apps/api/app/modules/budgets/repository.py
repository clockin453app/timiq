import uuid
from datetime import date, datetime

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.budgets.models import BudgetExpense, BudgetProject
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
