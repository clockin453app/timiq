import uuid
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.companies.repository import get_company_by_id
from app.modules.companies.service import ensure_company_time_policy
from app.modules.locations.repository import get_location_by_id
from app.modules.payroll_policies.service import effective_time_policy_for_shift
from app.modules.time_clock.models import TimeShift
from app.modules.time_clock.repository import (
    get_open_break_for_shift,
    get_open_shift_for_user,
    list_breaks_for_shift,
    save_shift,
    update_shift,
)

from .permissions import (
    LiveAttendancePermissionError,
    assert_administrator_company_scope,
    assert_target_is_manageable_employee,
)
from .repository import (
    employee_has_location_access,
    get_company_name,
    get_open_shift_for_user as repo_get_open_shift,
    list_completed_shifts_clocked_out_in_range,
    list_manageable_employees,
)


class LiveAttendanceError(ValueError):
    pass


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _local_day_bounds_utc(company_id: uuid.UUID, db_session: Session, day: datetime) -> tuple[datetime, datetime]:
    policy = ensure_company_time_policy(db_session, company_id)
    try:
        tz = ZoneInfo(policy.timezone_name)
    except Exception:
        tz = ZoneInfo("UTC")
    if day.tzinfo is None:
        day = day.replace(tzinfo=timezone.utc)
    local = day.astimezone(tz).date()
    start_local = datetime.combine(local, time.min, tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def _display_name(profile_row, user: User) -> str:
    if profile_row is not None:
        first = (profile_row.first_name or "").strip()
        last = (profile_row.last_name or "").strip()
        if first or last:
            return f"{first} {last}".strip()
    return user.email or "Employee"


def _parse_standard_time(value: str) -> time | None:
    parts = value.strip().split(":")
    if len(parts) != 2:
        return None
    try:
        h, m = int(parts[0]), int(parts[1])
        if 0 <= h <= 23 and 0 <= m <= 59:
            return time(h, m)
    except ValueError:
        return None
    return None


def _is_late_clock_in(local_clock_in: datetime, standard: time) -> bool:
    t = local_clock_in.time()
    return t > standard


def get_live_attendance_snapshot(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    location_id: uuid.UUID | None,
    search: str | None,
) -> dict:
    assert_administrator_company_scope(actor, company_id)
    if company_id is not None and actor.system_role == SystemRole.ADMINISTRATOR:
        if get_company_by_id(db_session, company_id) is None:
            raise LiveAttendanceError("Company not found.")

    rows = list_manageable_employees(
        db_session,
        actor=actor,
        company_id=company_id,
        location_id=location_id,
        search=search,
    )

    now = _utc_now()
    employees_out: list[dict] = []
    present_today = 0
    open_shifts = 0
    absent_count = 0
    late_arrivals_count = 0

    for user, profile in rows:
        if user.company_id is None:
            absent_count += 1
            employees_out.append(
                {
                    "user_id": user.id,
                    "display_name": _display_name(profile, user),
                    "email": user.email,
                    "job_title": profile.job_title.strip() if profile and profile.job_title else None,
                    "company_id": user.company_id,
                    "company_name": None,
                    "location_name": None,
                    "location_id": None,
                    "status": "absent",
                    "clock_in_at": None,
                    "clock_out_at": None,
                    "running_seconds": None,
                    "today_completed_worked_seconds": None,
                    "open_shift_id": None,
                    "clock_source": None,
                },
            )
            continue

        company_name = get_company_name(db_session, user.company_id)
        open_shift = repo_get_open_shift(db_session, user.id)

        day_start, day_end = _local_day_bounds_utc(user.company_id, db_session, now)
        completed_today = list_completed_shifts_clocked_out_in_range(
            db_session,
            user_id=user.id,
            range_start_utc=day_start,
            range_end_utc=day_end,
        )

        status = "absent"
        clock_in_at = None
        clock_out_at = None
        running_seconds = None
        today_worked = None
        open_shift_id = None
        clock_source = None
        loc_name = None
        loc_id = None

        if open_shift is not None:
            status = "open_shift"
            open_shifts += 1
            present_today += 1
            clock_in_at = open_shift.clock_in_at
            open_shift_id = open_shift.id
            clock_source = open_shift.clock_source
            running_seconds = max(0, int((now - open_shift.clock_in_at).total_seconds()))
            loc = get_location_by_id(db_session, open_shift.location_id)
            loc_name = loc.name if loc is not None else None
            loc_id = open_shift.location_id
            if clock_in_at is not None and loc is not None:
                merged = effective_time_policy_for_shift(db_session, open_shift, loc)
                std = _parse_standard_time(merged.standard_start_time or "")
                try:
                    tz = ZoneInfo(merged.timezone_name)
                except Exception:
                    tz = ZoneInfo("UTC")
                if std is not None:
                    local_in = clock_in_at.astimezone(tz)
                    if _is_late_clock_in(local_in, std):
                        late_arrivals_count += 1
        elif completed_today:
            status = "completed_today"
            present_today += 1
            c = completed_today[0]
            clock_in_at = c.clock_in_at
            clock_out_at = c.clock_out_at
            today_worked = c.worked_seconds
            clock_source = c.clock_source
            loc = get_location_by_id(db_session, c.location_id)
            loc_name = loc.name if loc is not None else None
            loc_id = c.location_id
            if clock_in_at is not None and loc is not None:
                merged = effective_time_policy_for_shift(db_session, c, loc)
                std = _parse_standard_time(merged.standard_start_time or "")
                try:
                    tz = ZoneInfo(merged.timezone_name)
                except Exception:
                    tz = ZoneInfo("UTC")
                if std is not None:
                    local_in = clock_in_at.astimezone(tz)
                    if _is_late_clock_in(local_in, std):
                        late_arrivals_count += 1
        else:
            absent_count += 1

        employees_out.append(
            {
                "user_id": user.id,
                "display_name": _display_name(profile, user),
                "email": user.email,
                "job_title": profile.job_title.strip() if profile and profile.job_title else None,
                "company_id": user.company_id,
                "company_name": company_name,
                "location_name": loc_name,
                "location_id": loc_id,
                "status": status,
                "clock_in_at": clock_in_at,
                "clock_out_at": clock_out_at,
                "running_seconds": running_seconds,
                "today_completed_worked_seconds": today_worked,
                "open_shift_id": open_shift_id,
                "clock_source": clock_source,
            },
        )

    total = len(employees_out)
    rate: float | None = None
    if total > 0:
        rate = round(present_today / total, 4)

    return {
        "generated_at": now,
        "summary": {
            "total_employees": total,
            "present_today": present_today,
            "open_shifts": open_shifts,
            "absent_count": absent_count,
            "attendance_rate": rate,
            "late_arrivals": late_arrivals_count,
        },
        "employees": employees_out,
    }


def manual_clock_in(
    db_session: Session,
    actor: User,
    *,
    user_id: uuid.UUID,
    location_id: uuid.UUID,
    reason: str,
) -> TimeShift:
    reason_clean = reason.strip()
    if not reason_clean:
        raise LiveAttendanceError("Reason is required.")

    target = get_user_by_id(db_session, user_id)
    if target is None:
        raise LiveAttendanceError("User not found.")

    try:
        assert_target_is_manageable_employee(actor, target)
    except LiveAttendancePermissionError:
        raise

    if target.company_id is None:
        raise LiveAttendanceError("Employee has no company scope.")

    location = get_location_by_id(db_session, location_id)
    if location is None or not location.is_active:
        raise LiveAttendanceError("Location not found or inactive.")

    if location.company_id != target.company_id:
        raise LiveAttendanceError("Location does not belong to the employee's company.")

    if not employee_has_location_access(
        db_session,
        user_id=target.id,
        location_id=location_id,
    ):
        raise LiveAttendanceError("Employee is not assigned to this location.")

    if repo_get_open_shift(db_session, target.id) is not None:
        raise LiveAttendanceError("Employee already has an open shift.")

    now = _utc_now()
    shift = TimeShift(
        user_id=target.id,
        company_id=target.company_id,
        location_id=location.id,
        status="open",
        clock_in_at=now,
        clock_in_latitude=float(location.latitude),
        clock_in_longitude=float(location.longitude),
        clock_in_accuracy_meters=0.0,
        clock_in_distance_to_site_meters=0.0,
        clock_source="manual_admin",
        manual_reason=reason_clean[:500],
        admin_actor_user_id=actor.id,
    )
    save_shift(db_session, shift, commit=True)
    db_session.refresh(shift)

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="live_attendance.manual_clock_in",
        entity_type="time_shift",
        entity_id=str(shift.id),
        company_id=target.company_id,
        details={
            "subject_user_id": str(target.id),
            "location_id": str(location.id),
            "reason": reason_clean[:2000],
            "shift_id": str(shift.id),
        },
    )
    return shift


