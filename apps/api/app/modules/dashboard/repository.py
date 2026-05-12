import uuid
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.companies.service import ensure_company_time_policy
from app.modules.locations.models import Location
from app.modules.payroll.models import PayrollItem, PayrollPeriod
from app.modules.payroll.repository import list_employee_users_for_company
from app.modules.time_clock.models import TimeShift
from app.modules.workplaces.models import Workplace


def count_active_employees_for_company(db_session: Session, company_id: uuid.UUID) -> int:
    return len(list_employee_users_for_company(db_session, company_id))


def count_active_locations_for_company(db_session: Session, company_id: uuid.UUID) -> int:
    statement = (
        select(func.count())
        .select_from(Location)
        .where(Location.company_id == company_id)
        .where(Location.is_active.is_(True))
    )
    return int(db_session.scalar(statement) or 0)


def count_active_workplaces_for_company(db_session: Session, company_id: uuid.UUID) -> int:
    statement = (
        select(func.count())
        .select_from(Workplace)
        .where(Workplace.company_id == company_id)
        .where(Workplace.is_active.is_(True))
    )
    return int(db_session.scalar(statement) or 0)


def local_day_bounds_utc(db_session: Session, company_id: uuid.UUID, local_day: date) -> tuple[datetime, datetime]:
    policy = ensure_company_time_policy(db_session, company_id)
    try:
        tz = ZoneInfo(policy.timezone_name)
    except Exception:
        tz = ZoneInfo("UTC")
    start_local = datetime.combine(local_day, time.min, tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def today_local_date(db_session: Session, company_id: uuid.UUID, now_utc: datetime) -> date:
    policy = ensure_company_time_policy(db_session, company_id)
    try:
        tz = ZoneInfo(policy.timezone_name)
    except Exception:
        tz = ZoneInfo("UTC")
    return now_utc.astimezone(tz).date()


def current_week_monday_local(db_session: Session, company_id: uuid.UUID, now_utc: datetime) -> date:
    td = today_local_date(db_session, company_id, now_utc)
    return td - timedelta(days=td.weekday())


def count_present_employees_for_range(
    db_session: Session,
    company_id: uuid.UUID,
    range_start_utc: datetime,
    range_end_utc: datetime,
) -> int:
    """Employees with any shift overlapping [range_start_utc, range_end_utc)."""
    statement = (
        select(func.count(func.distinct(TimeShift.user_id)))
        .select_from(TimeShift)
        .join(User, TimeShift.user_id == User.id)
        .where(User.company_id == company_id)
        .where(User.system_role == SystemRole.EMPLOYEE)
        .where(User.is_active.is_(True))
        .where(TimeShift.clock_in_at < range_end_utc)
        .where(or_(TimeShift.clock_out_at.is_(None), TimeShift.clock_out_at > range_start_utc))
    )
    return int(db_session.scalar(statement) or 0)


def attendance_trend_last_local_days(
    db_session: Session,
    company_id: uuid.UUID,
    *,
    days: int,
    now_utc: datetime,
) -> list[dict]:
    end_local = today_local_date(db_session, company_id, now_utc)
    total_employees = count_active_employees_for_company(db_session, company_id)
    out: list[dict] = []
    for i in range(days - 1, -1, -1):
        local_day = end_local - timedelta(days=i)
        rs, re_ = local_day_bounds_utc(db_session, company_id, local_day)
        present = count_present_employees_for_range(db_session, company_id, rs, re_)
        rate: float | None = None
        if total_employees > 0:
            rate = round(present / total_employees, 4)
        out.append(
            {
                "date": local_day.isoformat(),
                "present_count": present,
                "total_employees": total_employees,
                "attendance_rate": rate,
            },
        )
    return out


def payroll_trend_recent_weeks(
    db_session: Session,
    company_id: uuid.UUID,
    *,
    weeks: int,
) -> list[dict]:
    statement = (
        select(PayrollPeriod.week_start)
        .where(PayrollPeriod.company_id == company_id)
        .distinct()
        .order_by(PayrollPeriod.week_start.desc())
        .limit(weeks)
    )
    week_rows = list(db_session.scalars(statement).all())
    if not week_rows:
        return []
    week_starts = sorted(week_rows)
    out: list[dict] = []
    for ws in week_starts:
        gross_stmt = (
            select(func.coalesce(func.sum(PayrollItem.gross_amount), 0))
            .select_from(PayrollItem)
            .join(PayrollPeriod, PayrollItem.period_id == PayrollPeriod.id)
            .where(PayrollPeriod.company_id == company_id)
            .where(PayrollPeriod.week_start == ws)
        )
        gross_val = db_session.scalar(gross_stmt)
        secs_stmt = (
            select(func.coalesce(func.sum(PayrollItem.rounded_total_seconds), 0))
            .select_from(PayrollItem)
            .join(PayrollPeriod, PayrollItem.period_id == PayrollPeriod.id)
            .where(PayrollPeriod.company_id == company_id)
            .where(PayrollPeriod.week_start == ws)
        )
        secs_val = int(db_session.scalar(secs_stmt) or 0)
        out.append(
            {
                "week_start": ws.isoformat(),
                "total_gross": float(gross_val or 0),
                "total_hours_seconds": secs_val,
            },
        )
    return out


def list_recent_non_employee_shifts(
    db_session: Session,
    company_id: uuid.UUID,
    *,
    limit: int,
) -> list[TimeShift]:
    statement = (
        select(TimeShift)
        .join(User, TimeShift.user_id == User.id)
        .where(User.company_id == company_id)
        .where(or_(TimeShift.clock_source != "employee", TimeShift.admin_actor_user_id.is_not(None)))
        .order_by(TimeShift.updated_at.desc())
        .limit(limit)
    )
    return list(db_session.scalars(statement).all())


def list_recent_payroll_items(
    db_session: Session,
    company_id: uuid.UUID,
    *,
    limit: int,
) -> list[tuple[PayrollItem, PayrollPeriod]]:
    statement = (
        select(PayrollItem, PayrollPeriod)
        .join(PayrollPeriod, PayrollItem.period_id == PayrollPeriod.id)
        .where(PayrollPeriod.company_id == company_id)
        .order_by(PayrollItem.updated_at.desc())
        .limit(limit)
    )
    rows = db_session.execute(statement).all()
    return [(row[0], row[1]) for row in rows]


def aggregate_active_counts(
    db_session: Session,
    company_ids: list[uuid.UUID],
) -> tuple[int, int, int]:
    """Sum active employees, locations, and workplaces across companies."""
    if not company_ids:
        return 0, 0, 0
    emp = 0
    loc = 0
    wp = 0
    for cid in company_ids:
        emp += count_active_employees_for_company(db_session, cid)
        loc += count_active_locations_for_company(db_session, cid)
        wp += count_active_workplaces_for_company(db_session, cid)
    return emp, loc, wp
