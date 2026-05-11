import uuid
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.auth.service import can_manage_user
from app.modules.companies.models import CompanyTimePolicy
from app.modules.companies.repository import get_company_by_id
from app.modules.companies.service import ensure_company_time_policy
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.locations.models import Location
from app.modules.time_clock.models import TimeShift
from app.modules.time_records.calculation import compute_shift_metrics
from app.modules.time_records.permissions import can_view_time_record_shift_owner
from app.modules.time_records.repository import (
    list_time_shifts_for_records,
    list_time_shifts_for_week,
)
from app.modules.time_records.schemas import (
    TimeRecordShiftRow,
    TimesheetDayTotals,
    TimesheetOpenShiftSummary,
    TimesheetWeekResponse,
)

DEFAULT_PAGE_LIMIT = 50
MAX_PAGE_LIMIT = 100


class TimeRecordsPermissionError(ValueError):
    pass


def _clamp_limit(limit: int | None) -> int:
    if limit is None or limit <= 0:
        return DEFAULT_PAGE_LIMIT
    return min(limit, MAX_PAGE_LIMIT)


def _clamp_offset(offset: int | None) -> int:
    if offset is None or offset < 0:
        return 0
    return offset


def _fallback_policy() -> CompanyTimePolicy:
    now = datetime.now(timezone.utc)
    return CompanyTimePolicy(
        company_id=uuid.UUID(int=0),
        standard_start_time="08:00",
        overtime_after_hours=8.5,
        overtime_multiplier=1.5,
        rounding_increment_minutes=30,
        rounding_mode="nearest",
        break_deduction_minutes=30,
        break_deduction_after_minutes=360,
        rule_effective_from=now,
        rule_note="",
        timezone_name="Europe/London",
        created_at=now,
        updated_at=now,
    )


def _policy_company_id(shift: TimeShift, location: Location) -> uuid.UUID | None:
    return shift.company_id or location.company_id


def _load_policy(db_session: Session, shift: TimeShift, location: Location) -> CompanyTimePolicy:
    cid = _policy_company_id(shift, location)
    if cid is None:
        return _fallback_policy()
    return ensure_company_time_policy(db_session, cid)


def _employee_display_name(profile: EmployeeProfile | None) -> str | None:
    if profile is None:
        return None
    first = (profile.first_name or "").strip()
    last = (profile.last_name or "").strip()
    if not first and not last:
        return None
    return f"{first} {last}".strip()


def _employee_job_title(profile: EmployeeProfile | None) -> str | None:
    if profile is None or profile.job_title is None:
        return None
    title = profile.job_title.strip()
    return title or None


def _employee_primary_label(profile: EmployeeProfile | None, owner: User) -> str:
    display = _employee_display_name(profile)
    if display:
        return display
    if owner.email:
        return owner.email
    return "Employee"


def _company_name(db_session: Session, company_id: uuid.UUID | None) -> str | None:
    if company_id is None:
        return None
    company = get_company_by_id(db_session, company_id)
    return company.name if company is not None else None


def _shift_to_row(
    db_session: Session,
    shift: TimeShift,
    location: Location,
    owner: User,
    profile: EmployeeProfile | None,
    *,
    include_employee_fields: bool,
) -> TimeRecordShiftRow:
    policy = _load_policy(db_session, shift, location)
    early_access = bool(profile.early_access_enabled) if profile is not None else False

    metrics = compute_shift_metrics(
        clock_in_at_utc=shift.clock_in_at,
        clock_out_at_utc=shift.clock_out_at,
        break_seconds_tracked=int(shift.break_seconds or 0),
        early_access_enabled=early_access,
        policy=policy,
    )

    cid = _policy_company_id(shift, location)

    return TimeRecordShiftRow(
        shift_id=shift.id,
        user_id=owner.id,
        status=shift.status,
        location_id=location.id,
        location_name=location.name,
        company_id=cid,
        company_name=_company_name(db_session, cid),
        employee_email=owner.email if include_employee_fields else None,
        employee_name=_employee_primary_label(profile, owner) if include_employee_fields else None,
        employee_job_title=_employee_job_title(profile) if include_employee_fields else None,
        clock_in_at=shift.clock_in_at,
        clock_out_at=shift.clock_out_at,
        break_seconds=metrics.break_seconds,
        actual_seconds=metrics.actual_seconds,
        running_actual_seconds=metrics.running_actual_seconds,
        counted_clock_in_at=metrics.counted_clock_in_at,
        counted_clock_out_at=metrics.counted_clock_out_at,
        counted_seconds=metrics.counted_seconds,
        rounded_seconds=metrics.rounded_seconds,
    )


