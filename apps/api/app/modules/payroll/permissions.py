import uuid

from app.modules.auth.models import SystemRole, User
from app.modules.auth.service import can_manage_user
from app.modules.payroll.models import PayrollItem


class PayrollPermissionError(ValueError):
    pass


def assert_actor_can_view_payroll_item(actor: User, item: PayrollItem, owner: User) -> None:
    """Employee: own approved/paid item only. Admin: manageable employee. Administrator: any."""
    if item.status not in ("approved", "paid"):
        raise PayrollPermissionError("This payroll item is not available.")
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return
    if actor.id == item.user_id:
        return
    if actor.system_role == SystemRole.ADMIN and can_manage_user(actor, owner):
        return
    raise PayrollPermissionError("You cannot view this payroll item.")


def assert_payroll_company_scope(actor: User, company_id: uuid.UUID) -> None:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return
    if actor.system_role == SystemRole.ADMIN and actor.company_id == company_id:
        return
    raise PayrollPermissionError("You cannot manage payroll for this company.")


def assert_payroll_admin_or_administrator(actor: User) -> None:
    if actor.system_role not in (SystemRole.ADMINISTRATOR, SystemRole.ADMIN):
        raise PayrollPermissionError("Payroll management requires Admin or Administrator.")
