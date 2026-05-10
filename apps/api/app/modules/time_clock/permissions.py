"""Authorization helpers for clock selfie viewing."""

from app.modules.auth.models import SystemRole, User


def can_view_shift_owner_selfies(actor: User, shift_owner: User) -> bool:
    """Whether actor may list or download selfies belonging to shifts owned by shift_owner."""
    if actor.id == shift_owner.id:
        return True

    if actor.system_role == SystemRole.ADMINISTRATOR:
        return True

    if actor.system_role != SystemRole.ADMIN:
        return False

    if actor.company_id is None or shift_owner.company_id is None:
        return False

    return shift_owner.company_id == actor.company_id
