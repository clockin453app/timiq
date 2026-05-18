from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.auth.service import can_manage_user
from app.modules.companies.repository import get_company_by_id
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id
from app.modules.paye_payroll.models import CompanyPayeSettings, EmployeePayeSettings
from app.modules.paye_payroll.schemas import (
    CompanyPayeSettingsPatchRequest,
    CompanyPayeSettingsResponse,
    EmployeePayeSettingsPatchRequest,
    EmployeePayeSettingsResponse,
    MonthlyPayeReportShellResponse,
    MonthlyPayeReportShellRow,
)


class PayePayrollPermissionError(ValueError):
    pass


class PayePayrollNotFoundError(ValueError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _trim_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _resolve_company_id(actor: User, company_id: uuid.UUID | None) -> uuid.UUID:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        if company_id is None:
            raise PayePayrollPermissionError("Select a company.")
        return company_id
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            raise PayePayrollPermissionError("Your account is not linked to a company.")
        if company_id is not None and company_id != actor.company_id:
            raise PayePayrollPermissionError("You cannot manage PAYE payroll for another company.")
        return actor.company_id
    raise PayePayrollPermissionError("PAYE payroll management requires Admin or Administrator.")


def _assert_company_exists(db_session: Session, company_id: uuid.UUID) -> None:
    if get_company_by_id(db_session, company_id) is None:
        raise PayePayrollNotFoundError("Company not found.")


def _target_employee_for_actor(db_session: Session, actor: User, user_id: uuid.UUID) -> User:
    target = get_user_by_id(db_session, user_id)
    if target is None or target.system_role != SystemRole.EMPLOYEE:
        raise PayePayrollNotFoundError("Employee not found.")
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return target
    if actor.system_role == SystemRole.ADMIN and can_manage_user(actor, target):
        return target
    raise PayePayrollPermissionError("You cannot manage PAYE settings for this employee.")


def _get_employee_settings(db_session: Session, user_id: uuid.UUID) -> EmployeePayeSettings | None:
    return db_session.get(EmployeePayeSettings, user_id)


def _get_or_create_employee_settings(db_session: Session, target: User) -> EmployeePayeSettings:
    if target.company_id is None:
        raise PayePayrollPermissionError("Employee must be linked to a company for PAYE settings.")
    row = _get_employee_settings(db_session, target.id)
    if row is not None:
        if row.company_id != target.company_id:
            row.company_id = target.company_id
        return row
    now = _now()
    row = EmployeePayeSettings(
        user_id=target.id,
        company_id=target.company_id,
        pay_frequency="monthly",
        salary_type="hourly",
        tax_basis="cumulative",
        student_loan_plan="none",
        postgraduate_loan=False,
        pension_enrolment_status="not_eligible",
        pension_scheme_basis="qualifying_earnings",
        pension_relief_method="relief_at_source",
        created_at=now,
        updated_at=now,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def read_employee_paye_settings(
    db_session: Session,
    actor: User,
    user_id: uuid.UUID,
) -> EmployeePayeSettingsResponse:
    target = _target_employee_for_actor(db_session, actor, user_id)
    row = _get_or_create_employee_settings(db_session, target)
    return EmployeePayeSettingsResponse.model_validate(row)


def patch_employee_paye_settings(
    db_session: Session,
    actor: User,
    user_id: uuid.UUID,
    request: EmployeePayeSettingsPatchRequest,
) -> EmployeePayeSettingsResponse:
    target = _target_employee_for_actor(db_session, actor, user_id)
    row = _get_or_create_employee_settings(db_session, target)
    data = request.model_dump(exclude_unset=True)
    for field, value in data.items():
        if field in {"tax_code", "ni_category"}:
            value = _trim_or_none(value)
        setattr(row, field, value)
    row.updated_at = _now()
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return EmployeePayeSettingsResponse.model_validate(row)


def _get_company_settings(db_session: Session, company_id: uuid.UUID) -> CompanyPayeSettings | None:
    return db_session.get(CompanyPayeSettings, company_id)


def _get_or_create_company_settings(db_session: Session, company_id: uuid.UUID) -> CompanyPayeSettings:
    _assert_company_exists(db_session, company_id)
    row = _get_company_settings(db_session, company_id)
    if row is not None:
        return row
    now = _now()
    row = CompanyPayeSettings(
        company_id=company_id,
        default_pension_basis="qualifying_earnings",
        rti_status="not_ready",
        created_at=now,
        updated_at=now,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def read_company_paye_settings(
    db_session: Session,
    actor: User,
    company_id: uuid.UUID | None,
) -> CompanyPayeSettingsResponse:
    cid = _resolve_company_id(actor, company_id)
    row = _get_or_create_company_settings(db_session, cid)
    return CompanyPayeSettingsResponse.model_validate(row)


def patch_company_paye_settings(
    db_session: Session,
    actor: User,
    request: CompanyPayeSettingsPatchRequest,
) -> CompanyPayeSettingsResponse:
    cid = _resolve_company_id(actor, request.company_id)
    row = _get_or_create_company_settings(db_session, cid)
    data = request.model_dump(exclude_unset=True, exclude={"company_id"})
    for field, value in data.items():
        if field in {
            "paye_reference",
            "accounts_office_reference",
            "pension_provider_name",
            "monthly_payday_rule",
            "default_tax_year",
        }:
            value = _trim_or_none(value)
        setattr(row, field, value)
    row.updated_at = _now()
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return CompanyPayeSettingsResponse.model_validate(row)


def _display_name(profile: EmployeeProfile | None) -> str | None:
    if profile is None:
        return None
    value = " ".join(part for part in [profile.first_name, profile.last_name] if part).strip()
    return value or None


def monthly_paye_report_shell(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    year: int,
    month: int,
    employee_user_id: uuid.UUID | None,
) -> MonthlyPayeReportShellResponse:
    cid = _resolve_company_id(actor, company_id)
    company_settings = _get_or_create_company_settings(db_session, cid)
    stmt = (
        select(User, EmployeeProfile, EmployeePayeSettings)
        .outerjoin(EmployeeProfile, EmployeeProfile.user_id == User.id)
        .outerjoin(EmployeePayeSettings, EmployeePayeSettings.user_id == User.id)
        .where(User.company_id == cid)
        .where(User.system_role == SystemRole.EMPLOYEE)
        .where(User.is_active.is_(True))
        .order_by(User.email.asc())
    )
    if employee_user_id is not None:
        stmt = stmt.where(User.id == employee_user_id)
    rows = []
    for user, profile, paye_settings in db_session.execute(stmt).all():
        payroll_type = getattr(profile, "payroll_type", None) or "cis_subcontractor"
        rows.append(
            MonthlyPayeReportShellRow(
                user_id=user.id,
                employee_email=user.email,
                employee_name=_display_name(profile),
                payroll_type=payroll_type,
                tax_code=getattr(paye_settings, "tax_code", None),
                ni_category=getattr(paye_settings, "ni_category", None),
                status="not_calculated",
            ),
        )
    return MonthlyPayeReportShellResponse(
        company_id=cid,
        year=year,
        month=month,
        calculation_enabled=False,
        message="PAYE calculation engine is not enabled yet. Configure employee and company PAYE settings first.",
        company_settings_configured=bool(
            company_settings.paye_reference
            or company_settings.accounts_office_reference
            or company_settings.pension_provider_name
        ),
        rows=rows,
    )
