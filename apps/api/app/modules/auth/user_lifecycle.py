"""Administrator-only destructive user lifecycle (hard delete, history clear)."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.storage.factory import get_storage_backend
from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import delete_user_record, get_user_by_id
from app.modules.auth.service import UserNotFoundError
from app.modules.employee_profiles.repository import (
    delete_employee_profile_by_user_id,
    get_employee_profile_by_user_id,
    reset_employee_profile_after_history_clear,
)
from app.modules.site_access.models import EmployeeLocationAccess
from app.modules.site_access.repository import delete_all_site_access_for_user
from app.modules.time_clock.models import ClockSelfie, TimeShift, TimeShiftBreak

USER_DELETE_BLOCKED_MESSAGE = (
    "This employee has history and cannot be deleted. "
    "Deactivate the account or clear history first."
)


class UserHasOperationalHistoryError(ValueError):
    pass


class DeleteUserPermissionError(ValueError):
    pass


class ClearHistoryPermissionError(ValueError):
    pass


def _unlink_clock_selfie_file(relative_path: str) -> None:
    backend = get_storage_backend()
    absolute_path = backend.build_path(relative_path)
    try:
        absolute_path.unlink(missing_ok=True)
    except OSError:
        pass


def _delete_shift_tree(db_session: Session, shift_id: uuid.UUID) -> None:
    selfies = db_session.scalars(
        select(ClockSelfie).where(ClockSelfie.time_shift_id == shift_id),
    ).all()
    for selfie in selfies:
        _unlink_clock_selfie_file(selfie.storage_path)
        db_session.delete(selfie)

    breaks = db_session.scalars(
        select(TimeShiftBreak).where(TimeShiftBreak.time_shift_id == shift_id),
    ).all()
    for shift_break in breaks:
        db_session.delete(shift_break)

    shift = db_session.get(TimeShift, shift_id)
    if shift is not None:
        db_session.delete(shift)


def _count_shifts(db_session: Session, user_id: uuid.UUID) -> int:
    stmt = select(func.count()).select_from(TimeShift).where(TimeShift.user_id == user_id)
    value = db_session.scalar(stmt)
    return int(value or 0)


def _count_site_access(db_session: Session, user_id: uuid.UUID) -> int:
    stmt = (
        select(func.count())
        .select_from(EmployeeLocationAccess)
        .where(EmployeeLocationAccess.user_id == user_id)
    )
    value = db_session.scalar(stmt)
    return int(value or 0)


def _user_has_hard_delete_blockers(db_session: Session, user_id: uuid.UUID) -> bool:
    if _count_shifts(db_session, user_id) > 0:
        return True
    if _count_site_access(db_session, user_id) > 0:
        return True
    profile = get_employee_profile_by_user_id(db_session, user_id)
    if profile is not None and profile.is_onboarded:
        return True
    return False


def delete_user_hard_by_administrator(
    db_session: Session,
    actor: User,
    user_id: uuid.UUID,
) -> None:
    if actor.system_role != SystemRole.ADMINISTRATOR:
        raise DeleteUserPermissionError("Only an Administrator can delete users.")

    if actor.id == user_id:
        raise DeleteUserPermissionError("You cannot delete your own account.")

    target = get_user_by_id(db_session, user_id)
    if target is None:
        raise UserNotFoundError("User not found.")

    if target.system_role == SystemRole.ADMINISTRATOR:
        raise DeleteUserPermissionError("Administrator accounts cannot be deleted.")

    if _user_has_hard_delete_blockers(db_session, user_id):
        raise UserHasOperationalHistoryError(USER_DELETE_BLOCKED_MESSAGE)

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="user_hard_deleted",
        entity_type="user",
        entity_id=str(user_id),
        company_id=target.company_id,
        details={"email": target.email},
    )

    delete_employee_profile_by_user_id(db_session, user_id)
    db_session.flush()

    delete_user_record(db_session, target)


def clear_user_operational_history(
    db_session: Session,
    actor: User,
    user_id: uuid.UUID,
) -> None:
    if actor.system_role != SystemRole.ADMINISTRATOR:
        raise ClearHistoryPermissionError("Only an Administrator can clear employee history.")

    if actor.id == user_id:
        raise ClearHistoryPermissionError("You cannot clear history for your own account.")

    target = get_user_by_id(db_session, user_id)
    if target is None:
        raise UserNotFoundError("User not found.")

    if target.system_role == SystemRole.ADMINISTRATOR:
        raise ClearHistoryPermissionError("Administrator history cannot be cleared.")

    shifts = db_session.scalars(select(TimeShift).where(TimeShift.user_id == user_id)).all()
    for shift in shifts:
        _delete_shift_tree(db_session, shift.id)

    delete_all_site_access_for_user(db_session, user_id)

    reset_employee_profile_after_history_clear(db_session, user_id)

    db_session.commit()

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="user_history_cleared",
        entity_type="user",
        entity_id=str(user_id),
        company_id=target.company_id,
        details={"email": target.email},
    )
