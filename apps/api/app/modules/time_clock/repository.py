import uuid
from datetime import datetime

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.modules.locations.models import Location
from app.modules.site_access.models import EmployeeLocationAccess
from app.modules.time_clock.models import ClockSelfie, TimeShift, TimeShiftBreak


def get_open_shift_for_user(db_session: Session, user_id: uuid.UUID) -> TimeShift | None:
    statement = (
        select(TimeShift)
        .where(TimeShift.user_id == user_id)
        .where(TimeShift.status == "open")
        .order_by(TimeShift.clock_in_at.desc())
    )
    return db_session.scalar(statement)


def has_completed_shift_for_user_on_utc_day(
    db_session: Session,
    user_id: uuid.UUID,
    day_start_utc: datetime,
    day_end_utc: datetime,
) -> bool:
    statement = (
        select(TimeShift.id)
        .where(TimeShift.user_id == user_id)
        .where(TimeShift.status == "completed")
        .where(TimeShift.clock_in_at >= day_start_utc)
        .where(TimeShift.clock_in_at < day_end_utc)
        .limit(1)
    )
    return db_session.scalar(statement) is not None


def list_active_assigned_locations_for_user(
    db_session: Session,
    user_id: uuid.UUID,
) -> list[Location]:
    statement = (
        select(Location)
        .join(
            EmployeeLocationAccess,
            and_(
                EmployeeLocationAccess.location_id == Location.id,
                EmployeeLocationAccess.user_id == user_id,
            ),
        )
        .where(Location.is_active.is_(True))
        .order_by(Location.created_at.desc())
    )
    return list(db_session.scalars(statement).all())


def save_shift(db_session: Session, shift: TimeShift, *, commit: bool = True) -> TimeShift:
    db_session.add(shift)
    if commit:
        db_session.commit()
    else:
        db_session.flush()
    db_session.refresh(shift)
    return shift


def update_shift(db_session: Session, shift: TimeShift, *, commit: bool = True) -> TimeShift:
    db_session.add(shift)
    if commit:
        db_session.commit()
    else:
        db_session.flush()
    db_session.refresh(shift)
    return shift


def get_open_break_for_shift(
    db_session: Session,
    time_shift_id: uuid.UUID,
) -> TimeShiftBreak | None:
    statement = (
        select(TimeShiftBreak)
        .where(TimeShiftBreak.time_shift_id == time_shift_id)
        .where(TimeShiftBreak.ended_at.is_(None))
        .order_by(TimeShiftBreak.started_at.desc())
    )
    return db_session.scalar(statement)


def list_breaks_for_shift(
    db_session: Session,
    time_shift_id: uuid.UUID,
) -> list[TimeShiftBreak]:
    statement = (
        select(TimeShiftBreak)
        .where(TimeShiftBreak.time_shift_id == time_shift_id)
        .order_by(TimeShiftBreak.started_at.asc())
    )
    return list(db_session.scalars(statement).all())


def save_break(db_session: Session, shift_break: TimeShiftBreak) -> TimeShiftBreak:
    db_session.add(shift_break)
    db_session.commit()
    db_session.refresh(shift_break)
    return shift_break


def update_break(db_session: Session, shift_break: TimeShiftBreak) -> TimeShiftBreak:
    db_session.add(shift_break)
    db_session.commit()
    db_session.refresh(shift_break)
    return shift_break


def save_clock_selfie(db_session: Session, selfie: ClockSelfie, *, commit: bool = True) -> ClockSelfie:
    db_session.add(selfie)
    if commit:
        db_session.commit()
    else:
        db_session.flush()
    db_session.refresh(selfie)
    return selfie


def get_clock_selfie_for_shift_phase(
    db_session: Session,
    time_shift_id: uuid.UUID,
    phase: str,
) -> ClockSelfie | None:
    statement = (
        select(ClockSelfie)
        .where(ClockSelfie.time_shift_id == time_shift_id)
        .where(ClockSelfie.phase == phase)
        .limit(1)
    )
    return db_session.scalar(statement)


def list_clock_selfies_with_shifts_for_user(
    db_session: Session,
    user_id: uuid.UUID,
    *,
    limit: int,
    offset: int,
) -> list[tuple[ClockSelfie, TimeShift]]:
    statement = (
        select(ClockSelfie, TimeShift)
        .join(TimeShift, ClockSelfie.time_shift_id == TimeShift.id)
        .where(TimeShift.user_id == user_id)
        .order_by(ClockSelfie.captured_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = db_session.execute(statement).all()
    return [(selfie, shift) for selfie, shift in rows]


def get_clock_selfie_and_shift_by_id(
    db_session: Session,
    selfie_id: uuid.UUID,
) -> tuple[ClockSelfie, TimeShift] | None:
    statement = (
        select(ClockSelfie, TimeShift)
        .join(TimeShift, ClockSelfie.time_shift_id == TimeShift.id)
        .where(ClockSelfie.id == selfie_id)
        .limit(1)
    )
    row = db_session.execute(statement).first()
    if row is None:
        return None
    selfie, shift = row
    return selfie, shift
