import uuid

from sqlalchemy.orm import Session

from app.core.company_scope import CompanyScopeError, resolve_operational_company_id
from app.modules.auth.models import SystemRole, User
from app.modules.auth.service import can_manage_user


class LiveAttendancePermissionError(ValueError):
    pass


def assert_target_is_manageable_employee(actor: User, target: User) -> None:
    if target.system_role != SystemRole.EMPLOYEE:
        raise LiveAttendancePermissionError("Target user must be an employee.")

    if not can_manage_user(actor, target):
        raise LiveAttendancePermissionError("You cannot manage this employee.")


def resolve_live_attendance_company_id(
    db_session: Session,
    actor: User,
    company_id: uuid.UUID | None,
) -> uuid.UUID | None:
    """
    Company admin: implicit own company (company_id query ignored).
    Administrator: company_id required.
    """
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            raise LiveAttendancePermissionError("Admin user is not assigned to a company.")
        if company_id is not None and company_id != actor.company_id:
            raise LiveAttendancePermissionError("You cannot access another company's data.")
        return None

    try:
        return resolve_operational_company_id(db_session, actor, company_id)
    except CompanyScopeError as exc:
        raise LiveAttendancePermissionError(str(exc)) from exc
