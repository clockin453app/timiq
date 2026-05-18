import uuid

from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.auth.service import can_manage_user
from app.modules.companies.repository import get_company_by_id
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.employee_profiles.repository import (
    get_employee_profile_by_user_id,
    save_employee_profile,
    update_employee_profile,
)
from app.modules.employee_profiles.sanitize_tax_ids import (
    sanitize_national_insurance_value,
    sanitize_utr_value,
)
from app.modules.employee_profiles.schemas import (
    EmployeeProfileResponse,
    EmployeeProfileUpdateRequest,
)
from app.modules.face_check.service import face_reference_configured
from app.modules.payroll.calculation import normalize_payroll_payment_mode


def employee_profile_to_response(
    db_session: Session,
    profile: EmployeeProfile,
    *,
    actor: User,
) -> EmployeeProfileResponse:
    company_name: str | None = None
    if profile.company_id is not None:
        company = get_company_by_id(db_session, profile.company_id)
        if company is not None:
            company_name = company.name

    mask_rates = actor.id == profile.user_id
    base = EmployeeProfileResponse.model_validate(profile).model_copy(
        update={
            "company_name": company_name,
            "face_reference_configured": face_reference_configured(profile),
        },
    )
    if mask_rates:
        return base.model_copy(
            update={
                "hourly_rate": None,
                "tax_rate": None,
                "payment_mode": None,
                "payroll_type": base.payroll_type,
                "national_insurance_number": None,
                "utr_number": None,
            },
        )
    return base


class EmployeeProfileError(ValueError):
    pass


class EmployeeProfilePermissionError(EmployeeProfileError):
    pass


class EmployeeProfileTargetUserNotFoundError(EmployeeProfileError):
    pass


def can_manage_profile(actor: User, target_user: User) -> bool:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return True

    if actor.system_role == SystemRole.ADMIN:
        return actor.company_id is not None and actor.company_id == target_user.company_id

    return actor.id == target_user.id


def get_or_create_profile_for_user(
    db_session: Session,
    target_user: User,
) -> EmployeeProfile:
    profile = get_employee_profile_by_user_id(db_session, target_user.id)
    if profile is not None:
        return profile

    return save_employee_profile(
        db_session,
        EmployeeProfile(
            user_id=target_user.id,
            company_id=target_user.company_id,
        ),
    )


def get_profile_for_actor_or_user_id(
    db_session: Session,
    actor: User,
    user_id: uuid.UUID | None = None,
) -> EmployeeProfile:
    target_user_id = user_id or actor.id
    target_user = get_user_by_id(db_session, target_user_id)
    if target_user is None:
        raise EmployeeProfileTargetUserNotFoundError("User not found.")

    if not can_manage_profile(actor, target_user):
        raise EmployeeProfilePermissionError("You do not have permission to view this profile.")

    return get_or_create_profile_for_user(db_session, target_user)


def update_profile_for_actor_or_user_id(
    db_session: Session,
    actor: User,
    request: EmployeeProfileUpdateRequest,
    user_id: uuid.UUID | None = None,
) -> EmployeeProfile:
    target_user_id = user_id or actor.id
    target_user = get_user_by_id(db_session, target_user_id)
    if target_user is None:
        raise EmployeeProfileTargetUserNotFoundError("User not found.")

    if not can_manage_profile(actor, target_user):
        raise EmployeeProfilePermissionError("You do not have permission to update this profile.")

    profile = get_or_create_profile_for_user(db_session, target_user)

    set_data = request.model_dump(exclude_unset=True)

    for field_name in (
        "first_name",
        "last_name",
        "phone",
        "start_date",
        "emergency_contact_name",
        "emergency_contact_phone",
    ):
        value = getattr(request, field_name)
        if value is not None:
            setattr(profile, field_name, value)

    if "job_title" in set_data:
        profile.job_title = (request.job_title or "").strip() or None

    if "national_insurance_number" in set_data or "utr_number" in set_data:
        if actor.id == target_user.id:
            raise EmployeeProfilePermissionError("You cannot update tax identifiers on your own profile.")
        if not can_manage_user(actor, target_user):
            raise EmployeeProfilePermissionError(
                "You cannot update tax identifiers for this user.",
            )
        if "national_insurance_number" in set_data:
            raw_ni = (request.national_insurance_number or "").strip()
            profile.national_insurance_number = (
                sanitize_national_insurance_value(raw_ni) if raw_ni else None
            )
        if "utr_number" in set_data:
            raw_utr = (request.utr_number or "").strip()
            profile.utr_number = sanitize_utr_value(raw_utr) if raw_utr else None

    if request.is_onboarded is not None:
        profile.is_onboarded = request.is_onboarded

    if request.early_access_enabled is not None:
        if actor.id == target_user.id:
            raise EmployeeProfilePermissionError("Employees cannot update early access.")
        if not can_manage_user(actor, target_user):
            raise EmployeeProfilePermissionError(
                "You cannot update early access for this user.",
            )
        profile.early_access_enabled = request.early_access_enabled

    if (
        request.hourly_rate is not None
        or request.tax_rate is not None
        or "payment_mode" in set_data
        or "payroll_type" in set_data
    ):
        if actor.id == target_user.id:
            raise EmployeeProfilePermissionError("You cannot update payroll rates on your own profile.")
        if not can_manage_user(actor, target_user):
            raise EmployeeProfilePermissionError(
                "You cannot update payroll rates for this user.",
            )
        if request.hourly_rate is not None:
            profile.hourly_rate = float(request.hourly_rate)
        if request.tax_rate is not None:
            profile.tax_rate = float(request.tax_rate)
        if "payment_mode" in set_data:
            profile.payment_mode = (
                normalize_payroll_payment_mode(request.payment_mode)
                if request.payment_mode is not None
                else None
            )
        if "payroll_type" in set_data:
            profile.payroll_type = request.payroll_type or "cis_subcontractor"

    return update_employee_profile(db_session, profile)
