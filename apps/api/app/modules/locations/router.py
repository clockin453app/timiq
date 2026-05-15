import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import (
    get_current_user,
    require_admin_or_administrator,
)
from app.modules.auth.models import User
from app.modules.locations.schemas import (
    LocationCreateRequest,
    LocationResponse,
    LocationStatusUpdateRequest,
    LocationUpdateRequest,
)
from app.modules.locations.service import (
    DuplicateLocationError,
    LocationAccessDeniedError,
    LocationCompanyNotFoundError,
    LocationNotFoundError,
    create_location,
    list_locations_visible_to_user,
    update_location_details,
    update_location_status,
)

router = APIRouter(prefix="/api/locations", tags=["locations"])


@router.get("", response_model=list[LocationResponse])
def get_locations(
    company_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> list[LocationResponse]:
    from app.modules.locations.service import LocationError

    try:
        locations = list_locations_visible_to_user(db_session, current_user, company_id=company_id)
    except LocationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return [LocationResponse.model_validate(location) for location in locations]


@router.post(
    "",
    response_model=LocationResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_managed_location(
    request: LocationCreateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> LocationResponse:
    try:
        location = create_location(
            db_session=db_session,
            actor=current_user,
            request=request,
        )
    except DuplicateLocationError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A location with this name already exists for this company.",
        ) from exc
    except LocationAccessDeniedError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except LocationCompanyNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found.",
        ) from exc

    return LocationResponse.model_validate(location)


@router.patch("/{location_id}", response_model=LocationResponse)
def update_managed_location(
    location_id: uuid.UUID,
    request: LocationUpdateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> LocationResponse:
    try:
        location = update_location_details(
            db_session=db_session,
            actor=current_user,
            location_id=location_id,
            request=request,
        )
    except DuplicateLocationError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except LocationAccessDeniedError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except LocationCompanyNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found.",
        ) from exc
    except LocationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Location not found.",
        ) from exc

    return LocationResponse.model_validate(location)


@router.patch("/{location_id}/status", response_model=LocationResponse)
def update_managed_location_status(
    location_id: uuid.UUID,
    request: LocationStatusUpdateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> LocationResponse:
    try:
        location = update_location_status(
            db_session=db_session,
            actor=current_user,
            location_id=location_id,
            is_active=request.is_active,
        )
    except LocationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Location not found.",
        ) from exc
    except LocationAccessDeniedError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

    return LocationResponse.model_validate(location)