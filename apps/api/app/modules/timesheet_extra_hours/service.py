"""Business rules for payable timesheet hours adjustments.

Payable create/update/delete mark the affected payroll week stale via the
existing invalidation pathway. Money is never computed here — only through
payroll recalculation.

Mutation + audit + stale marker share one DB transaction (flush then audit commit).
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy.orm import Session

from app.core.company_scope import CompanyScopeError, resolve_operational_company_id
from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id
from app.modules.locations.repository import get_location_by_id
from app.modules.payroll.repository import (
    get_period_by_company_week,
    period_has_approved_item,
    period_has_paid_item,
)
from app.modules.payroll.service import (
    mark_payroll_period_needs_recalculation,
    payroll_week_start_for_work_date,
)
from app.modules.timesheet_extra_hours import repository as repo
from app.modules.timesheet_extra_hours.models import TimesheetExtraHours
from app.modules.timesheet_extra_hours.schemas import (
    EXTRA_HOURS_REASONS,
    TimesheetExtraHoursCreate,
    TimesheetExtraHoursPatch,
    TimesheetExtraHoursResponse,
)


class ExtraHoursError(ValueError):
    pass


class ExtraHoursPermissionError(PermissionError):
    pass


def _assert_admin(actor: User) -> None:
    if actor.system_role not in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        raise ExtraHoursPermissionError("Admin or Administrator role required.")


def _display_name_for_user(db_session: Session, user_id: uuid.UUID | None) -> str | None:
    if user_id is None:
        return None
    profile = get_employee_profile_by_user_id(db_session, user_id)
    if profile is None:
        return None
    parts = [profile.first_name or "", profile.last_name or ""]
    name = " ".join(p for p in parts if p).strip()
    return name or None


def _to_response(
    db_session: Session,
    row: TimesheetExtraHours,
) -> TimesheetExtraHoursResponse:
    employee = get_user_by_id(db_session, row.user_id)
    creator = get_user_by_id(db_session, row.created_by_user_id) if row.created_by_user_id else None
    location_name = None
    if row.location_id is not None:
        loc = get_location_by_id(db_session, row.location_id)
        location_name = loc.name if loc is not None else None
    return TimesheetExtraHoursResponse(
        id=row.id,
        company_id=row.company_id,
        user_id=row.user_id,
        work_date=row.work_date,
        duration_minutes=row.duration_minutes,
        reason=row.reason,  # type: ignore[arg-type]
        note=row.note,
        location_id=row.location_id,
        affects_payroll=bool(row.affects_payroll),
        created_by_user_id=row.created_by_user_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        deleted_at=row.deleted_at,
        employee_name=_display_name_for_user(db_session, row.user_id),
        employee_email=employee.email if employee else None,
        location_name=location_name,
        created_by_name=_display_name_for_user(db_session, row.created_by_user_id),
        created_by_email=creator.email if creator else None,
    )


def _validate_subject(db_session: Session, company_id: uuid.UUID, user_id: uuid.UUID) -> User:
    subject = get_user_by_id(db_session, user_id)
    if subject is None:
        raise ExtraHoursError("Employee not found.")
    if subject.company_id != company_id:
        raise ExtraHoursError("Employee is not in this company.")
    if subject.system_role != SystemRole.EMPLOYEE:
        raise ExtraHoursError("Extra hours can only be recorded for employees.")
    return subject


def _validate_location(
    db_session: Session,
    company_id: uuid.UUID,
    location_id: uuid.UUID | None,
) -> None:
    if location_id is None:
        return
    loc = get_location_by_id(db_session, location_id)
    if loc is None:
        raise ExtraHoursError("Site not found.")
    if loc.company_id != company_id:
        raise ExtraHoursError("Site is not in this company.")


def _assert_payroll_period_allows_payable_mutation(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    week_starts: set[date],
) -> None:
    """Block payable adjustments when the week is approved or paid (same as recalc locks)."""
    for week_start in sorted(week_starts):
        period = get_period_by_company_week(db_session, company_id, week_start)
        if period is None:
            continue
        if period_has_paid_item(db_session, period.id):
            raise ExtraHoursError(
                "Cannot change payable hours: this period contains paid payroll items. "
                "Undo paid / reopen before adjusting.",
            )
        if period_has_approved_item(db_session, period.id):
            raise ExtraHoursError(
                "Payroll is approved. Unlock it before changing payable hours adjustments.",
            )


def _mark_payable_weeks_stale(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    week_starts: set[date],
) -> None:
    """Flush-only invalidation so audit can commit mutation + stale marker together."""
    for week_start in sorted(week_starts):
        mark_payroll_period_needs_recalculation(
            db_session,
            company_id=company_id,
            week_start=week_start,
            commit=False,
        )


def create_extra_hours(
    db_session: Session,
    actor: User,
    body: TimesheetExtraHoursCreate,
) -> TimesheetExtraHoursResponse:
    _assert_admin(actor)
    try:
        company_id = resolve_operational_company_id(db_session, actor, body.company_id)
    except CompanyScopeError as exc:
        raise ExtraHoursPermissionError(str(exc)) from exc

    if body.duration_minutes < 1:
        raise ExtraHoursError("Duration must be greater than zero.")
    if body.reason not in EXTRA_HOURS_REASONS:
        raise ExtraHoursError("Invalid reason.")

    _validate_subject(db_session, company_id, body.user_id)
    _validate_location(db_session, company_id, body.location_id)

    week_start = payroll_week_start_for_work_date(body.work_date)
    _assert_payroll_period_allows_payable_mutation(
        db_session,
        company_id=company_id,
        week_starts={week_start},
    )

    row = TimesheetExtraHours(
        company_id=company_id,
        user_id=body.user_id,
        work_date=body.work_date,
        duration_minutes=body.duration_minutes,
        reason=body.reason,
        note=body.note,
        location_id=body.location_id,
        affects_payroll=True,
        created_by_user_id=actor.id,
    )
    try:
        row = repo.add(db_session, row)
        _mark_payable_weeks_stale(
            db_session,
            company_id=company_id,
            week_starts={week_start},
        )
        create_internal_audit_event(
            db_session=db_session,
            actor=actor,
            action="timesheet_extra_hours.created",
            entity_type="timesheet_extra_hours",
            entity_id=str(row.id),
            company_id=company_id,
            details={
                "company_id": str(company_id),
                "user_id": str(body.user_id),
                "work_date": str(body.work_date),
                "duration_minutes": body.duration_minutes,
                "reason": body.reason,
                "actor_user_id": str(actor.id),
                "affects_payroll": True,
                "payroll_week_start": str(week_start),
            },
        )
        return _to_response(db_session, row)
    except Exception:
        db_session.rollback()
        raise


def patch_extra_hours(
    db_session: Session,
    actor: User,
    entry_id: uuid.UUID,
    body: TimesheetExtraHoursPatch,
) -> TimesheetExtraHoursResponse:
    _assert_admin(actor)
    row = repo.get_by_id(db_session, entry_id)
    if row is None or row.deleted_at is not None:
        raise ExtraHoursError("Extra hours entry not found.")
    try:
        company_id = resolve_operational_company_id(db_session, actor, row.company_id)
    except CompanyScopeError as exc:
        raise ExtraHoursPermissionError(str(exc)) from exc
    if row.company_id != company_id:
        raise ExtraHoursPermissionError("You cannot access another company's data.")

    data = body.model_dump(exclude_unset=True)
    if "company_id" in data or "user_id" in data:
        raise ExtraHoursError("Company and employee ownership cannot be changed.")
    if "duration_minutes" in data and data["duration_minutes"] is not None and data["duration_minutes"] < 1:
        raise ExtraHoursError("Duration must be greater than zero.")
    if "reason" in data and data["reason"] is not None and data["reason"] not in EXTRA_HOURS_REASONS:
        raise ExtraHoursError("Invalid reason.")
    if "location_id" in data:
        _validate_location(db_session, company_id, data["location_id"])

    original_work_date = row.work_date
    old_week = payroll_week_start_for_work_date(original_work_date)
    old_affects = bool(row.affects_payroll)

    if "work_date" in data and data["work_date"] is not None:
        row.work_date = data["work_date"]
    if "duration_minutes" in data and data["duration_minutes"] is not None:
        row.duration_minutes = data["duration_minutes"]
    if "reason" in data and data["reason"] is not None:
        row.reason = data["reason"]
    if "note" in data:
        row.note = data["note"]
    if "location_id" in data:
        row.location_id = data["location_id"]

    new_week = payroll_week_start_for_work_date(row.work_date)
    weeks_to_check: set[date] = set()
    if old_affects:
        weeks_to_check.add(old_week)
    if bool(row.affects_payroll):
        weeks_to_check.add(new_week)
    if weeks_to_check:
        _assert_payroll_period_allows_payable_mutation(
            db_session,
            company_id=company_id,
            week_starts=weeks_to_check,
        )

    try:
        row = repo.save(db_session, row)
        weeks_to_invalidate: set[date] = set()
        if old_affects:
            weeks_to_invalidate.add(old_week)
        if bool(row.affects_payroll):
            weeks_to_invalidate.add(new_week)
        if weeks_to_invalidate:
            _mark_payable_weeks_stale(
                db_session,
                company_id=company_id,
                week_starts=weeks_to_invalidate,
            )
        create_internal_audit_event(
            db_session=db_session,
            actor=actor,
            action="timesheet_extra_hours.updated",
            entity_type="timesheet_extra_hours",
            entity_id=str(row.id),
            company_id=company_id,
            details={
                "company_id": str(company_id),
                "user_id": str(row.user_id),
                "work_date": str(row.work_date),
                "original_work_date": str(original_work_date),
                "duration_minutes": row.duration_minutes,
                "reason": row.reason,
                "changed_fields": sorted(data.keys()),
                "actor_user_id": str(actor.id),
                "affects_payroll": bool(row.affects_payroll),
                "payroll_week_starts": sorted(str(w) for w in weeks_to_invalidate),
            },
        )
        return _to_response(db_session, row)
    except Exception:
        db_session.rollback()
        raise


def delete_extra_hours(
    db_session: Session,
    actor: User,
    entry_id: uuid.UUID,
) -> None:
    _assert_admin(actor)
    row = repo.get_by_id(db_session, entry_id)
    if row is None or row.deleted_at is not None:
        raise ExtraHoursError("Extra hours entry not found.")
    try:
        company_id = resolve_operational_company_id(db_session, actor, row.company_id)
    except CompanyScopeError as exc:
        raise ExtraHoursPermissionError(str(exc)) from exc
    if row.company_id != company_id:
        raise ExtraHoursPermissionError("You cannot access another company's data.")

    week_start = payroll_week_start_for_work_date(row.work_date)
    affects = bool(row.affects_payroll)
    if affects:
        _assert_payroll_period_allows_payable_mutation(
            db_session,
            company_id=company_id,
            week_starts={week_start},
        )

    snapshot = {
        "company_id": str(company_id),
        "user_id": str(row.user_id),
        "work_date": str(row.work_date),
        "duration_minutes": row.duration_minutes,
        "reason": row.reason,
        "actor_user_id": str(actor.id),
        "affects_payroll": affects,
        "payroll_week_start": str(week_start),
    }
    try:
        repo.soft_delete(db_session, row)
        if affects:
            _mark_payable_weeks_stale(
                db_session,
                company_id=company_id,
                week_starts={week_start},
            )
        create_internal_audit_event(
            db_session=db_session,
            actor=actor,
            action="timesheet_extra_hours.deleted",
            entity_type="timesheet_extra_hours",
            entity_id=str(row.id),
            company_id=company_id,
            details=snapshot,
        )
    except Exception:
        db_session.rollback()
        raise


def list_extra_hours_for_admin(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    user_id: uuid.UUID | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    location_id: uuid.UUID | None = None,
) -> list[TimesheetExtraHoursResponse]:
    _assert_admin(actor)
    try:
        resolved = resolve_operational_company_id(db_session, actor, company_id)
    except CompanyScopeError as exc:
        raise ExtraHoursPermissionError(str(exc)) from exc
    rows = repo.list_entries(
        db_session,
        company_id=resolved,
        user_id=user_id,
        start_date=start_date,
        end_date=end_date,
        location_id=location_id,
    )
    return [_to_response(db_session, r) for r in rows]


def list_extra_hours_for_me(
    db_session: Session,
    actor: User,
    *,
    start_date: date | None = None,
    end_date: date | None = None,
) -> list[TimesheetExtraHoursResponse]:
    if actor.company_id is None:
        raise ExtraHoursError("Your account is not assigned to a company.")
    rows = repo.list_entries(
        db_session,
        company_id=actor.company_id,
        user_id=actor.id,
        start_date=start_date,
        end_date=end_date,
    )
    return [_to_response(db_session, r) for r in rows]


def informational_total_minutes(rows: list[TimesheetExtraHours]) -> int:
    """Sum duration for display — callers must filter payable vs non-payroll as needed."""
    return repo.sum_duration_minutes(rows)
