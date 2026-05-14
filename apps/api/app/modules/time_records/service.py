import csv
import io
import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.core.export_csv import format_dt_local, safe_export_filename, seconds_to_hours_csv
from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.auth.service import can_manage_user
from app.modules.companies.models import CompanyTimePolicy
from app.modules.companies.repository import get_company_by_id
from app.modules.companies.service import ensure_company_time_policy
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.payroll_policies.service import (
    effective_early_access_for_shift,
    effective_time_policy_for_shift,
    time_policy_source_for_shift,
)
from app.modules.leave import repository as leave_repo
from app.modules.leave.schemas import WeekLeaveRow
from app.modules.locations.models import Location
from app.modules.time_clock.models import TimeShift
from app.modules.time_records.calculation import compute_shift_metrics
from app.modules.time_records.permissions import can_view_time_record_shift_owner
from app.modules.time_records.repository import (
    list_company_employee_users_with_profiles,
    list_time_shifts_for_company_week,
    list_time_shifts_for_records,
    list_time_shifts_for_week,
)
from app.modules.time_records.schemas import (
    AdminTimesheetEmployeeDayRow,
    AdminTimesheetOpenShiftRow,
    AdminTimesheetWeekAllEmployeesResponse,
    AdminWeekReportAllEmployeesResponse,
    AdminWeekReportCompanyTotals,
    AdminWeekReportEmployeeSummary,
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
    return effective_time_policy_for_shift(db_session, shift, location)


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
    profile_early = bool(profile.early_access_enabled) if profile is not None else False
    early_access = effective_early_access_for_shift(
        db_session, location, profile_early_access=profile_early
    )

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
        time_policy_source=time_policy_source_for_shift(db_session, location),
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
        profile_early = bool(profile.early_access_enabled) if profile is not None else False
        early_access = effective_early_access_for_shift(
            db_session, location, profile_early_access=profile_early
        )
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

    week_leave: list[WeekLeaveRow] = []
    if subject.company_id is not None:
        w_end = week_start + timedelta(days=6)
        for r in leave_repo.list_leave_overlapping_week(
            db_session,
            company_id=subject.company_id,
            week_start=week_start,
            week_end=w_end,
            statuses=("approved", "pending"),
            user_id=subject_user_id,
        ):
            week_leave.append(
                WeekLeaveRow(
                    request_id=r.id,
                    user_id=r.user_id,
                    leave_type=r.leave_type,
                    status=r.status,
                    date_from=r.date_from,
                    date_to=r.date_to,
                    total_days=Decimal(str(r.total_days)),
                    start_half_day=r.start_half_day,
                    end_half_day=r.end_half_day,
                )
            )

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
        week_leave=week_leave,
    )


def _resolve_timesheet_company_scope(
    db_session: Session,
    actor: User,
    company_id: uuid.UUID | None,
) -> uuid.UUID:
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            raise TimeRecordsPermissionError("Admin user is not assigned to a company.")
        if company_id is not None and company_id != actor.company_id:
            raise TimeRecordsPermissionError("You cannot view another company.")
        return actor.company_id
    if actor.system_role == SystemRole.ADMINISTRATOR:
        if company_id is None:
            raise ValueError("company_id is required.")
        if get_company_by_id(db_session, company_id) is None:
            raise ValueError("Company not found.")
        return company_id
    raise TimeRecordsPermissionError("You cannot view this resource.")


class _TimesheetDayAgg:
    __slots__ = ("clocked", "payable", "payroll", "break_sec", "locs", "completed_count", "owner", "profile")

    def __init__(self) -> None:
        self.clocked = 0
        self.payable = 0
        self.payroll = 0
        self.break_sec = 0
        self.locs: set[str] = set()
        self.completed_count = 0
        self.owner: User | None = None
        self.profile: EmployeeProfile | None = None


