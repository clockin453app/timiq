import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import get_current_user, require_admin_or_administrator
from app.modules.auth.models import User
from app.modules.employee_profiles.schemas import (
    EmployeeProfileResponse,
    EmployeeProfileUpdateRequest,
)
from app.modules.employee_profiles.service import (
    EmployeeProfilePermissionError,
    EmployeeProfileTargetUserNotFoundError,
    employee_profile_to_response,
    get_profile_for_actor_or_user_id,
    update_profile_for_actor_or_user_id,
)

router = APIRouter(prefix="/api/employee-profiles", tags=["employee-profiles"])


@router.get("/me", response_model=EmployeeProfileResponse)
def get_my_profile(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> EmployeeProfileResponse:
    profile = get_profile_for_actor_or_user_id(db_session=db_session, actor=current_user)
    return employee_profile_to_response(db_session, profile)


@router.patch("/me", response_model=EmployeeProfileResponse)
def update_my_profile(
    request: EmployeeProfileUpdateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> EmployeeProfileResponse:
    try:
        profile = update_profile_for_actor_or_user_id(
            db_session=db_session,
            actor=current_user,
            request=request,
        )
    except EmployeeProfilePermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

    return employee_profile_to_response(db_session, profile)


@router.get("", response_model=EmployeeProfileResponse)
def get_managed_profile(
    user_id: uuid.UUID = Query(...),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> EmployeeProfileResponse:
    try:
        profile = get_profile_for_actor_or_user_id(
            db_session=db_session,
            actor=current_user,
            user_id=user_id,
        )
    except EmployeeProfileTargetUserNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        ) from exc
    except EmployeeProfilePermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

    return employee_profile_to_response(db_session, profile)


@router.patch("", response_model=EmployeeProfileResponse)
def patch_managed_profile(
    request: EmployeeProfileUpdateRequest,
    user_id: uuid.UUID = Query(...),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> EmployeeProfileResponse:
    try:
        profile = update_profile_for_actor_or_user_id(
            db_session=db_session,
            actor=current_user,
            request=request,
            user_id=user_id,
        )
    except EmployeeProfileTargetUserNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        ) from exc
    except EmployeeProfilePermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

    return employee_profile_to_response(db_session, profile)
