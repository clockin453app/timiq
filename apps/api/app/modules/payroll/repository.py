import uuid
from datetime import date, datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.locations.models import Location
from app.modules.payroll.models import PayrollItem, PayrollPeriod
from app.modules.time_clock.models import TimeShift
from app.modules.workplaces.models import Workplace


def list_employee_users_for_company(
    db_session: Session,
    company_id: uuid.UUID,
) -> list[User]:
    statement = (
        select(User)
        .where(User.company_id == company_id)
        .where(User.system_role == SystemRole.EMPLOYEE)
        .where(User.is_active.is_(True))
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


def invalidate_period_calculation_for_company_week(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    week_start: date,
) -> bool:
    statement = (
        update(PayrollPeriod)
        .where(PayrollPeriod.company_id == company_id)
        .where(PayrollPeriod.week_start == week_start)
        .where(PayrollPeriod.calculated_at.is_not(None))
        .values(calculated_at=None, calculated_by_user_id=None)
    )
    result = db_session.execute(statement)
    db_session.commit()
    return bool(result.rowcount)


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


def delete_pending_items_for_period(db_session: Session, period_id: uuid.UUID) -> None:
    """Remove only pending rows; approved and paid are never deleted here."""
    statement = delete(PayrollItem).where(
        PayrollItem.period_id == period_id,
        PayrollItem.status == "pending",
    )
    db_session.execute(statement)
    db_session.commit()


def period_has_approved_item(db_session: Session, period_id: uuid.UUID) -> bool:
    statement = (
        select(PayrollItem.id)
        .where(PayrollItem.period_id == period_id)
        .where(PayrollItem.status == "approved")
        .limit(1)
    )
    return db_session.scalar(statement) is not None


def max_employee_shift_updated_at_in_payroll_week(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    week_start_utc: datetime,
    week_end_utc: datetime,
) -> datetime | None:
    """Latest TimeShift.updated_at for company employees with clock-in in [week_start_utc, week_end_utc)."""
    statement = (
        select(func.max(TimeShift.updated_at))
        .join(User, TimeShift.user_id == User.id)
        .where(User.company_id == company_id)
        .where(User.system_role == SystemRole.EMPLOYEE)
        .where(TimeShift.clock_in_at >= week_start_utc)
        .where(TimeShift.clock_in_at < week_end_utc)
    )
    return db_session.scalar(statement)


def first_workplace_tax(db_session: Session, company_id: uuid.UUID) -> float | None:
    """Legacy CIS fallback when employee and company defaults unset (first workplace by name)."""
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


def list_periods_week_start_between(
    db_session: Session,
    company_id: uuid.UUID,
    *,
    week_start_from: date,
    week_start_to: date,
) -> list[PayrollPeriod]:
    """Payroll periods whose week_start falls in [week_start_from, week_start_to] (inclusive)."""
    statement = (
        select(PayrollPeriod)
        .where(PayrollPeriod.company_id == company_id)
        .where(PayrollPeriod.week_start >= week_start_from)
        .where(PayrollPeriod.week_start <= week_start_to)
        .order_by(PayrollPeriod.week_start.asc())
    )
    return list(db_session.scalars(statement).all())


def list_periods_for_company_month(
    db_session: Session,
    company_id: uuid.UUID,
    *,
    year: int,
    month: int,
) -> list[PayrollPeriod]:
    first = date(year, month, 1)
    if month == 12:
        next_first = date(year + 1, 1, 1)
    else:
        next_first = date(year, month + 1, 1)
    statement = (
        select(PayrollPeriod)
        .where(PayrollPeriod.company_id == company_id)
        .where(PayrollPeriod.week_start >= first)
        .where(PayrollPeriod.week_start < next_first)
        .order_by(PayrollPeriod.week_start.asc())
    )
    return list(db_session.scalars(statement).all())


def count_open_shifts_started_in_week(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    week_start_utc: datetime,
    week_end_utc: datetime,
) -> int:
    """Open shifts whose clock-in falls in [week_start_utc, week_end_utc), company employees only."""
    statement = (
        select(func.count())
        .select_from(TimeShift)
        .join(User, TimeShift.user_id == User.id)
        .where(User.company_id == company_id)
        .where(User.system_role == SystemRole.EMPLOYEE)
        .where(TimeShift.status == "open")
        .where(TimeShift.clock_in_at >= week_start_utc)
        .where(TimeShift.clock_in_at < week_end_utc)
    )
    return int(db_session.scalar(statement) or 0)


def list_completed_time_shifts_for_company_range(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    range_start_utc: datetime,
    range_end_utc: datetime,
    user_id: uuid.UUID | None = None,
) -> list[tuple[TimeShift, Location, User, EmployeeProfile | None]]:
    """Completed shifts clocked in during [range_start_utc, range_end_utc) for payroll range exports."""
    statement = (
        select(TimeShift, Location, User, EmployeeProfile)
        .join(Location, TimeShift.location_id == Location.id)
        .join(User, TimeShift.user_id == User.id)
        .outerjoin(EmployeeProfile, EmployeeProfile.user_id == User.id)
        .where(User.company_id == company_id)
        .where(User.system_role == SystemRole.EMPLOYEE)
        .where(User.is_active.is_(True))
        .where(TimeShift.status == "completed")
        .where(TimeShift.clock_in_at >= range_start_utc)
        .where(TimeShift.clock_in_at < range_end_utc)
    )
    if user_id is not None:
        statement = statement.where(TimeShift.user_id == user_id)
    statement = statement.order_by(User.email.asc(), TimeShift.clock_in_at.asc())
    rows = db_session.execute(statement).all()
    return [(shift, location, owner, profile) for shift, location, owner, profile in rows]


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


def count_pending_payroll_items_for_company(db_session: Session, company_id: uuid.UUID) -> int:
    statement = (
        select(func.count())
        .select_from(PayrollItem)
        .where(PayrollItem.company_id == company_id)
        .where(PayrollItem.status == "pending")
    )
    return int(db_session.scalar(statement) or 0)


def pending_payroll_items_fingerprint_for_company(
    db_session: Session,
    company_id: uuid.UUID,
) -> tuple[int, datetime | None]:
    statement = (
        select(func.count(PayrollItem.id), func.max(PayrollItem.updated_at))
        .where(PayrollItem.company_id == company_id)
        .where(PayrollItem.status == "pending")
    )
    count, latest = db_session.execute(statement).one()
    return int(count or 0), latest


def count_rate_missing_payroll_items_for_company(db_session: Session, company_id: uuid.UUID) -> int:
    statement = (
        select(func.count())
        .select_from(PayrollItem)
        .where(PayrollItem.company_id == company_id)
        .where(PayrollItem.rate_missing.is_(True))
    )
    return int(db_session.scalar(statement) or 0)


def count_approved_paid_items_for_user_since_week_start(
    db_session: Session,
    user_id: uuid.UUID,
    *,
    min_period_week_start: date,
) -> int:
    """Approved/paid rows for pay history visibility; scoped by payroll period week_start (v1 payslip bell count)."""
    statement = (
        select(func.count())
        .select_from(PayrollItem)
        .join(PayrollPeriod, PayrollItem.period_id == PayrollPeriod.id)
        .where(PayrollItem.user_id == user_id)
        .where(PayrollItem.status.in_(("approved", "paid")))
        .where(PayrollPeriod.week_start >= min_period_week_start)
    )
    return int(db_session.scalar(statement) or 0)


def list_payroll_items_for_user_company_ytd_calendar_year(
    db_session: Session,
    *,
    user_id: uuid.UUID,
    company_id: uuid.UUID,
    calendar_year: int,
    through_week_start: date,
) -> list[PayrollItem]:
    """Approved/paid items for user+company with period.week_start in [Jan 1, min(through, Dec 31)] of calendar_year."""
    year_start = date(calendar_year, 1, 1)
    year_end = date(calendar_year, 12, 31)
    cap = through_week_start if through_week_start <= year_end else year_end
    statement = (
        select(PayrollItem)
        .join(PayrollPeriod, PayrollItem.period_id == PayrollPeriod.id)
        .where(PayrollItem.user_id == user_id)
        .where(PayrollItem.company_id == company_id)
        .where(PayrollItem.status.in_(("approved", "paid")))
        .where(PayrollPeriod.week_start >= year_start)
        .where(PayrollPeriod.week_start <= cap)
        .order_by(PayrollPeriod.week_start.asc())
    )
    return list(db_session.scalars(statement).all())