def _parse_bounds_from_dates(
    policy: CompanyTimePolicy,
    start: date | None,
    end_exclusive: date | None,
) -> tuple[datetime | None, datetime | None]:
    try:
        tz = ZoneInfo(policy.timezone_name)
    except Exception:
        tz = ZoneInfo("UTC")

    start_utc: datetime | None = None
    end_utc: datetime | None = None

    if start is not None:
        start_local = datetime.combine(start, time.min, tzinfo=tz)
        start_utc = start_local.astimezone(timezone.utc)

    if end_exclusive is not None:
        end_local = datetime.combine(end_exclusive, time.min, tzinfo=tz)
        end_utc = end_local.astimezone(timezone.utc)

    return start_utc, end_utc


def list_time_records_me(
    db_session: Session,
    actor: User,
    *,
    start_date: date | None,
    end_date_exclusive: date | None,
    location_id: uuid.UUID | None,
    status: str | None,
    limit: int | None,
    offset: int | None,
) -> list[TimeRecordShiftRow]:
    policy_hint = _fallback_policy()
    if actor.company_id is not None:
        policy_hint = ensure_company_time_policy(db_session, actor.company_id)

    try:
        policy_tz = ZoneInfo(policy_hint.timezone_name)
    except Exception:
        policy_tz = ZoneInfo("UTC")

    start_utc, end_utc = _parse_bounds_from_dates(policy_hint, start_date, end_date_exclusive)

    if start_utc is None and end_utc is None:
        today_local = datetime.now(timezone.utc).astimezone(policy_tz).date()
        start_day = today_local - timedelta(days=28)
        start_utc, _ = _parse_bounds_from_dates(policy_hint, start_day, None)
        _, end_utc = _parse_bounds_from_dates(
            policy_hint,
            None,
            today_local + timedelta(days=1),
        )

    rows = list_time_shifts_for_records(
        db_session,
        viewer=actor,
        start_utc=start_utc,
        end_utc=end_utc,
        location_id=location_id,
        status=status,
        filter_user_id=None,
        filter_company_id=None,
        limit=_clamp_limit(limit),
        offset=_clamp_offset(offset),
    )

    return [
        _shift_to_row(db_session, shift, location, owner, profile, include_employee_fields=False)
        for shift, location, owner, profile in rows
    ]


def list_time_records_admin(
    db_session: Session,
    actor: User,
    *,
    start_date: date | None,
    end_date_exclusive: date | None,
    location_id: uuid.UUID | None,
    status: str | None,
    user_id: uuid.UUID | None,
    company_id: uuid.UUID | None,
    limit: int | None,
    offset: int | None,
) -> list[TimeRecordShiftRow]:
    if actor.system_role == SystemRole.ADMIN and actor.company_id is None:
        return []

    policy_hint = _fallback_policy()
    if actor.system_role == SystemRole.ADMIN and actor.company_id is not None:
        policy_hint = ensure_company_time_policy(db_session, actor.company_id)
    elif actor.system_role == SystemRole.ADMINISTRATOR and company_id is not None:
        policy_hint = ensure_company_time_policy(db_session, company_id)

    start_utc, end_utc = _parse_bounds_from_dates(policy_hint, start_date, end_date_exclusive)

    if start_utc is None and end_utc is None:
        try:
            policy_tz = ZoneInfo(policy_hint.timezone_name)
        except Exception:
            policy_tz = ZoneInfo("UTC")
        today_local = datetime.now(timezone.utc).astimezone(policy_tz).date()
        start_day = today_local - timedelta(days=28)
        start_utc, _ = _parse_bounds_from_dates(policy_hint, start_day, None)
        _, end_utc = _parse_bounds_from_dates(
            policy_hint,
            None,
            today_local + timedelta(days=1),
        )

    if user_id is not None:
        target = get_user_by_id(db_session, user_id)
        if target is None:
            raise TimeRecordsPermissionError("User not found.")
        if not can_view_time_record_shift_owner(actor, target):
            raise TimeRecordsPermissionError("You cannot view this user's time records.")

    filter_company = company_id if actor.system_role == SystemRole.ADMINISTRATOR else None
    if actor.system_role == SystemRole.ADMIN:
        filter_company = None

    rows = list_time_shifts_for_records(
        db_session,
        viewer=actor,
        start_utc=start_utc,
        end_utc=end_utc,
        location_id=location_id,
        status=status,
        filter_user_id=user_id,
        filter_company_id=filter_company,
        limit=_clamp_limit(limit),
        offset=_clamp_offset(offset),
    )

    visible: list[TimeRecordShiftRow] = []
    for shift, location, owner, profile in rows:
        if not can_view_time_record_shift_owner(actor, owner):
            continue
        visible.append(
            _shift_to_row(db_session, shift, location, owner, profile, include_employee_fields=True),
        )

    return visible


