import uuid

from app.modules.auth.models import SystemRole, User


class PayrollPermissionError(ValueError):
    pass


def assert_payroll_company_scope(actor: User, company_id: uuid.UUID) -> None:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return
    if actor.system_role == SystemRole.ADMIN and actor.company_id == company_id:
        return
    raise PayrollPermissionError("You cannot manage payroll for this company.")


def assert_payroll_admin_or_administrator(actor: User) -> None:
    if actor.system_role not in (SystemRole.ADMINISTRATOR, SystemRole.ADMIN):
        raise PayrollPermissionError("Payroll management requires Admin or Administrator.")
