import uuid

from app.modules.auth.models import SystemRole, User
from app.modules.auth.service import can_manage_user


class LiveAttendancePermissionError(ValueError):
    pass


def assert_target_is_manageable_employee(actor: User, target: User) -> None:
    if target.system_role != SystemRole.EMPLOYEE:
        raise LiveAttendancePermissionError("Target user must be an employee.")

    if not can_manage_user(actor, target):
        raise LiveAttendancePermissionError("You cannot manage this employee.")


def assert_administrator_company_scope(actor: User, company_id: uuid.UUID | None) -> None:
    if company_id is None:
        return
    if actor.system_role != SystemRole.ADMINISTRATOR:
        raise LiveAttendancePermissionError("Only an administrator may filter by company.")
