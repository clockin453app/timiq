import uuid
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import Company
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.site_access.models import EmployeeLocationAccess
from app.modules.time_clock.models import TimeShift


def list_manageable_employees(
    db_session: Session,
    *,
    actor: User,
    company_id: uuid.UUID | None,
    location_id: uuid.UUID | None,
    search: str | None,
) -> list[tuple[User, EmployeeProfile | None]]:
    ep = EmployeeProfile
    statement = (
        select(User, ep)
        .outerjoin(ep, ep.user_id == User.id)
        .where(User.system_role == SystemRole.EMPLOYEE)
        .where(User.is_active.is_(True))
    )

    if actor.system_role == SystemRole.ADMINISTRATOR:
        if company_id is not None:
            statement = statement.where(User.company_id == company_id)
    elif actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            return []
        statement = statement.where(User.company_id == actor.company_id)
    else:
        return []

    if search is not None and search.strip():
        q = f"%{search.strip().lower()}%"
        statement = statement.where(
            or_(
                User.email.ilike(q),
                ep.first_name.ilike(q),
                ep.last_name.ilike(q),
            ),
        )

    if location_id is not None:
        access_exists = (
            select(EmployeeLocationAccess.id)
            .where(EmployeeLocationAccess.user_id == User.id)
            .where(EmployeeLocationAccess.location_id == location_id)
            .exists()
        )
        statement = statement.where(access_exists)

    statement = statement.order_by(User.email.asc())
    rows = db_session.execute(statement).all()
    out: list[tuple[User, EmployeeProfile | None]] = []
    for row in rows:
        u = row[0]
        p = row[1]
        out.append((u, p if isinstance(p, EmployeeProfile) else None))
    return out


def get_company_name(db_session: Session, company_id: uuid.UUID | None) -> str | None:
    if company_id is None:
        return None
    c = db_session.scalar(select(Company).where(Company.id == company_id))
    return c.name if c is not None else None


def get_open_shift_for_user(db_session: Session, user_id: uuid.UUID) -> TimeShift | None:
    statement = (
        select(TimeShift)
        .where(TimeShift.user_id == user_id)
        .where(TimeShift.status == "open")
        .order_by(TimeShift.clock_in_at.desc())
    )
    return db_session.scalar(statement)


def employee_has_location_access(
    db_session: Session,
    *,
    user_id: uuid.UUID,
    location_id: uuid.UUID,
) -> bool:
    statement = select(EmployeeLocationAccess.id).where(
        EmployeeLocationAccess.user_id == user_id,
        EmployeeLocationAccess.location_id == location_id,
    )
    return db_session.scalar(statement.limit(1)) is not None


def list_completed_shifts_clocked_out_in_range(
    db_session: Session,
    *,
    user_id: uuid.UUID,
    range_start_utc: datetime,
    range_end_utc: datetime,
) -> list[TimeShift]:
    statement = (
        select(TimeShift)
        .where(TimeShift.user_id == user_id)
        .where(TimeShift.status == "completed")
        .where(TimeShift.clock_out_at.is_not(None))
        .where(TimeShift.clock_out_at >= range_start_utc)
        .where(TimeShift.clock_out_at < range_end_utc)
        .order_by(TimeShift.clock_out_at.desc())
    )
    return list(db_session.scalars(statement).all())
