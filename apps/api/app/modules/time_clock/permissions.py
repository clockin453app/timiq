"""Authorization helpers for clock selfie viewing."""

from app.modules.auth.models import SystemRole, User
from app.modules.auth.service import can_manage_user

# TODO: Narrow company-admin selfie access to workplace/site-manager scope when workplace manager permissions are introduced.


def can_view_shift_owner_selfies(actor: User, shift_owner: User) -> bool:
    """Whether actor may list or download selfies for shifts owned by shift_owner (subject user)."""
    if actor.id == shift_owner.id:
        return True

    if actor.system_role == SystemRole.ADMINISTRATOR:
        return True

    if actor.system_role == SystemRole.ADMIN:
        return can_manage_user(actor, shift_owner)

    return False
