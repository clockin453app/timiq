"""Who may view time-record rows for a shift owner."""

from app.modules.auth.models import SystemRole, User
from app.modules.auth.service import can_manage_user


def can_view_time_record_shift_owner(actor: User, shift_owner: User) -> bool:
    """Employee sees own shifts; admin sees manageable employees; administrator sees all."""
    if actor.id == shift_owner.id:
        return True

    if actor.system_role == SystemRole.ADMINISTRATOR:
        return True

    return can_manage_user(actor, shift_owner)