def manual_clock_out(
    db_session: Session,
    actor: User,
    *,
    user_id: uuid.UUID | None,
    shift_id: uuid.UUID | None,
    reason: str,
) -> TimeShift:
    reason_clean = reason.strip()
    if not reason_clean:
        raise LiveAttendanceError("Reason is required.")

    if (user_id is None) == (shift_id is None):
        raise LiveAttendanceError("Provide exactly one of user_id or shift_id.")

    open_shift: TimeShift | None = None
    if shift_id is not None:
        open_shift = db_session.get(TimeShift, shift_id)
        if open_shift is None:
            raise LiveAttendanceError("Shift not found.")
        if open_shift.status != "open":
            raise LiveAttendanceError("Shift is not open.")
        target = get_user_by_id(db_session, open_shift.user_id)
        if target is None:
            raise LiveAttendanceError("Shift owner not found.")
    else:
        assert user_id is not None
        target = get_user_by_id(db_session, user_id)
        if target is None:
            raise LiveAttendanceError("User not found.")
        open_shift = repo_get_open_shift(db_session, user_id)
        if open_shift is None:
            raise LiveAttendanceError("No open shift for this user.")

    try:
        assert_target_is_manageable_employee(actor, target)
    except LiveAttendancePermissionError:
        raise

    if get_open_break_for_shift(db_session, open_shift.id) is not None:
        raise LiveAttendanceError("Cannot clock out while a break is open.")

    now = _utc_now()
    before_status = open_shift.status
    before_clock_out = open_shift.clock_out_at

    open_shift.clock_out_at = now
    open_shift.clock_out_latitude = float(open_shift.clock_in_latitude)
    open_shift.clock_out_longitude = float(open_shift.clock_in_longitude)
    open_shift.clock_out_accuracy_meters = 0.0
    open_shift.clock_out_distance_to_site_meters = float(open_shift.clock_in_distance_to_site_meters)
    open_shift.status = "completed"

    breaks = list_breaks_for_shift(db_session, open_shift.id)
    break_seconds = 0
    for item in breaks:
        if item.ended_at is not None:
            break_seconds += int((item.ended_at - item.started_at).total_seconds())

    worked_seconds = int((now - open_shift.clock_in_at).total_seconds()) - break_seconds
    open_shift.break_seconds = max(break_seconds, 0)
    open_shift.worked_seconds = max(worked_seconds, 0)

    update_shift(db_session, open_shift, commit=True)
    db_session.refresh(open_shift)

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="live_attendance.manual_clock_out",
        entity_type="time_shift",
        entity_id=str(open_shift.id),
        company_id=open_shift.company_id,
        details={
            "subject_user_id": str(target.id),
            "shift_id": str(open_shift.id),
            "reason": reason_clean[:2000],
            "before_status": before_status,
            "after_status": open_shift.status,
            "before_clock_out_at": before_clock_out.isoformat() if before_clock_out else None,
            "after_clock_out_at": open_shift.clock_out_at.isoformat() if open_shift.clock_out_at else None,
        },
    )
    return open_shift
