import uuid
from datetime import datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
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