def timesheet_week_all_employees_for_company(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    week_start: date,
) -> AdminTimesheetWeekAllEmployeesResponse:
    resolved = _resolve_timesheet_company_scope(db_session, actor, company_id)
    policy = ensure_company_time_policy(db_session, resolved)
    week_start_utc, week_end_utc = _week_bounds_utc(policy, week_start)

    rows = list_time_shifts_for_company_week(
        db_session,
        company_id=resolved,
        week_start_utc=week_start_utc,
        week_end_utc=week_end_utc,
    )

    try:
        tz = ZoneInfo(policy.timezone_name)
    except Exception:
        tz = ZoneInfo("UTC")

    day_acc: dict[tuple[uuid.UUID, date], _TimesheetDayAgg] = {}

    def _ensure_acc(uid: uuid.UUID, d: date) -> _TimesheetDayAgg:
        key = (uid, d)
        if key not in day_acc:
            day_acc[key] = _TimesheetDayAgg()
        return day_acc[key]

    open_rows: list[AdminTimesheetOpenShiftRow] = []
    week_clocked = week_payable = week_payroll = week_break = 0
    completed_total = 0

    for shift, location, owner, profile in rows:
        if not can_view_time_record_shift_owner(actor, owner):
            continue

        pol = _load_policy(db_session, shift, location)
        profile_early = bool(profile.early_access_enabled) if profile is not None else False
        early_access = effective_early_access_for_shift(
            db_session, location, profile_early_access=profile_early
        )
        metrics = compute_shift_metrics(
            clock_in_at_utc=shift.clock_in_at,
            clock_out_at_utc=shift.clock_out_at,
            break_seconds_tracked=int(shift.break_seconds or 0),
            early_access_enabled=early_access,
            policy=pol,
        )

        if shift.status == "open":
            open_rows.append(
                AdminTimesheetOpenShiftRow(
                    user_id=owner.id,
                    employee_name=_employee_display_name(profile),
                    employee_email=owner.email or "",
                    employee_job_title=_employee_job_title(profile),
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

        completed_total += 1
        local_day = shift.clock_in_at.astimezone(tz).date()
        acc = _ensure_acc(owner.id, local_day)
        acc.owner = owner
        acc.profile = profile

        if metrics.actual_seconds is not None:
            acc.clocked += metrics.actual_seconds
            week_clocked += metrics.actual_seconds
        if metrics.counted_seconds is not None:
            acc.payable += metrics.counted_seconds
            week_payable += metrics.counted_seconds
        if metrics.rounded_seconds is not None:
            acc.payroll += metrics.rounded_seconds
            week_payroll += metrics.rounded_seconds
        acc.break_sec += metrics.break_seconds
        week_break += metrics.break_seconds
        acc.locs.add(location.name)
        acc.completed_count += 1

    day_rows_out: list[AdminTimesheetEmployeeDayRow] = []
    for (uid, d), acc in sorted(
        day_acc.items(),
        key=lambda kv: (
            _employee_primary_label(kv[1].profile, kv[1].owner).lower()
            if kv[1].owner is not None
            else "",
            (kv[1].owner.email or "").lower() if kv[1].owner is not None else "",
            kv[0][1],
        ),
    ):
        if acc.owner is None:
            continue
        if acc.clocked == 0 and acc.payable == 0 and acc.payroll == 0 and acc.break_sec == 0:
            continue
        day_rows_out.append(
            AdminTimesheetEmployeeDayRow(
                user_id=uid,
                employee_name=_employee_display_name(acc.profile),
                employee_email=acc.owner.email or "",
                employee_job_title=_employee_job_title(acc.profile),
                date=d,
                clocked_seconds=acc.clocked,
                payable_seconds=acc.payable,
                payroll_seconds=acc.payroll,
                break_seconds=acc.break_sec,
                locations=sorted(acc.locs),
                completed_shifts_count=acc.completed_count,
            ),
        )

    open_rows.sort(
        key=lambda r: (
            (r.employee_name or r.employee_email).lower(),
            r.clock_in_at,
        ),
    )

    return AdminTimesheetWeekAllEmployeesResponse(
        week_start=week_start,
        company_id=resolved,
        company_timezone=policy.timezone_name,
        day_rows=day_rows_out,
        open_shifts=open_rows,
        week_clocked_seconds=week_clocked,
        week_payable_seconds=week_payable,
        week_payroll_seconds=week_payroll,
        week_break_seconds=week_break,
        completed_shift_count=completed_total,
    )


def week_report_all_employees_for_company(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    week_start: date,
) -> AdminWeekReportAllEmployeesResponse:
    resolved = _resolve_timesheet_company_scope(db_session, actor, company_id)
    policy = ensure_company_time_policy(db_session, resolved)
    week_start_utc, week_end_utc = _week_bounds_utc(policy, week_start)

    rows = list_time_shifts_for_company_week(
        db_session,
        company_id=resolved,
        week_start_utc=week_start_utc,
        week_end_utc=week_end_utc,
    )

    shifts_by_user: dict[uuid.UUID, list[tuple[TimeShift, Location, User, EmployeeProfile | None]]] = (
        defaultdict(list)
    )
    for shift, location, owner, profile in rows:
        if not can_view_time_record_shift_owner(actor, owner):
            continue
        shifts_by_user[owner.id].append((shift, location, owner, profile))

    roster = list_company_employee_users_with_profiles(db_session, company_id=resolved)

    w_end = week_start + timedelta(days=6)
    leave_all = leave_repo.list_leave_overlapping_week(
        db_session,
        company_id=resolved,
        week_start=week_start,
        week_end=w_end,
        statuses=("approved", "pending"),
        user_id=None,
    )
    leave_by_user: dict[uuid.UUID, list[WeekLeaveRow]] = defaultdict(list)
    for r in leave_all:
        leave_by_user[r.user_id].append(
            WeekLeaveRow(
                request_id=r.id,
                user_id=r.user_id,
                leave_type=r.leave_type,
                status=r.status,
                date_from=r.date_from,
                date_to=r.date_to,
                total_days=Decimal(str(r.total_days)),
                start_half_day=r.start_half_day,
                end_half_day=r.end_half_day,
            )
        )

    employees_out: list[AdminWeekReportEmployeeSummary] = []
    totals = AdminWeekReportCompanyTotals()

    for owner, profile in roster:
        if not can_view_time_record_shift_owner(actor, owner):
            continue

        user_shifts = shifts_by_user.get(owner.id, [])
        clocked = payable = payroll = break_sum = 0
        completed = 0
        loc_names: set[str] = set()
        open_any = False

        for shift, location, _o, prof in user_shifts:
            pol = _load_policy(db_session, shift, location)
            profile_early = bool(prof.early_access_enabled) if prof is not None else False
            early_access = effective_early_access_for_shift(
                db_session, location, profile_early_access=profile_early
            )
            metrics = compute_shift_metrics(
                clock_in_at_utc=shift.clock_in_at,
                clock_out_at_utc=shift.clock_out_at,
                break_seconds_tracked=int(shift.break_seconds or 0),
                early_access_enabled=early_access,
                policy=pol,
            )

            if shift.status == "open":
                open_any = True
                continue

            if shift.status != "completed":
                continue

            completed += 1
            if metrics.actual_seconds is not None:
                clocked += metrics.actual_seconds
            if metrics.counted_seconds is not None:
                payable += metrics.counted_seconds
            if metrics.rounded_seconds is not None:
                payroll += metrics.rounded_seconds
            break_sum += metrics.break_seconds
            loc_names.add(location.name)

        employees_out.append(
            AdminWeekReportEmployeeSummary(
                user_id=owner.id,
                employee_name=_employee_display_name(profile),
                employee_email=owner.email or "",
                employee_job_title=_employee_job_title(profile),
                completed_shifts_count=completed,
                clocked_seconds=clocked,
                payable_seconds=payable,
                payroll_seconds=payroll,
                break_seconds=break_sum,
                locations_worked=sorted(loc_names),
                open_shift_in_week=open_any,
                week_leave=leave_by_user.get(owner.id, []),
            ),
        )

    totals.completed_shifts_count = sum(e.completed_shifts_count for e in employees_out)
    totals.clocked_seconds = sum(e.clocked_seconds for e in employees_out)
    totals.payable_seconds = sum(e.payable_seconds for e in employees_out)
    totals.payroll_seconds = sum(e.payroll_seconds for e in employees_out)
    totals.break_seconds = sum(e.break_seconds for e in employees_out)
    totals.employees_with_open_shift = sum(1 for e in employees_out if e.open_shift_in_week)

    employees_out.sort(
        key=lambda e: ((e.employee_name or e.employee_email).lower(), e.employee_email.lower()),
    )

    return AdminWeekReportAllEmployeesResponse(
        week_start=week_start,
        company_id=resolved,
        company_timezone=policy.timezone_name,
        employees=employees_out,
        totals=totals,
    )


def export_timesheet_week_shifts_csv(
    db_session: Session,
    actor: User,
    *,
    subject_user_id: uuid.UUID,
    week_start: date,
    export_scope: str,
) -> tuple[str, str]:
    """Per-shift rows for one employee week. ``export_scope`` is ``me_week`` or ``admin_employee_week`` (audit only)."""
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

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "week_start",
            "company_timezone",
            "employee_name",
            "employee_email",
            "employee_job_title",
            "work_date",
            "location_name",
            "shift_status",
            "clock_in_local",
            "clock_out_local",
            "break_hours",
            "clocked_hours",
            "payable_hours",
            "payroll_rounded_hours",
            "open_shift",
        ],
    )
    row_count = 0
    for shift, location, owner, profile in rows:
        if not can_view_time_record_shift_owner(actor, owner):
            continue
        pol = _load_policy(db_session, shift, location)
        profile_early = bool(profile.early_access_enabled) if profile is not None else False
        early_access = effective_early_access_for_shift(
            db_session, location, profile_early_access=profile_early
        )
        metrics = compute_shift_metrics(
            clock_in_at_utc=shift.clock_in_at,
            clock_out_at_utc=shift.clock_out_at,
            break_seconds_tracked=int(shift.break_seconds or 0),
            early_access_enabled=early_access,
            policy=pol,
        )
        is_open = shift.status == "open"
        work_date = shift.clock_in_at.astimezone(tz).date()
        clocked_sec = metrics.actual_seconds if not is_open else metrics.running_actual_seconds
        writer.writerow(
            [
                str(week_start),
                policy.timezone_name,
                _employee_primary_label(profile, owner),
                owner.email or "",
                _employee_job_title(profile) or "",
                str(work_date),
                location.name,
                shift.status,
                format_dt_local(shift.clock_in_at, tz),
                format_dt_local(shift.clock_out_at, tz) if shift.clock_out_at else "",
                seconds_to_hours_csv(metrics.break_seconds),
                seconds_to_hours_csv(clocked_sec),
                seconds_to_hours_csv(metrics.counted_seconds),
                seconds_to_hours_csv(metrics.rounded_seconds),
                "yes" if is_open else "no",
            ],
        )
        row_count += 1

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="timesheet.exported",
        entity_type="timesheet_week",
        entity_id=None,
        company_id=subject.company_id,
        details={
            "export_type": "week_shifts_csv",
            "scope": export_scope,
            "week_start": str(week_start),
            "subject_user_id": str(subject_user_id),
            "row_count": row_count,
        },
    )
    fname = safe_export_filename("timesheet-week", str(week_start), export_scope) + ".csv"
    return buf.getvalue(), fname


