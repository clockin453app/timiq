"""Repository for timesheet hours adjustments.

Mutations flush only; the service commits once with the audit event
(same pattern as privacy acknowledgement / accounting settings).
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.timesheet_extra_hours.models import TimesheetExtraHours


def get_by_id(db_session: Session, entry_id: uuid.UUID) -> TimesheetExtraHours | None:
    return db_session.get(TimesheetExtraHours, entry_id)


def list_entries(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    location_id: uuid.UUID | None = None,
    include_deleted: bool = False,
    affects_payroll: bool | None = None,
) -> list[TimesheetExtraHours]:
    stmt = select(TimesheetExtraHours).where(TimesheetExtraHours.company_id == company_id)
    if not include_deleted:
        stmt = stmt.where(TimesheetExtraHours.deleted_at.is_(None))
    if user_id is not None:
        stmt = stmt.where(TimesheetExtraHours.user_id == user_id)
    if start_date is not None:
        stmt = stmt.where(TimesheetExtraHours.work_date >= start_date)
    if end_date is not None:
        # Exclusive end - same contract as Time Records list filters.
        stmt = stmt.where(TimesheetExtraHours.work_date < end_date)
    if location_id is not None:
        stmt = stmt.where(TimesheetExtraHours.location_id == location_id)
    if affects_payroll is not None:
        stmt = stmt.where(TimesheetExtraHours.affects_payroll.is_(affects_payroll))
    stmt = stmt.order_by(TimesheetExtraHours.work_date.asc(), TimesheetExtraHours.created_at.asc())
    return list(db_session.scalars(stmt).all())


def add(db_session: Session, row: TimesheetExtraHours) -> TimesheetExtraHours:
    db_session.add(row)
    db_session.flush()
    return row


def save(db_session: Session, row: TimesheetExtraHours) -> TimesheetExtraHours:
    db_session.add(row)
    db_session.flush()
    return row


def soft_delete(db_session: Session, row: TimesheetExtraHours) -> TimesheetExtraHours:
    row.deleted_at = datetime.now(timezone.utc)
    return save(db_session, row)


def sum_duration_minutes(rows: list[TimesheetExtraHours]) -> int:
    return sum(max(0, int(r.duration_minutes)) for r in rows if r.deleted_at is None)


def sum_payable_seconds_by_work_date(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    week_start: date,
) -> dict[date, int]:
    """Payable adjustment seconds keyed by work_date for one payroll week (Mon–Sun)."""
    end_date = date.fromordinal(week_start.toordinal() + 7)
    rows = list_entries(
        db_session,
        company_id=company_id,
        user_id=user_id,
        start_date=week_start,
        end_date=end_date,
        affects_payroll=True,
    )
    by_day: dict[date, int] = {}
    for row in rows:
        seconds = max(0, int(row.duration_minutes)) * 60
        by_day[row.work_date] = by_day.get(row.work_date, 0) + seconds
    return by_day
