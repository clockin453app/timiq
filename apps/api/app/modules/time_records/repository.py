import uuid
from datetime import datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.locations.models import Location
from app.modules.time_clock.models import TimeShift


def list_time_shifts_for_records(
    db_session: Session,
    *,
    viewer: User,
    start_utc: datetime | None,
    end_utc: datetime | None,
    location_id: uuid.UUID | None,
    status: str | None,
    filter_user_id: uuid.UUID | None,
    filter_company_id: uuid.UUID | None,
    limit: int,
    offset: int,
) -> list[tuple[TimeShift, Location, User, EmployeeProfile | None]]:
    statement = (
        select(TimeShift, Location, User, EmployeeProfile)
        .join(Location, TimeShift.location_id == Location.id)
        .join(User, TimeShift.user_id == User.id)
        .outerjoin(EmployeeProfile, EmployeeProfile.user_id == User.id)
    )

    if viewer.system_role == SystemRole.EMPLOYEE:
        statement = statement.where(TimeShift.user_id == viewer.id)
    elif viewer.system_role == SystemRole.ADMIN:
        statement = statement.where(
            User.company_id == viewer.company_id,
            User.system_role == SystemRole.EMPLOYEE,
        )
    elif viewer.system_role == SystemRole.ADMINISTRATOR:
        if filter_company_id is not None:
            statement = statement.where(
                or_(
                    TimeShift.company_id == filter_company_id,
                    Location.company_id == filter_company_id,
                )
            )

    if filter_user_id is not None:
        statement = statement.where(TimeShift.user_id == filter_user_id)

    if start_utc is not None:
        statement = statement.where(TimeShift.clock_in_at >= start_utc)

    if end_utc is not None:
        statement = statement.where(TimeShift.clock_in_at < end_utc)

    if location_id is not None:
        statement = statement.where(TimeShift.location_id == location_id)

    if status is not None:
        statement = statement.where(TimeShift.status == status)

    statement = statement.order_by(TimeShift.clock_in_at.desc()).limit(limit).offset(offset)

    rows = db_session.execute(statement).all()
    return [(shift, location, owner, profile) for shift, location, owner, profile in rows]


def list_time_shifts_for_week(
    db_session: Session,
    *,
    viewer: User,
    subject_user_id: uuid.UUID,
    week_start_utc: datetime,
    week_end_utc: datetime,
) -> list[tuple[TimeShift, Location, User, EmployeeProfile | None]]:
    statement = (
        select(TimeShift, Location, User, EmployeeProfile)
        .join(Location, TimeShift.location_id == Location.id)
        .join(User, TimeShift.user_id == User.id)
        .outerjoin(EmployeeProfile, EmployeeProfile.user_id == User.id)
        .where(TimeShift.user_id == subject_user_id)
        .where(
            and_(
                TimeShift.clock_in_at >= week_start_utc,
                TimeShift.clock_in_at < week_end_utc,
            )
        )
        .order_by(TimeShift.clock_in_at.asc())
    )

    if viewer.system_role == SystemRole.ADMIN:
        statement = statement.where(
            User.company_id == viewer.company_id,
            User.system_role == SystemRole.EMPLOYEE,
        )

    rows = db_session.execute(statement).all()
    return [(shift, location, owner, profile) for shift, location, owner, profile in rows]


def list_time_shifts_for_payroll_week(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    subject_user_id: uuid.UUID,
    week_start_utc: datetime,
    week_end_utc: datetime,
) -> list[tuple[TimeShift, Location, User, EmployeeProfile | None]]:
    """Completed shifts for payroll aggregation (company scoped; no viewer-role filter)."""
    statement = (
        select(TimeShift, Location, User, EmployeeProfile)
        .join(Location, TimeShift.location_id == Location.id)
        .join(User, TimeShift.user_id == User.id)
        .outerjoin(EmployeeProfile, EmployeeProfile.user_id == User.id)
        .where(TimeShift.user_id == subject_user_id)
        .where(
            or_(
                TimeShift.company_id == company_id,
                Location.company_id == company_id,
            ),
        )
        .where(
            and_(
                TimeShift.clock_in_at >= week_start_utc,
                TimeShift.clock_in_at < week_end_utc,
            ),
        )
        .where(TimeShift.status == "completed")
        .order_by(TimeShift.clock_in_at.asc())
    )
    rows = db_session.execute(statement).all()
    return [(shift, location, owner, profile) for shift, location, owner, profile in rows]
