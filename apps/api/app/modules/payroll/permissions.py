import uuid

from app.modules.auth.models import SystemRole, User
from app.modules.auth.service import can_manage_user
from app.modules.payroll.models import PayrollItem


class PayrollPermissionError(ValueError):
    pass


def assert_actor_can_view_payroll_item(actor: User, item: PayrollItem, owner: User) -> None:
    """Employee payslip/pay-week: own paid item only.

    Management (Admin / Administrator) may still preview approved or paid items when
    company/ownership rules allow — employee release requires status == paid.
    """
    if actor.system_role == SystemRole.ADMINISTRATOR:
        if item.status not in ("approved", "paid"):
            raise PayrollPermissionError("This payroll item is not available.")
        return
    if actor.system_role == SystemRole.ADMIN:
        if item.status not in ("approved", "paid"):
            raise PayrollPermissionError("This payroll item is not available.")
        if can_manage_user(actor, owner):
            return
        raise PayrollPermissionError("You cannot view this payroll item.")
    # Employee (and any other self-service role): paid-only release for own item.
    if item.status != "paid":
        raise PayrollPermissionError("This payroll item is not available.")
    if actor.id == item.user_id:
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