def export_admin_company_timesheet_week_csv(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    week_start: date,
) -> tuple[str, str]:
    data = timesheet_week_all_employees_for_company(db_session, actor, company_id=company_id, week_start=week_start)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "week_start",
            "company_id",
            "company_timezone",
            "user_id",
            "employee_name",
            "employee_email",
            "employee_job_title",
            "date",
            "locations",
            "clocked_hours",
            "payable_hours",
            "payroll_rounded_hours",
            "break_hours",
            "completed_shifts_count",
        ],
    )
    for r in data.day_rows:
        writer.writerow(
            [
                str(data.week_start),
                str(data.company_id),
                data.company_timezone,
                str(r.user_id),
                r.employee_name or "",
                r.employee_email,
                r.employee_job_title or "",
                str(r.date),
                "; ".join(r.locations),
                seconds_to_hours_csv(r.clocked_seconds),
                seconds_to_hours_csv(r.payable_seconds),
                seconds_to_hours_csv(r.payroll_seconds),
                seconds_to_hours_csv(r.break_seconds),
                r.completed_shifts_count,
            ],
        )
    writer.writerow([])
    writer.writerow(
        [
            "section",
            "user_id",
            "employee_name",
            "employee_email",
            "employee_job_title",
            "shift_id",
            "clock_in_local",
            "location_name",
            "break_hours",
            "running_clocked_hours",
            "open_shift",
        ],
    )
    try:
        tz = ZoneInfo(data.company_timezone)
    except Exception:
        tz = ZoneInfo("UTC")
    for o in data.open_shifts:
        writer.writerow(
            [
                "open_shift",
                str(o.user_id),
                o.employee_name or "",
                o.employee_email,
                o.employee_job_title or "",
                str(o.shift_id),
                format_dt_local(o.clock_in_at, tz),
                o.location_name,
                seconds_to_hours_csv(o.break_seconds),
                seconds_to_hours_csv(o.running_actual_seconds),
                "yes",
            ],
        )

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="timesheet.exported",
        entity_type="timesheet_week",
        entity_id=None,
        company_id=data.company_id,
        details={
            "export_type": "company_timesheet_week_csv",
            "week_start": str(week_start),
            "row_count": len(data.day_rows) + len(data.open_shifts),
        },
    )
    fname = safe_export_filename("timesheet-company", str(data.company_id), str(week_start)) + ".csv"
    return buf.getvalue(), fname


