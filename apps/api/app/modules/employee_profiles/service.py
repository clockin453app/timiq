import uuid

from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.employee_profiles.repository import (
    get_employee_profile_by_user_id,
    save_employee_profile,
    update_employee_profile,
)
from app.modules.employee_profiles.schemas import EmployeeProfileUpdateRequest


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

    for field_name in (
        "first_name",
        "last_name",
        "phone",
        "job_title",
        "start_date",
        "emergency_contact_name",
        "emergency_contact_phone",
    ):
        value = getattr(request, field_name)
        if value is not None:
            setattr(profile, field_name, value)

    if request.is_onboarded is not None:
        profile.is_onboarded = request.is_onboarded

    return update_employee_profile(db_session, profile)
