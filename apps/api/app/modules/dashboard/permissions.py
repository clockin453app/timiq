import uuid

from app.modules.auth.models import SystemRole, User


class DashboardPermissionError(ValueError):
    pass


def assert_management_dashboard_actor(actor: User) -> None:
    if actor.system_role not in (SystemRole.ADMINISTRATOR, SystemRole.ADMIN):
        raise DashboardPermissionError("Management dashboard requires Admin or Administrator.")


def assert_administrator_company_filter(actor: User, company_id: uuid.UUID | None) -> None:
    if company_id is not None and actor.system_role != SystemRole.ADMINISTRATOR:
        raise DashboardPermissionError("company_id filter is only valid for administrators.")