def export_admin_company_week_report_csv(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    week_start: date,
) -> tuple[str, str]:
    data = week_report_all_employees_for_company(db_session, actor, company_id=company_id, week_start=week_start)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "week_start",
            "company_id",
            "company_timezone",
            "user_id",
            "employee_name",
            "employee_email",
            "employee_job_title",
            "completed_shifts_count",
            "total_clocked_hours",
            "total_payable_hours",
            "total_payroll_rounded_hours",
            "total_break_hours",
            "locations_worked",
            "open_shift_in_week",
        ],
    )
    for e in data.employees:
        writer.writerow(
            [
                str(data.week_start),
                str(data.company_id),
                data.company_timezone,
                str(e.user_id),
                e.employee_name or "",
                e.employee_email,
                e.employee_job_title or "",
                e.completed_shifts_count,
                seconds_to_hours_csv(e.clocked_seconds),
                seconds_to_hours_csv(e.payable_seconds),
                seconds_to_hours_csv(e.payroll_seconds),
                seconds_to_hours_csv(e.break_seconds),
                "; ".join(e.locations_worked),
                "yes" if e.open_shift_in_week else "no",
            ],
        )

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="timesheet.exported",
        entity_type="week_report",
        entity_id=None,
        company_id=data.company_id,
        details={
            "export_type": "company_week_report_csv",
            "week_start": str(week_start),
            "row_count": len(data.employees),
        },
    )
    fname = safe_export_filename("week-report", str(data.company_id), str(week_start)) + ".csv"
    return buf.getvalue(), fname
