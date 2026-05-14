import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import (
    get_user_by_email,
    get_user_by_id,
    save_user,
    update_user,
)
from app.modules.auth.schemas import (
    AdminCreateUserRequest,
    UserPasswordResetRequest,
    UserUpdateRequest,
)
from app.modules.auth.security import hash_password, verify_password
from app.modules.companies.repository import get_company_by_id


class AuthError(ValueError):
    pass


class DuplicateEmailError(AuthError):
    pass


class PermissionDeniedError(AuthError):
    pass


class UserNotFoundError(AuthError):
    pass


class CompanyNotFoundError(AuthError):
    pass


def authenticate_user(
    db_session: Session,
    email: str,
    password: str,
) -> User | None:
    user = get_user_by_email(db_session, email)

    if user is None:
        return None

    if not user.is_active:
        return None

    if not verify_password(password, user.password_hash):
        return None

    return user


def can_manage_user(actor: User, target: User) -> bool:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return True

    if actor.system_role != SystemRole.ADMIN:
        return False

    if actor.company_id is None:
        return False

    if target.company_id != actor.company_id:
        return False

    return target.system_role == SystemRole.EMPLOYEE


def resolve_company_for_create_or_update(
    db_session: Session,
    actor: User,
    requested_company_id: uuid.UUID | None,
    requested_role: SystemRole,
) -> uuid.UUID | None:
    if requested_role == SystemRole.ADMINISTRATOR:
        if actor.system_role != SystemRole.ADMINISTRATOR:
            raise PermissionDeniedError("You cannot assign this role.")

        return None

    if actor.system_role == SystemRole.ADMINISTRATOR:
        if requested_role in (SystemRole.ADMIN, SystemRole.EMPLOYEE) and requested_company_id is None:
            raise PermissionDeniedError("Company is required for admin and employee users.")
        if requested_company_id is None:
            return None

        company = get_company_by_id(db_session, requested_company_id)

        if company is None or not company.is_active:
            raise CompanyNotFoundError("Company not found.")

        return company.id

    if actor.system_role == SystemRole.ADMIN:
        if requested_role != SystemRole.EMPLOYEE:
            raise PermissionDeniedError("You cannot assign this role.")

        if actor.company_id is None:
            raise PermissionDeniedError("Your admin account is not assigned to a company.")

        return actor.company_id

    raise PermissionDeniedError("You do not have permission to manage users.")


def create_user_by_admin(
    db_session: Session,
    creator: User,
    request: AdminCreateUserRequest,
) -> User:
    existing_user = get_user_by_email(db_session, request.email)

    if existing_user is not None:
        raise DuplicateEmailError("A user with this email already exists.")

    company_id = resolve_company_for_create_or_update(
        db_session=db_session,
        actor=creator,
        requested_company_id=request.company_id,
        requested_role=request.system_role,
    )

    now = datetime.now(timezone.utc)
    user = User(
        email=request.email,
        password_hash=hash_password(request.password),
        system_role=request.system_role,
        company_id=company_id,
        is_active=request.is_active,
        password_changed_at=now,
    )

    return save_user(db_session, user)


def update_user_status_by_admin(
    db_session: Session,
    actor: User,
    user_id: uuid.UUID,
    is_active: bool,
) -> User:
    user = get_user_by_id(db_session, user_id)

    if user is None:
        raise UserNotFoundError("User not found.")

    if user.id == actor.id and not is_active:
        raise PermissionDeniedError("You cannot deactivate your own account.")

    if not can_manage_user(actor, user):
        raise PermissionDeniedError("You cannot update this user.")

    user.is_active = is_active

    return update_user(db_session, user)


def update_user_by_admin(
    db_session: Session,
    actor: User,
    user_id: uuid.UUID,
    request: UserUpdateRequest,
) -> User:
    user = get_user_by_id(db_session, user_id)

    if user is None:
        raise UserNotFoundError("User not found.")

    if user.id == actor.id and request.system_role != actor.system_role:
        raise PermissionDeniedError("You cannot change your own role.")

    if not can_manage_user(actor, user):
        raise PermissionDeniedError("You cannot update this user.")

    existing_user = get_user_by_email(db_session, request.email)

    if existing_user is not None and existing_user.id != user.id:
        raise DuplicateEmailError("A user with this email already exists.")

    company_id = resolve_company_for_create_or_update(
        db_session=db_session,
        actor=actor,
        requested_company_id=request.company_id,
        requested_role=request.system_role,
    )

    user.email = request.email
    user.system_role = request.system_role
    user.company_id = company_id

    return update_user(db_session, user)


def reset_user_password_by_admin(
    db_session: Session,
    actor: User,
    user_id: uuid.UUID,
    request: UserPasswordResetRequest,
) -> User:
    user = get_user_by_id(db_session, user_id)

    if user is None:
        raise UserNotFoundError("User not found.")

    if not can_manage_user(actor, user):
        raise PermissionDeniedError("You cannot reset this user's password.")

    user.password_hash = hash_password(request.password)
    user.password_changed_at = datetime.now(timezone.utc)

    return update_user(db_session, user)