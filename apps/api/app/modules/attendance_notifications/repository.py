from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.modules.attendance_notifications.models import AttendanceNotificationSettings
from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import Company
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.leave.models import LeaveRequest
from app.modules.locations.models import Location
from app.modules.payroll_policies.models import LocationPayrollPolicy
from app.modules.site_access.models import EmployeeLocationAccess
from app.modules.time_clock.models import TimeShift


def get_settings_by_company_id(
    db: Session,
    company_id: uuid.UUID,
) -> AttendanceNotificationSettings | None:
    return db.scalar(
        select(AttendanceNotificationSettings).where(
            AttendanceNotificationSettings.company_id == company_id,
        ),
    )


def ensure_settings_row(db: Session, company_id: uuid.UUID) -> AttendanceNotificationSettings:
    row = get_settings_by_company_id(db, company_id)
    if row is not None:
        return row
    now = datetime.now(timezone.utc)
    row = AttendanceNotificationSettings(company_id=company_id, created_at=now, updated_at=now)
    db.add(row)
    db.flush()
    return row


def list_active_enabled_settings(db: Session) -> list[AttendanceNotificationSettings]:
    stmt = (
        select(AttendanceNotificationSettings)
        .join(Company, Company.id == AttendanceNotificationSettings.company_id)
        .where(Company.is_active.is_(True))
        .where(
            or_(
                AttendanceNotificationSettings.late_arrival_enabled.is_(True),
                AttendanceNotificationSettings.forgot_clock_in_enabled.is_(True),
                AttendanceNotificationSettings.forgot_clock_out_enabled.is_(True),
            ),
        )
    )
    return list(db.scalars(stmt).all())


def list_active_company_employees(
    db: Session,
    *,
    company_id: uuid.UUID,
) -> list[tuple[User, EmployeeProfile | None]]:
    stmt = (
        select(User, EmployeeProfile)
        .outerjoin(EmployeeProfile, EmployeeProfile.user_id == User.id)
        .where(User.company_id == company_id)
        .where(User.system_role == SystemRole.EMPLOYEE)
        .where(User.is_active.is_(True))
        .order_by(User.email.asc())
    )
    return [(user, profile if isinstance(profile, EmployeeProfile) else None) for user, profile in db.execute(stmt).all()]


def list_active_company_admins(db: Session, *, company_id: uuid.UUID) -> list[User]:
    stmt = (
        select(User)
        .where(User.company_id == company_id)
        .where(User.system_role == SystemRole.ADMIN)
        .where(User.is_active.is_(True))
        .order_by(User.email.asc())
    )
    return list(db.scalars(stmt).all())


def user_has_clock_in_between(
    db: Session,
    *,
    user_id: uuid.UUID,
    start_utc: datetime,
    end_utc: datetime,
) -> bool:
    stmt = (
        select(TimeShift.id)
        .where(TimeShift.user_id == user_id)
        .where(TimeShift.clock_in_at >= start_utc)
        .where(TimeShift.clock_in_at < end_utc)
        .limit(1)
    )
    return db.scalar(stmt) is not None


def list_open_shifts_for_company(
    db: Session,
    *,
    company_id: uuid.UUID,
) -> list[tuple[TimeShift, User, EmployeeProfile | None]]:
    stmt = (
        select(TimeShift, User, EmployeeProfile)
        .join(User, User.id == TimeShift.user_id)
        .outerjoin(EmployeeProfile, EmployeeProfile.user_id == User.id)
        .where(TimeShift.status == "open")
        .where(User.company_id == company_id)
        .where(User.system_role == SystemRole.EMPLOYEE)
        .where(User.is_active.is_(True))
        .order_by(TimeShift.clock_in_at.asc())
    )
    return [(shift, user, profile if isinstance(profile, EmployeeProfile) else None) for shift, user, profile in db.execute(stmt).all()]


def list_active_assigned_locations_with_policy(
    db: Session,
    *,
    user_id: uuid.UUID,
) -> list[tuple[Location, LocationPayrollPolicy | None]]:
    stmt = (
        select(Location, LocationPayrollPolicy)
        .join(
            EmployeeLocationAccess,
            and_(
                EmployeeLocationAccess.location_id == Location.id,
                EmployeeLocationAccess.user_id == user_id,
            ),
        )
        .outerjoin(LocationPayrollPolicy, LocationPayrollPolicy.location_id == Location.id)
        .where(Location.is_active.is_(True))
        .order_by(Location.created_at.desc())
    )
    return [(location, policy if isinstance(policy, LocationPayrollPolicy) else None) for location, policy in db.execute(stmt).all()]


def has_approved_leave_on_date(
    db: Session,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    work_date: date,
) -> bool:
    stmt = (
        select(LeaveRequest.id)
        .where(LeaveRequest.company_id == company_id)
        .where(LeaveRequest.user_id == user_id)
        .where(LeaveRequest.status == "approved")
        .where(LeaveRequest.date_from <= work_date)
        .where(LeaveRequest.date_to >= work_date)
        .limit(1)
    )
    return db.scalar(stmt) is not None
