from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.modules.attendance_notifications.models import AttendanceNotificationSettings
from app.modules.attendance_notifications.repository import (
    ensure_settings_row,
    get_settings_by_company_id,
    has_approved_leave_on_date,
    list_active_assigned_locations_with_policy,
    list_active_company_admins,
    list_active_company_employees,
    list_active_enabled_settings,
    list_open_shifts_for_company,
    user_has_clock_in_between,
)
from app.modules.attendance_notifications.schemas import (
    AttendanceNotificationSettingsPatchRequest,
    AttendanceNotificationSettingsResponse,
)
from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.companies.repository import get_company_by_id
from app.modules.companies.service import ensure_company_time_policy
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.notifications.repository import create_notification_record_once

ATTENDANCE_LATE_KIND = "attendance_late_arrival"
ATTENDANCE_FORGOT_IN_KIND = "attendance_forgot_clock_in"
ATTENDANCE_FORGOT_OUT_KIND = "attendance_forgot_clock_out"


class AttendanceNotificationPermissionError(Exception):
    pass


class AttendanceNotificationNotFoundError(Exception):
    pass


@dataclass
class AttendanceNotificationRunResult:
    companies_checked: int = 0
    employees_checked: int = 0
    notifications_created: int = 0
    dry_run_candidates: int = 0


def _patch_changed_keys(model: BaseModel) -> list[str]:
    return sorted(model.model_dump(exclude_unset=True).keys())


def _resolve_company_id(actor: User, company_id_query: uuid.UUID | None) -> uuid.UUID:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        if company_id_query is None:
            raise AttendanceNotificationPermissionError("company_id query parameter is required for administrators.")
        return company_id_query
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            raise AttendanceNotificationPermissionError("Your account is not linked to a company.")
        if company_id_query is not None and company_id_query != actor.company_id:
            raise AttendanceNotificationPermissionError("You cannot access settings for another company.")
        return actor.company_id
    raise AttendanceNotificationPermissionError("You do not have permission to access attendance notification settings.")


def _settings_to_response(row: AttendanceNotificationSettings) -> AttendanceNotificationSettingsResponse:
    return AttendanceNotificationSettingsResponse.model_validate(row)


def get_attendance_notification_settings(
    db: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
) -> AttendanceNotificationSettingsResponse:
    cid = _resolve_company_id(actor, company_id)
    if get_company_by_id(db, cid) is None:
        raise AttendanceNotificationNotFoundError("Company not found.")
    row = ensure_settings_row(db, cid)
    db.flush()
    return _settings_to_response(row)


def patch_attendance_notification_settings(
    db: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    body: AttendanceNotificationSettingsPatchRequest,
) -> AttendanceNotificationSettingsResponse:
    cid = _resolve_company_id(actor, company_id)
    if get_company_by_id(db, cid) is None:
        raise AttendanceNotificationNotFoundError("Company not found.")
    row = ensure_settings_row(db, cid)
    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(row, key, value)
    row.updated_at = datetime.now(timezone.utc)
    db.flush()
    create_internal_audit_event(
        db,
        actor,
        action="settings.attendance_notifications_updated",
        entity_type="attendance_notification_settings",
        entity_id=str(cid),
        company_id=cid,
        details={
            "actor_user_id": str(actor.id),
            "company_id": str(cid),
            "changed_fields": _patch_changed_keys(body),
        },
    )
    db.refresh(row)
    return _settings_to_response(row)


def _parse_hhmm(value: str) -> time | None:
    try:
        hour, minute = value.split(":", 1)
        return time(int(hour), int(minute))
    except Exception:
        return None


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except Exception:
        return ZoneInfo("UTC")


def _display_name(profile: EmployeeProfile | None, user: User) -> str:
    if profile is not None:
        first = (profile.first_name or "").strip()
        last = (profile.last_name or "").strip()
        if first or last:
            return f"{first} {last}".strip()
    return user.email