def _week_bounds_utc(policy: CompanyTimePolicy, week_start: date) -> tuple[datetime, datetime]:
    try:
        tz = ZoneInfo(policy.timezone_name)
    except Exception:
        tz = ZoneInfo("UTC")

    start_local = datetime.combine(week_start, time.min, tzinfo=tz)
    end_local = start_local + timedelta(days=7)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def timesheet_week_for_user(
    db_session: Session,
    actor: User,
    *,
    subject_user_id: uuid.UUID,
    week_start: date,
) -> TimesheetWeekResponse:
    subject = get_user_by_id(db_session, subject_user_id)
    if subject is None:
        raise TimeRecordsPermissionError("User not found.")

    if not can_view_time_record_shift_owner(actor, subject):
        raise TimeRecordsPermissionError("You cannot view this user's timesheet.")

    policy = _fallback_policy()
    if subject.company_id is not None:
        policy = ensure_company_time_policy(db_session, subject.company_id)

    week_start_utc, week_end_utc = _week_bounds_utc(policy, week_start)

    rows = list_time_shifts_for_week(
        db_session,
        viewer=actor,
        subject_user_id=subject_user_id,
        week_start_utc=week_start_utc,
        week_end_utc=week_end_utc,
    )

    try:
        tz = ZoneInfo(policy.timezone_name)
    except Exception:
        tz = ZoneInfo("UTC")

    day_map: dict[date, TimesheetDayTotals] = {}
    for i in range(7):
        d = week_start + timedelta(days=i)
        day_map[d] = TimesheetDayTotals(date=d)

    open_shift_in_week = False
    week_actual = week_counted = week_rounded = week_break = 0
    shift_count = 0
    completed_shift_count = 0
    location_names: set[str] = set()
    open_summaries: list[TimesheetOpenShiftSummary] = []

    for shift, location, owner, profile in rows:
        if not can_view_time_record_shift_owner(actor, owner):
            continue

        shift_count += 1

        pol = _load_policy(db_session, shift, location)
        early_access = bool(profile.early_access_enabled) if profile is not None else False
        metrics = compute_shift_metrics(
            clock_in_at_utc=shift.clock_in_at,
            clock_out_at_utc=shift.clock_out_at,
            break_seconds_tracked=int(shift.break_seconds or 0),
            early_access_enabled=early_access,
            policy=pol,
        )

        if shift.status == "open":
            open_shift_in_week = True
            open_summaries.append(
                TimesheetOpenShiftSummary(
                    shift_id=shift.id,
                    clock_in_at=shift.clock_in_at,
                    location_id=location.id,
                    location_name=location.name,
                    running_actual_seconds=metrics.running_actual_seconds,
                    break_seconds=metrics.break_seconds,
                ),
            )
            continue

        if shift.status != "completed":
            continue

        completed_shift_count += 1
        location_names.add(location.name)

        local_day = shift.clock_in_at.astimezone(tz).date()
        bucket = day_map.get(local_day)
        if bucket is None:
            continue

        if metrics.actual_seconds is not None:
            bucket.actual_seconds += metrics.actual_seconds
            week_actual += metrics.actual_seconds

        if metrics.counted_seconds is not None:
            bucket.counted_seconds += metrics.counted_seconds
            week_counted += metrics.counted_seconds

        if metrics.rounded_seconds is not None:
            bucket.rounded_seconds += metrics.rounded_seconds
            week_rounded += metrics.rounded_seconds

        bucket.break_seconds += metrics.break_seconds
        week_break += metrics.break_seconds

    return TimesheetWeekResponse(
        week_start=week_start,
        company_timezone=policy.timezone_name,
        days=list(day_map.values()),
        week_actual_seconds=week_actual,
        week_counted_seconds=week_counted,
        week_rounded_seconds=week_rounded,
        week_break_seconds=week_break,
        open_shift_in_week=open_shift_in_week,
        shift_count=shift_count,
        completed_shift_count=completed_shift_count,
        open_shifts=open_summaries,
        locations_worked=sorted(location_names),
    )
