from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import require_admin_or_administrator
from app.modules.auth.models import User
from app.modules.site_access.schemas import (
    SiteAccessCreateRequest,
    SiteAccessDeleteRequest,
    SiteAccessResponse,
)
from app.modules.site_access.service import (
    SiteAccessDuplicateError,
    SiteAccessLocationNotFoundError,
    SiteAccessNotFoundError,
    SiteAccessPermissionError,
    SiteAccessUserNotFoundError,
    create_site_access,
    list_site_access_visible_to_user,
    remove_site_access,
)

router = APIRouter(prefix="/api/site-access", tags=["site-access"])


@router.get("", response_model=list[SiteAccessResponse])
def get_site_access_records(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[SiteAccessResponse]:
    records = list_site_access_visible_to_user(db_session, current_user)
    return [SiteAccessResponse.model_validate(record) for record in records]


@router.post(
    "",
    response_model=SiteAccessResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_managed_site_access(
    request: SiteAccessCreateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> SiteAccessResponse:
    try:
        record = create_site_access(
            db_session=db_session,
            actor=current_user,
            user_id=request.user_id,
            location_id=request.location_id,
        )
    except SiteAccessUserNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        ) from exc
    except SiteAccessLocationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Location not found.",
        ) from exc
    except SiteAccessDuplicateError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This user already has access to this location.",
        ) from exc
    except SiteAccessPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

    return SiteAccessResponse.model_validate(record)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_managed_site_access(
    request: SiteAccessDeleteRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    try:
        remove_site_access(
            db_session=db_session,
            actor=current_user,
            user_id=request.user_id,
            location_id=request.location_id,
        )
    except SiteAccessUserNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        ) from exc
    except SiteAccessLocationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Location not found.",
        ) from exc
    except SiteAccessNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Site access not found.",
        ) from exc
    except SiteAccessPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

    return Response(status_code=status.HTTP_204_NO_CONTENT)