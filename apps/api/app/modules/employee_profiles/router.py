import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.storage.file_response import protected_file_response
from app.db.session import get_db_session
from app.modules.auth.dependencies import (
    get_current_user,
    require_active_user,
    require_admin_or_administrator,
    require_authenticated_employee_self_service,
)
from app.modules.auth.models import User
from app.modules.employee_profiles.face_reference_service import (
    FaceReferenceError,
    FaceReferenceNotFoundError,
    FaceReferencePermissionError,
    enroll_face_reference,
    remove_face_reference,
    resolve_face_reference_image,
)
from app.modules.employee_profiles.schemas import (
    EmployeeProfileResponse,
    EmployeeProfileUpdateRequest,
    FaceReferenceStatusResponse,
)
from app.modules.employee_profiles.service import (
    EmployeeProfilePermissionError,
    EmployeeProfileTargetUserNotFoundError,
    employee_profile_to_response,
    get_profile_for_actor_or_user_id,
    update_profile_for_actor_or_user_id,
)
from app.modules.face_check.image_validation import FaceImageValidationError
from app.modules.face_check.service import face_reference_configured

router = APIRouter(prefix="/api/employee-profiles", tags=["employee-profiles"])


def _face_reference_status_response(profile) -> FaceReferenceStatusResponse:
    return FaceReferenceStatusResponse(
        face_check_consent_at=profile.face_check_consent_at,
        face_reference_enrolled_at=profile.face_reference_enrolled_at,
        face_reference_updated_at=profile.face_reference_updated_at,
        face_reference_configured=face_reference_configured(profile),
    )


@router.post("/me/face-reference", response_model=FaceReferenceStatusResponse)
async def enroll_my_face_reference(
    consent: bool = Form(...),
    image: UploadFile = File(...),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_active_user),
) -> FaceReferenceStatusResponse:
    file_bytes = await image.read()
    try:
        profile = enroll_face_reference(
            db_session,
            current_user,
            consent=consent,
            content_type=image.content_type or "application/octet-stream",
            file_bytes=file_bytes,
        )
    except FaceReferencePermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except (FaceReferenceError, FaceImageValidationError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _face_reference_status_response(profile)


@router.delete("/me/face-reference", response_model=FaceReferenceStatusResponse)
def delete_my_face_reference(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_active_user),
) -> FaceReferenceStatusResponse:
    try:
        profile = remove_face_reference(db_session, current_user)
    except FaceReferencePermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return _face_reference_status_response(profile)


@router.get("/users/{user_id}/face-reference-image")
def read_user_face_reference_image(
    user_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> Response:
    try:
        data, media_type, filename, _subject = resolve_face_reference_image(
            db_session,
            current_user,
            user_id,
        )
    except FaceReferencePermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except FaceReferenceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return protected_file_response(body=data, media_type=media_type, download_filename=filename)


@router.get("/me", response_model=EmployeeProfileResponse)
def get_my_profile(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee_self_service),
) -> EmployeeProfileResponse:
    profile = get_profile_for_actor_or_user_id(db_session=db_session, actor=current_user)
    return employee_profile_to_response(db_session, profile, actor=current_user)


@router.patch("/me", response_model=EmployeeProfileResponse)
def update_my_profile(
    request: EmployeeProfileUpdateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee_self_service),
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

    return employee_profile_to_response(db_session, profile, actor=current_user)


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

    return employee_profile_to_response(db_session, profile, actor=current_user)


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

    return employee_profile_to_response(db_session, profile, actor=current_user)
