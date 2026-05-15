import uuid

from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.locations.repository import (
    get_location_by_id,
    list_locations_by_company,
)
from app.modules.site_access.models import EmployeeLocationAccess
from app.modules.site_access.repository import (
    delete_site_access,
    get_site_access,
    list_site_access,
    list_site_access_for_location_ids,
    save_site_access,
)


class SiteAccessError(ValueError):
    pass


class SiteAccessNotFoundError(SiteAccessError):
    pass


class SiteAccessDuplicateError(SiteAccessError):
    pass


class SiteAccessPermissionError(SiteAccessError):
    pass


class SiteAccessUserNotFoundError(SiteAccessError):
    pass


class SiteAccessLocationNotFoundError(SiteAccessError):
    pass


def can_manage_site_access_for_pair(
    actor: User,
    target_user: User,
    location_company_id: uuid.UUID,
) -> bool:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        if target_user.system_role == SystemRole.ADMINISTRATOR:
            return False

        if target_user.company_id is None:
            return False

        return target_user.company_id == location_company_id

    if actor.system_role != SystemRole.ADMIN:
        return False

    if actor.company_id is None:
        return False

    if target_user.system_role != SystemRole.EMPLOYEE:
        return False

    return target_user.company_id == actor.company_id and location_company_id == actor.company_id


def list_site_access_visible_to_user(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None = None,
) -> list[EmployeeLocationAccess]:
    from app.core.company_scope import CompanyScopeError, resolve_operational_company_id

    if actor.system_role == SystemRole.ADMINISTRATOR:
        try:
            scoped_company_id = resolve_operational_company_id(db_session, actor, company_id)
        except CompanyScopeError as exc:
            raise SiteAccessError(str(exc)) from exc
        locations = list_locations_by_company(db_session, scoped_company_id)
        location_ids = [location.id for location in locations]
        return list_site_access_for_location_ids(db_session, location_ids)

    if actor.company_id is None:
        return []

    locations = list_locations_by_company(db_session, actor.company_id)
    location_ids = [location.id for location in locations]

    return list_site_access_for_location_ids(db_session, location_ids)


def create_site_access(
    db_session: Session,
    actor: User,
    user_id: uuid.UUID,
    location_id: uuid.UUID,
) -> EmployeeLocationAccess:
    target_user = get_user_by_id(db_session, user_id)

    if target_user is None or not target_user.is_active:
        raise SiteAccessUserNotFoundError("User not found.")

    location = get_location_by_id(db_session, location_id)

    if location is None or not location.is_active:
        raise SiteAccessLocationNotFoundError("Location not found.")

    if not can_manage_site_access_for_pair(actor, target_user, location.company_id):
        raise SiteAccessPermissionError("You cannot assign this location.")

    existing_access = get_site_access(
        db_session=db_session,
        user_id=user_id,
        location_id=location_id,
    )

    if existing_access is not None:
        raise SiteAccessDuplicateError("This user already has access to this location.")

    site_access = EmployeeLocationAccess(
        user_id=user_id,
        location_id=location_id,
    )

    return save_site_access(db_session, site_access)


def remove_site_access(
    db_session: Session,
    actor: User,
    user_id: uuid.UUID,
    location_id: uuid.UUID,
) -> None:
    target_user = get_user_by_id(db_session, user_id)

    if target_user is None:
        raise SiteAccessUserNotFoundError("User not found.")

    location = get_location_by_id(db_session, location_id)

    if location is None:
        raise SiteAccessLocationNotFoundError("Location not found.")

    if not can_manage_site_access_for_pair(actor, target_user, location.company_id):
        raise SiteAccessPermissionError("You cannot remove this location access.")

    existing_access = get_site_access(
        db_session=db_session,
        user_id=user_id,
        location_id=location_id,
    )

    if existing_access is None:
        raise SiteAccessNotFoundError("Site access not found.")

    delete_site_access(
        db_session=db_session,
        user_id=user_id,
        location_id=location_id,
    )