def _local_day_bounds_utc(local_day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    start_local = datetime.combine(local_day, time.min, tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def _expected_start_time_for_user(db: Session, *, company_default: str, user_id: uuid.UUID) -> str | None:
    locations = list_active_assigned_locations_with_policy(db, user_id=user_id)
    if len(locations) == 1:
        _location, site_policy = locations[0]
        if site_policy is not None and site_policy.is_enabled:
            site_start = (site_policy.standard_start_time or "").strip()
            if site_start:
                return site_start[:5]
    clean = (company_default or "").strip()
    return clean[:5] if clean else None


def _recipient_ids(
    db: Session,
    *,
    company_id: uuid.UUID,
    employee: User,
    notify_employee: bool,
    notify_admins: bool,
) -> list[uuid.UUID]:
    ids: list[uuid.UUID] = []
    if notify_employee:
        ids.append(employee.id)
    if notify_admins:
        ids.extend(admin.id for admin in list_active_company_admins(db, company_id=company_id))
    return list(dict.fromkeys(ids))


def _create_or_count(
    db: Session,
    *,
    dry_run: bool,
    result: AttendanceNotificationRunResult,
    recipient_user_id: uuid.UUID,
    company_id: uuid.UUID,
    kind: str,
    dedupe_key: str,
    title: str,
    description: str,
    href: str,
    source_rule_type: str,
    subject_user_id: uuid.UUID,
    work_date: date | None = None,
    shift_id: uuid.UUID | None = None,
    created_at: datetime,
) -> None:
    if dry_run:
        result.dry_run_candidates += 1
        return
    created = create_notification_record_once(
        db,
        recipient_user_id=recipient_user_id,
        company_id=company_id,
        kind=kind,
        dedupe_key=dedupe_key,
        title=title,
        description=description,
        href=href,
        priority="high",
        category="time",
        source_rule_type=source_rule_type,
        subject_user_id=subject_user_id,
        shift_id=shift_id,
        work_date=work_date,
        created_at=created_at,
    )
    if created:
        result.notifications_created += 1


def _check_late_and_forgot_in(
    db: Session,
    *,
    settings: AttendanceNotificationSettings,
    now_utc: datetime,
    dry_run: bool,
    result: AttendanceNotificationRunResult,
) -> None:
    policy = ensure_company_time_policy(db, settings.company_id)
    tz = _zone(policy.timezone_name)
    local_now = now_utc.astimezone(tz)
    work_date = local_now.date()
    if local_now.weekday() not in set(settings.active_weekdays or []):
        return
    day_start_utc, day_end_utc = _local_day_bounds_utc(work_date, tz)
    employees = list_active_company_employees(db, company_id=settings.company_id)
    for employee, profile in employees:
        result.employees_checked += 1
        if settings.ignore_approved_leave and has_approved_leave_on_date(
            db,
            company_id=settings.company_id,
            user_id=employee.id,
            work_date=work_date,
        ):
            continue
        if user_has_clock_in_between(db, user_id=employee.id, start_utc=day_start_utc, end_utc=day_end_utc):
            continue
        expected_start_value = _expected_start_time_for_user(
            db,
            company_default=policy.standard_start_time,
            user_id=employee.id,
        )
        expected_start = _parse_hhmm(expected_start_value or "")
        if expected_start is None:
            continue
        expected_dt = datetime.combine(work_date, expected_start, tzinfo=tz)
        name = _display_name(profile, employee)
        expected_label = expected_start.strftime("%H:%M")

        if settings.late_arrival_enabled:
            late_at = expected_dt + timedelta(minutes=settings.late_arrival_grace_minutes)
            if local_now >= late_at:
                desc_admin = (
                    f"{name} has not clocked in. Expected start was {expected_label}. "
                    f"Grace period: {settings.late_arrival_grace_minutes} minutes."
                )
                desc_employee = "You may be late for your expected start and have not clocked in."
                for rid in _recipient_ids(
                    db,
                    company_id=settings.company_id,
                    employee=employee,
                    notify_employee=settings.late_arrival_notify_employee,
                    notify_admins=settings.late_arrival_notify_admins,
                ):
                    is_employee = rid == employee.id
                    _create_or_count(
                        db,
                        dry_run=dry_run,
                        result=result,
                        recipient_user_id=rid,
                        company_id=settings.company_id,
                        kind=ATTENDANCE_LATE_KIND,
                        dedupe_key=f"attendance:late_arrival:{settings.company_id}:{employee.id}:{work_date.isoformat()}",
                        title="Late arrival",
                        description=desc_employee if is_employee else desc_admin,
                        href="/clock" if is_employee else "/live-attendance",
                        source_rule_type="late_arrival",
                        subject_user_id=employee.id,
                        work_date=work_date,
                        created_at=now_utc,
                    )

        check_time = _parse_hhmm(settings.forgot_clock_in_check_time)
        if settings.forgot_clock_in_enabled and check_time is not None:
            check_dt = datetime.combine(work_date, check_time, tzinfo=tz)
            if local_now >= check_dt:
                desc_admin = f"{name} has no clock-in recorded for today."
                desc_employee = "You may have forgotten to clock in."
                for rid in _recipient_ids(
                    db,
                    company_id=settings.company_id,
                    employee=employee,
                    notify_employee=settings.forgot_clock_in_notify_employee,
                    notify_admins=settings.forgot_clock_in_notify_admins,
                ):
                    is_employee = rid == employee.id
                    _create_or_count(
                        db,
                        dry_run=dry_run,
                        result=result,
                        recipient_user_id=rid,
                        company_id=settings.company_id,
                        kind=ATTENDANCE_FORGOT_IN_KIND,
                        dedupe_key=f"attendance:forgot_clock_in:{settings.company_id}:{employee.id}:{work_date.isoformat()}",
                        title="Forgot clock-in",
                        description=desc_employee if is_employee else desc_admin,
                        href="/clock" if is_employee else "/live-attendance",
                        source_rule_type="forgot_clock_in",
                        subject_user_id=employee.id,
                        work_date=work_date,
                        created_at=now_utc,
                    )


def _forgot_clock_out_dedupe_key(
    *,
    settings: AttendanceNotificationSettings,
    employee_id: uuid.UUID,
    shift_id: uuid.UUID,
    elapsed: timedelta,
) -> str:
    base = f"attendance:forgot_clock_out:{settings.company_id}:{employee_id}:{shift_id}"
    repeat_hours = settings.forgot_clock_out_repeat_hours
    if repeat_hours is None:
        return base
    if repeat_hours <= 0:
        return base
    threshold = timedelta(hours=settings.forgot_clock_out_threshold_hours)
    repeat = timedelta(hours=repeat_hours)
    bucket = int(max(0, (elapsed - threshold).total_seconds()) // repeat.total_seconds())
    return f"{base}:repeat:{bucket}"


def _check_forgot_clock_out(
    db: Session,
    *,
    settings: AttendanceNotificationSettings,
    now_utc: datetime,
    dry_run: bool,
    result: AttendanceNotificationRunResult,
) -> None:
    if not settings.forgot_clock_out_enabled:
        return
    threshold = timedelta(hours=settings.forgot_clock_out_threshold_hours)
    for shift, employee, profile in list_open_shifts_for_company(db, company_id=settings.company_id):
        elapsed = now_utc - shift.clock_in_at
        if elapsed < threshold:
            continue
        local_day = shift.clock_in_at.date()
        name = _display_name(profile, employee)
        clock_in_label = shift.clock_in_at.astimezone(timezone.utc).strftime("%H:%M UTC")
        desc_admin = f"{name} has an open shift since {clock_in_label}. Please check if they forgot to clock out."
        desc_employee = "You may have forgotten to clock out."
        dedupe_key = _forgot_clock_out_dedupe_key(
            settings=settings,
            employee_id=employee.id,
            shift_id=shift.id,
            elapsed=elapsed,
        )
        for rid in _recipient_ids(
            db,
            company_id=settings.company_id,
            employee=employee,
            notify_employee=settings.forgot_clock_out_notify_employee,
            notify_admins=settings.forgot_clock_out_notify_admins,
        ):
            is_employee = rid == employee.id
            _create_or_count(
                db,
                dry_run=dry_run,
                result=result,
                recipient_user_id=rid,
                company_id=settings.company_id,
                kind=ATTENDANCE_FORGOT_OUT_KIND,
                dedupe_key=dedupe_key,
                title="Forgot clock-out",
                description=desc_employee if is_employee else desc_admin,
                href="/clock" if is_employee else "/time-records",
                source_rule_type="forgot_clock_out",
                subject_user_id=employee.id,
                work_date=local_day,
                shift_id=shift.id,
                created_at=now_utc,
            )


def run_attendance_notification_check_once(
    db: Session,
    *,
    now_utc: datetime | None = None,
    company_id: uuid.UUID | None = None,
    dry_run: bool = False,
) -> AttendanceNotificationRunResult:
    now = now_utc or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    settings_rows = list_active_enabled_settings(db)
    if company_id is not None:
        settings_rows = [row for row in settings_rows if row.company_id == company_id]
    result = AttendanceNotificationRunResult()
    for settings in settings_rows:
        result.companies_checked += 1
        _check_late_and_forgot_in(db, settings=settings, now_utc=now, dry_run=dry_run, result=result)
        _check_forgot_clock_out(db, settings=settings, now_utc=now, dry_run=dry_run, result=result)
    if not dry_run:
        db.flush()
    return result
