from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.payroll_policies.models import LocationPayrollPolicy


def get_policy_by_location_id(db_session: Session, location_id: uuid.UUID) -> LocationPayrollPolicy | None:
    statement = select(LocationPayrollPolicy).where(LocationPayrollPolicy.location_id == location_id)
    return db_session.scalar(statement)


def list_policies_for_company(db_session: Session, company_id: uuid.UUID) -> list[LocationPayrollPolicy]:
    statement = (
        select(LocationPayrollPolicy)
        .where(LocationPayrollPolicy.company_id == company_id)
        .order_by(LocationPayrollPolicy.updated_at.desc())
    )
    return list(db_session.scalars(statement).all())


def delete_policy_for_location(db_session: Session, location_id: uuid.UUID) -> bool:
    row = get_policy_by_location_id(db_session, location_id)
    if row is None:
        return False
    db_session.delete(row)
    db_session.commit()
    return True


def upsert_policy(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    location_id: uuid.UUID,
    is_enabled: bool,
    standard_start_time: str | None,
    allow_early_clock_in: bool | None,
    break_deduction_after_minutes: int | None,
    break_deduction_minutes: int | None,
    rounding_increment_minutes: int | None,
    rounding_mode: str | None,
    notes: str | None,
    actor_user_id: uuid.UUID,
) -> tuple[LocationPayrollPolicy, bool]:
    """Returns (row, created) where created is True if inserted."""
    now = datetime.now(timezone.utc)
    row = get_policy_by_location_id(db_session, location_id)
    created = row is None
    if row is None:
        row = LocationPayrollPolicy(
            company_id=company_id,
            location_id=location_id,
            is_enabled=is_enabled,
            standard_start_time=standard_start_time,
            allow_early_clock_in=allow_early_clock_in,
            break_deduction_after_minutes=break_deduction_after_minutes,
            break_deduction_minutes=break_deduction_minutes,
            rounding_increment_minutes=rounding_increment_minutes,
            rounding_mode=rounding_mode,
            notes=notes,
            created_by_user_id=actor_user_id,
            updated_by_user_id=actor_user_id,
            created_at=now,
            updated_at=now,
        )
        db_session.add(row)
    else:
        row.company_id = company_id
        row.is_enabled = is_enabled
        row.standard_start_time = standard_start_time
        row.allow_early_clock_in = allow_early_clock_in
        row.break_deduction_after_minutes = break_deduction_after_minutes
        row.break_deduction_minutes = break_deduction_minutes
        row.rounding_increment_minutes = rounding_increment_minutes
        row.rounding_mode = rounding_mode
        row.notes = notes
        row.updated_by_user_id = actor_user_id
        row.updated_at = now
    db_session.commit()
    db_session.refresh(row)
    return row, created
