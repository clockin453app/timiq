import uuid

from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.companies.repository import get_company_by_id
from app.modules.locations.models import Location
from app.modules.locations.repository import (
    get_location_by_company_and_name,
    get_location_by_id,
    list_locations,
    list_locations_by_company,
    save_location,
    update_location,
)
from app.modules.locations.schemas import LocationCreateRequest, LocationUpdateRequest


class LocationError(ValueError):
    pass


class DuplicateLocationError(LocationError):
    pass


class LocationNotFoundError(LocationError):
    pass


class LocationAccessDeniedError(LocationError):
    pass


class LocationCompanyNotFoundError(LocationError):
    pass


def list_locations_visible_to_user(
    db_session: Session,
    actor: User,
) -> list[Location]:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return list_locations(db_session)

    if actor.company_id is None:
        return []

    return list_locations_by_company(db_session, actor.company_id)


def resolve_location_company_id(
    db_session: Session,
    actor: User,
    request: LocationCreateRequest,
) -> uuid.UUID:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        if request.company_id is None:
            raise LocationAccessDeniedError("Select a company for this location.")

        company = get_company_by_id(db_session, request.company_id)

        if company is None or not company.is_active:
            raise LocationCompanyNotFoundError("Company not found.")

        return company.id

    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            raise LocationAccessDeniedError(
                "Your admin account is not assigned to a company."
            )

        company = get_company_by_id(db_session, actor.company_id)

        if company is None or not company.is_active:
            raise LocationCompanyNotFoundError("Company not found.")

        return actor.company_id

    raise LocationAccessDeniedError("You cannot create locations.")


def create_location(
    db_session: Session,
    actor: User,
    request: LocationCreateRequest,
) -> Location:
    company_id = resolve_location_company_id(
        db_session=db_session,
        actor=actor,
        request=request,
    )

    existing_location = get_location_by_company_and_name(
        db_session=db_session,
        company_id=company_id,
        name=request.name,
    )

    if existing_location is not None:
        raise DuplicateLocationError(
            "A location with this name already exists for this company."
        )

    location = Location(
        company_id=company_id,
        name=request.name,
        address=request.address,
        latitude=request.latitude,
        longitude=request.longitude,
        geofence_radius_meters=request.geofence_radius_meters,
        is_active=request.is_active,
    )

    return save_location(db_session, location)


def update_location_details(
    db_session: Session,
    actor: User,
    location_id: uuid.UUID,
    request: LocationUpdateRequest,
) -> Location:
    location = get_location_by_id(db_session, location_id)

    if location is None:
        raise LocationNotFoundError("Location not found.")

    if actor.system_role == SystemRole.ADMINISTRATOR:
        pass
    elif actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            raise LocationAccessDeniedError(
                "Your admin account is not assigned to a company."
            )
        if location.company_id != actor.company_id:
            raise LocationAccessDeniedError(
                "You cannot update locations outside your company."
            )
    else:
        raise LocationAccessDeniedError("You cannot update locations.")

    resolved_company_id = location.company_id
    if actor.system_role == SystemRole.ADMINISTRATOR:
        if request.company_id is not None:
            company = get_company_by_id(db_session, request.company_id)
            if company is None or not company.is_active:
                raise LocationCompanyNotFoundError("Company not found.")
            resolved_company_id = company.id
    elif actor.system_role == SystemRole.ADMIN:
        resolved_company_id = actor.company_id

    duplicate = get_location_by_company_and_name(
        db_session=db_session,
        company_id=resolved_company_id,
        name=request.name,
    )
    if duplicate is not None and duplicate.id != location.id:
        raise DuplicateLocationError(
            "A location with this name already exists for this company."
        )

    location.company_id = resolved_company_id
    location.name = request.name
    location.address = request.address
    location.latitude = request.latitude
    location.longitude = request.longitude
    location.geofence_radius_meters = request.geofence_radius_meters
    location.is_active = request.is_active

    return update_location(db_session, location)


def update_location_status(
    db_session: Session,
    actor: User,
    location_id: uuid.UUID,
    is_active: bool,
) -> Location:
    location = get_location_by_id(db_session, location_id)

    if location is None:
        raise LocationNotFoundError("Location not found.")

    if actor.system_role == SystemRole.ADMINISTRATOR:
        location.is_active = is_active
        return update_location(db_session, location)

    if actor.company_id is None:
        raise LocationAccessDeniedError(
            "Your admin account is not assigned to a company."
        )

    if location.company_id != actor.company_id:
        raise LocationAccessDeniedError(
            "You cannot update locations outside your company."
        )

    location.is_active = is_active

    return update_location(db_session, location)