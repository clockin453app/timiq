"""Former-employee limited self-service (timesheets + pay history only)."""

from __future__ import annotations

from app.modules.auth.models import SystemRole, User


def has_limited_access(user: User) -> bool:
    """Deactivated employees may sign in for historical payroll records only."""
    return (
        not user.is_active
        and user.system_role == SystemRole.EMPLOYEE
    )


def may_login_while_inactive(user: User) -> bool:
    return has_limited_access(user)
