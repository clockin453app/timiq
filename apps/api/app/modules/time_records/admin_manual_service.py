"""Admin-only manual time shift corrections (separate from employee GPS/selfie clocking)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.auth.service import can_manage_user
from app.modules.companies.service import ensure_company_time_policy
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id
from app.modules.locations.models import Location
from app.modules.locations.repository import get_location_by_id
from app.modules.payroll.models import PayrollItem
from app.modules.payroll.repository import get_period_by_company_week, list_items_for_period
from app.modules.payroll.service import mark_payroll_period_needs_recalculation
from app.modules.site_access.repository import get_site_access, list_site_access_for_user
from app.modules.time_clock.models import TimeShift, TimeShiftBreak
from app.modules.time_clock.repository import (
    get_open_break_for_shift,
    get_open_shift_for_user,
    list_breaks_for_shift,
    save_shift,
    update_break,
    update_shift,
)


class AdminTimeAdjustmentError(ValueError):
    def __init__(self, message: str, *, http_status: int = 400) -> None:
        super().__init__(message)
        self.http_status = http_status


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_reason(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        raise AdminTimeAdjustmentError("Reason is required.", http_status=422)
    if len(s) > 500:
        return s[:500]
    return s


def _resolve_break_seconds(break_seconds: int | None, break_minutes: int | None) -> int:
    if break_seconds is not None and break_minutes is not None:
        raise AdminTimeAdjustmentError("Provide only one of break_seconds or break_minutes.", http_status=422)
    if break_seconds is not None:
        return max(0, int(break_seconds))
    if break_minutes is not None:
        return max(0, int(break_minutes) * 60)
    return 0


def _monday_week_start_for_instant(policy_timezone: str, instant_utc: datetime) -> date:
    try:
        tz = ZoneInfo(policy_timezone)
    except Exception:
        tz = ZoneInfo("UTC")
    local = instant_utc.astimezone(tz)
    d = local.date()
    return d - timedelta(days=d.weekday())


def _payroll_item_for_user_week(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    week_start: date,
) -> PayrollItem | None:
    period = get_period_by_company_week(db_session, company_id, week_start)
    if period is None:
        return None
    for item in list_items_for_period(db_session, period.id):
        if item.user_id == user_id:
            return item
    return None


def _assert_payroll_allows_time_edit_for_weeks(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    week_starts: set[date],
) -> None:
    for ws in sorted(week_starts):
        item = _payroll_item_for_user_week(db_session, company_id=company_id, user_id=user_id, week_start=ws)
        if item is None:
            continue


def _mark_payroll_weeks_needing_recalculation(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    week_starts: set[date],
) -> None:
    for ws in sorted(week_starts):
        mark_payroll_period_needs_recalculation(
            db_session,
            company_id=company_id,
            week_start=ws,
        )


def _site_access_allows_location(db_session: Session, *, user_id: uuid.UUID, location_id: uuid.UUID) -> None:
    access_rows = list_site_access_for_user(db_session, user_id)
    if not access_rows:
        return
    if get_site_access(db_session, user_id, location_id) is None:
        raise AdminTimeAdjustmentError(
            "Employee does not have site access to this location.",
            http_status=422,
        )


def _validate_location_for_employee_company(
    db_session: Session,
    *,
    location: Location,
    employee_company_id: uuid.UUID | None,
) -> None:
    if employee_company_id is None:
        raise AdminTimeAdjustmentError("Employee has no company assignment.", http_status=422)
    if location.company_id != employee_company_id:
        raise AdminTimeAdjustmentError("Location does not belong to the employee's company.", http_status=422)
    if not location.is_active:
        raise AdminTimeAdjustmentError("Location is not active.", http_status=422)


def _validate_span_and_break(
    *,
    clock_in_at: datetime,
    clock_out_at: datetime,
    break_seconds: int,
) -> None:
    if clock_out_at <= clock_in_at:
        raise AdminTimeAdjustmentError("clock_out_at must be after clock_in_at.", http_status=422)
    span = int((clock_out_at - clock_in_at).total_seconds())
    if break_seconds < 0:
        raise AdminTimeAdjustmentError("break_seconds cannot be negative.", http_status=422)
    if break_seconds > span:
        raise AdminTimeAdjustmentError("Break cannot exceed the shift span.", http_status=422)


def _worked_seconds(clock_in_at: datetime, clock_out_at: datetime, break_seconds: int) -> int:
    span = int((clock_out_at - clock_in_at).total_seconds())
    return max(0, span - break_seconds)


def _gps_snapshot_from_location(location: Location) -> tuple[float, float, float, float]:
    """Synthetic GPS at site centre for admin-entered shifts (no real device fix)."""
    return (
        float(location.latitude),
        float(location.longitude),
        0.0,
        0.0,
    )


def _shift_to_response_row(
    db_session: Session,
    shift: TimeShift,
    location: Location,
    owner: User,
    profile: EmployeeProfile | None,
) -> object:
    from app.modules.time_records.service import _shift_to_row

    return _shift_to_row(db_session, shift, location, owner, profile, include_employee_fields=True)


def _audit(
    db_session: Session,
    *,
    actor: User,
    action: str,
    shift_id: uuid.UUID,
    company_id: uuid.UUID | None,
    subject_user_id: uuid.UUID,
    details: dict,
) -> None:
    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action=action,
        entity_type="time_shift",
        entity_id=str(shift_id),
        company_id=company_id,
        details=details,
    )


def admin_create_completed_shift(
    db_session: Session,
    actor: User,
    *,
    user_id: uuid.UUID,
    location_id: uuid.UUID,
    clock_in_at: datetime,
    clock_out_at: datetime,
    break_seconds: int | None,
    break_minutes: int | None,
    reason: str,
) -> tuple[object, bool, date | None, uuid.UUID]:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise AdminTimeAdjustmentError("Forbidden.", http_status=403)

    reason_n = _normalize_reason(reason)
    brk = _resolve_break_seconds(break_seconds, break_minutes)

    if clock_in_at.tzinfo is None:
        clock_in_at = clock_in_at.replace(tzinfo=timezone.utc)
    if clock_out_at.tzinfo is None:
        clock_out_at = clock_out_at.replace(tzinfo=timezone.utc)

    target = get_user_by_id(db_session, user_id)
    if target is None or target.system_role != SystemRole.EMPLOYEE:
        raise AdminTimeAdjustmentError("Target user is not a valid employee.", http_status=422)
    if not can_manage_user(actor, target):
        raise AdminTimeAdjustmentError("You cannot manage this employee.", http_status=403)
    if target.company_id is None:
        raise AdminTimeAdjustmentError("Employee has no company.", http_status=422)

    open_existing = get_open_shift_for_user(db_session, user_id)
    if open_existing is not None:
        raise AdminTimeAdjustmentError(
            "Employee already has an open shift. Force clock-out or close it first.",
            http_status=409,
        )

    location = get_location_by_id(db_session, location_id)
    if location is None:
        raise AdminTimeAdjustmentError("Location not found.", http_status=404)

    _validate_location_for_employee_company(
        db_session,
        location=location,
        employee_company_id=target.company_id,
    )
    _site_access_allows_location(db_session, user_id=user_id, location_id=location_id)
    _validate_span_and_break(clock_in_at=clock_in_at, clock_out_at=clock_out_at, break_seconds=brk)

    policy = ensure_company_time_policy(db_session, target.company_id)
    week_start = _monday_week_start_for_instant(policy.timezone_name, clock_in_at)
    _assert_payroll_allows_time_edit_for_weeks(
        db_session,
        company_id=target.company_id,
        user_id=user_id,
        week_starts={week_start},
    )

    lat, lon, acc, dist = _gps_snapshot_from_location(location)
    worked = _worked_seconds(clock_in_at, clock_out_at, brk)
    shift = TimeShift(
        user_id=user_id,
        company_id=target.company_id,
        location_id=location_id,
        status="completed",
        clock_source="admin_manual",
        manual_reason=reason_n,
        admin_actor_user_id=actor.id,
        clock_in_at=clock_in_at,
        clock_in_latitude=lat,
        clock_in_longitude=lon,
        clock_in_accuracy_meters=acc,
        clock_in_distance_to_site_meters=dist,
        clock_out_at=clock_out_at,
        clock_out_latitude=lat,
        clock_out_longitude=lon,
        clock_out_accuracy_meters=acc,
        clock_out_distance_to_site_meters=dist,
        worked_seconds=worked,
        break_seconds=brk,
    )
    save_shift(db_session, shift)
    _mark_payroll_weeks_needing_recalculation(
        db_session,
        company_id=target.company_id,
        week_starts={week_start},
    )

    profile = get_employee_profile_by_user_id(db_session, user_id)
    row = _shift_to_response_row(db_session, shift, location, target, profile)

    _audit(
        db_session,
        actor=actor,
        action="time_record.shift_created_by_admin",
        shift_id=shift.id,
        company_id=target.company_id,
        subject_user_id=user_id,
        details={
            "actor_user_id": str(actor.id),
            "subject_user_id": str(user_id),
            "shift_id": str(shift.id),
            "location_id": str(location_id),
            "clock_in_at": clock_in_at.isoformat(),
            "clock_out_at": clock_out_at.isoformat(),
            "break_seconds": brk,
            "reason": reason_n,
            "affected_payroll_week_start": str(week_start),
            "payroll_item_status": _payroll_item_status_detail(
                db_session,
                company_id=target.company_id,
                user_id=user_id,
                week_start=week_start,
            ),
        },
    )
    return row, True, week_start, target.company_id


def _payroll_item_status_detail(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    week_start: date,
) -> str | None:
    item = _payroll_item_for_user_week(db_session, company_id=company_id, user_id=user_id, week_start=week_start)
    return item.status if item is not None else None


def admin_patch_completed_shift(
    db_session: Session,
    actor: User,
    *,
    shift_id: uuid.UUID,
    clock_in_at: datetime | None,
    clock_out_at: datetime | None,
    location_id: uuid.UUID | None,
    break_seconds: int | None,
    break_minutes: int | None,
    reason: str,
) -> tuple[object, bool, date | None, uuid.UUID]:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise AdminTimeAdjustmentError("Forbidden.", http_status=403)

    reason_n = _normalize_reason(reason)
    brk_override = None
    if break_seconds is not None or break_minutes is not None:
        brk_override = _resolve_break_seconds(break_seconds, break_minutes)

    if (
        clock_in_at is None
        and clock_out_at is None
        and location_id is None
        and break_seconds is None
        and break_minutes is None
    ):
        raise AdminTimeAdjustmentError("No changes supplied.", http_status=422)

    shift = db_session.get(TimeShift, shift_id)
    if shift is None:
        raise AdminTimeAdjustmentError("Shift not found.", http_status=404)
    if shift.status != "completed":
        raise AdminTimeAdjustmentError("Only completed shifts can be edited here. Use force clock-out for open shifts.", http_status=422)

    owner = get_user_by_id(db_session, shift.user_id)
    if owner is None:
        raise AdminTimeAdjustmentError("Shift owner not found.", http_status=404)
    if not can_manage_user(actor, owner):
        raise AdminTimeAdjustmentError("You cannot manage this employee.", http_status=403)

    location = get_location_by_id(db_session, shift.location_id if location_id is None else location_id)
    if location is None:
        raise AdminTimeAdjustmentError("Location not found.", http_status=404)

    new_in = clock_in_at if clock_in_at is not None else shift.clock_in_at
    new_out = clock_out_at if clock_out_at is not None else shift.clock_out_at
    if new_out is None:
        raise AdminTimeAdjustmentError("Completed shift is missing clock_out_at.", http_status=422)
    if new_in.tzinfo is None:
        new_in = new_in.replace(tzinfo=timezone.utc)
    if new_out.tzinfo is None:
        new_out = new_out.replace(tzinfo=timezone.utc)

    new_loc_id = location_id if location_id is not None else shift.location_id
    if owner.company_id is None:
        raise AdminTimeAdjustmentError("Employee has no company.", http_status=422)

    _validate_location_for_employee_company(
        db_session,
        location=location,
        employee_company_id=owner.company_id,
    )
    _site_access_allows_location(db_session, user_id=owner.id, location_id=new_loc_id)

    brk = brk_override if brk_override is not None else int(shift.break_seconds or 0)
    _validate_span_and_break(clock_in_at=new_in, clock_out_at=new_out, break_seconds=brk)

    policy = ensure_company_time_policy(db_session, owner.company_id)
    old_week = _monday_week_start_for_instant(policy.timezone_name, shift.clock_in_at)
    new_week = _monday_week_start_for_instant(policy.timezone_name, new_in)
    _assert_payroll_allows_time_edit_for_weeks(
        db_session,
        company_id=owner.company_id,
        user_id=owner.id,
        week_starts={old_week, new_week},
    )

    prev_loc = str(shift.location_id)
    prev_in = shift.clock_in_at.isoformat()
    prev_out = shift.clock_out_at.isoformat() if shift.clock_out_at else None
    prev_brk = int(shift.break_seconds or 0)

    lat, lon, acc, dist = _gps_snapshot_from_location(location)
    shift.location_id = new_loc_id
    shift.clock_in_at = new_in
    shift.clock_out_at = new_out
    shift.break_seconds = brk
    shift.worked_seconds = _worked_seconds(new_in, new_out, brk)
    shift.clock_in_latitude = lat
    shift.clock_in_longitude = lon
    shift.clock_in_accuracy_meters = acc
    shift.clock_in_distance_to_site_meters = dist
    shift.clock_out_latitude = lat
    shift.clock_out_longitude = lon
    shift.clock_out_accuracy_meters = acc
    shift.clock_out_distance_to_site_meters = dist
    shift.clock_source = "admin_manual"
    shift.manual_reason = reason_n
    shift.admin_actor_user_id = actor.id
    shift.updated_at = _utc_now()
    update_shift(db_session, shift)
    _mark_payroll_weeks_needing_recalculation(
        db_session,
        company_id=owner.company_id,
        week_starts={old_week, new_week},
    )

    profile = get_employee_profile_by_user_id(db_session, owner.id)
    row = _shift_to_response_row(db_session, shift, location, owner, profile)

    primary_week = min(old_week, new_week)
    _audit(
        db_session,
        actor=actor,
        action="time_record.shift_adjusted_by_admin",
        shift_id=shift.id,
        company_id=owner.company_id,
        subject_user_id=owner.id,
        details={
            "actor_user_id": str(actor.id),
            "subject_user_id": str(owner.id),
            "shift_id": str(shift.id),
            "location_id_before": prev_loc,
            "location_id_after": str(shift.location_id),
            "clock_in_at_before": prev_in,
            "clock_in_at_after": shift.clock_in_at.isoformat(),
            "clock_out_at_before": prev_out,
            "clock_out_at_after": shift.clock_out_at.isoformat() if shift.clock_out_at else None,
            "break_seconds_before": prev_brk,
            "break_seconds_after": brk,
            "reason": reason_n,
            "affected_payroll_week_starts": sorted({str(old_week), str(new_week)}),
            "payroll_item_status_old_week": _payroll_item_status_detail(
                db_session, company_id=owner.company_id, user_id=owner.id, week_start=old_week
            ),
            "payroll_item_status_new_week": _payroll_item_status_detail(
                db_session, company_id=owner.company_id, user_id=owner.id, week_start=new_week
            ),
        },
    )
    return row, True, primary_week, owner.company_id


def admin_force_clock_out(
    db_session: Session,
    actor: User,
    *,
    shift_id: uuid.UUID,
    clock_out_at: datetime,
    break_seconds: int | None,
    break_minutes: int | None,
    reason: str,
) -> tuple[object, bool, date | None, uuid.UUID]:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise AdminTimeAdjustmentError("Forbidden.", http_status=403)

    reason_n = _normalize_reason(reason)

    if clock_out_at.tzinfo is None:
        clock_out_at = clock_out_at.replace(tzinfo=timezone.utc)

    shift = db_session.get(TimeShift, shift_id)
    if shift is None:
        raise AdminTimeAdjustmentError("Shift not found.", http_status=404)
    if shift.status != "open":
        raise AdminTimeAdjustmentError("Shift is not open.", http_status=422)

    owner = get_user_by_id(db_session, shift.user_id)
    if owner is None:
        raise AdminTimeAdjustmentError("Shift owner not found.", http_status=404)
    if not can_manage_user(actor, owner):
        raise AdminTimeAdjustmentError("You cannot manage this employee.", http_status=403)

    location = get_location_by_id(db_session, shift.location_id)
    if location is None:
        raise AdminTimeAdjustmentError("Location not found.", http_status=404)
    if owner.company_id is None:
        raise AdminTimeAdjustmentError("Employee has no company.", http_status=422)

    open_break = get_open_break_for_shift(db_session, shift.id)
    if open_break is not None:
        if clock_out_at <= open_break.started_at:
            raise AdminTimeAdjustmentError(
                "clock_out_at must be after the open break start time.",
                http_status=422,
            )
        open_break.ended_at = clock_out_at
        update_break(db_session, open_break)

    breaks = list_breaks_for_shift(db_session, shift.id)
    break_sum = 0
    for b in breaks:
        if b.ended_at is not None:
            break_sum += int((b.ended_at - b.started_at).total_seconds())
    break_sum = max(break_sum, 0)

    if break_seconds is not None or break_minutes is not None:
        brk = _resolve_break_seconds(break_seconds, break_minutes)
    else:
        brk = break_sum
    _validate_span_and_break(clock_in_at=shift.clock_in_at, clock_out_at=clock_out_at, break_seconds=brk)

    policy = ensure_company_time_policy(db_session, owner.company_id)
    week_start = _monday_week_start_for_instant(policy.timezone_name, shift.clock_in_at)
    _assert_payroll_allows_time_edit_for_weeks(
        db_session,
        company_id=owner.company_id,
        user_id=owner.id,
        week_starts={week_start},
    )

    lat, lon, acc, dist = _gps_snapshot_from_location(location)
    prev_out = shift.clock_out_at.isoformat() if shift.clock_out_at else None
    prev_brk = int(shift.break_seconds or 0)

    shift.clock_out_at = clock_out_at
    shift.clock_out_latitude = lat
    shift.clock_out_longitude = lon
    shift.clock_out_accuracy_meters = acc
    shift.clock_out_distance_to_site_meters = dist
    shift.status = "completed"
    shift.break_seconds = brk
    shift.worked_seconds = _worked_seconds(shift.clock_in_at, clock_out_at, brk)
    shift.clock_source = "admin_manual"
    shift.manual_reason = reason_n
    shift.admin_actor_user_id = actor.id
    shift.updated_at = _utc_now()
    update_shift(db_session, shift)
    _mark_payroll_weeks_needing_recalculation(
        db_session,
        company_id=owner.company_id,
        week_starts={week_start},
    )

    profile = get_employee_profile_by_user_id(db_session, owner.id)
    row = _shift_to_response_row(db_session, shift, location, owner, profile)

    _audit(
        db_session,
        actor=actor,
        action="time_record.shift_force_closed_by_admin",
        shift_id=shift.id,
        company_id=owner.company_id,
        subject_user_id=owner.id,
        details={
            "actor_user_id": str(actor.id),
            "subject_user_id": str(owner.id),
            "shift_id": str(shift.id),
            "location_id": str(shift.location_id),
            "clock_in_at": shift.clock_in_at.isoformat(),
            "clock_out_at_before": prev_out,
            "clock_out_at_after": shift.clock_out_at.isoformat(),
            "break_seconds_before": prev_brk,
            "break_seconds_after": brk,
            "reason": reason_n,
            "affected_payroll_week_start": str(week_start),
            "payroll_item_status": _payroll_item_status_detail(
                db_session, company_id=owner.company_id, user_id=owner.id, week_start=week_start
            ),
        },
    )
    return row, True, week_start, owner.company_id
