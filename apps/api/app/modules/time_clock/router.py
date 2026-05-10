import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.dependencies import get_current_user, require_admin_or_administrator
from app.modules.auth.models import SystemRole, User
from app.modules.time_clock.schemas import (
    BreakActionResponse,
    ClockActionResponse,
    ClockSelfieMetadataResponse,
    ClockSelfieReviewItemResponse,
    ClockStatusResponse,
)
from app.modules.time_clock.service import (
    ClockSelfieAccessDeniedError,
    ClockStateError,
    GeofenceValidationError,
    LocationAccessError,
    break_end,
    break_start,
    clock_in,
    clock_out,
    get_clock_status,
    list_clock_selfies_review_metadata,
    list_user_clock_selfies_metadata,
    parse_timestamp_utc,
    resolve_clock_selfie_file_path,
)

router = APIRouter(prefix="/api/time-clock", tags=["time-clock"])


NOT_FOUND_SELFIE_DETAIL = "Clock selfie not found."


@router.get("/status", response_model=ClockStatusResponse)
def get_time_clock_status(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> ClockStatusResponse:
    data = get_clock_status(db_session, current_user)
    return ClockStatusResponse(**data)


@router.get("/selfies/review", response_model=list[ClockSelfieReviewItemResponse])
def list_clock_selfies_review(
    limit: int | None = Query(default=None, ge=1),
    offset: int | None = Query(default=None, ge=0),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[ClockSelfieReviewItemResponse]:
    return list_clock_selfies_review_metadata(
        db_session,
        current_user,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/users/{user_id}/selfies",
    response_model=list[ClockSelfieMetadataResponse],
)
def list_clock_selfies_for_user(
    user_id: uuid.UUID,
    limit: int | None = Query(default=None, ge=1),
    offset: int | None = Query(default=None, ge=0),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[ClockSelfieMetadataResponse]:
    try:
        return list_user_clock_selfies_metadata(
            db_session,
            current_user,
            user_id,
            limit=limit,
            offset=offset,
        )
    except ClockSelfieAccessDeniedError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=NOT_FOUND_SELFIE_DETAIL,
        ) from None


@router.get("/selfies/{selfie_id}/file")
def download_clock_selfie_file(
    selfie_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> FileResponse:
    try:
        path, selfie, shift, owner = resolve_clock_selfie_file_path(
            db_session,
            current_user,
            selfie_id,
        )
    except ClockSelfieAccessDeniedError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=NOT_FOUND_SELFIE_DETAIL,
        ) from None

    if current_user.system_role in (
        SystemRole.ADMIN,
        SystemRole.ADMINISTRATOR,
    ) and current_user.id != owner.id:
        create_internal_audit_event(
            db_session=db_session,
            actor=current_user,
            action="clock_selfie_viewed",
            entity_type="clock_selfie",
            entity_id=str(selfie.id),
            company_id=owner.company_id,
            details={
                "time_shift_id": str(shift.id),
                "subject_user_id": str(owner.id),
            },
        )

    return FileResponse(
        path,
        media_type=selfie.content_type,
        filename=f"clock-selfie-{selfie.id}",
    )


@router.post("/clock-in", response_model=ClockActionResponse)
async def post_clock_in(
    latitude: float = Form(..., ge=-90, le=90),
    longitude: float = Form(..., ge=-180, le=180),
    accuracy_meters: float = Form(..., ge=0, le=5000),
    timestamp_utc: str = Form(...),
    selfie: UploadFile = File(...),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> ClockActionResponse:
    selfie_bytes = await selfie.read()
    try:
        timestamp = parse_timestamp_utc(timestamp_utc)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="timestamp_utc must be a valid ISO-8601 datetime.",
        ) from exc

    try:
        shift = clock_in(
            db_session=db_session,
            actor=current_user,
            latitude=latitude,
            longitude=longitude,
            accuracy_meters=accuracy_meters,
            timestamp_utc=timestamp,
            selfie_content_type=selfie.content_type or "application/octet-stream",
            selfie_bytes=selfie_bytes,
        )
    except (LocationAccessError, GeofenceValidationError, ClockStateError) as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return ClockActionResponse(shift_id=shift.id, status=shift.status)


@router.post("/clock-out", response_model=ClockActionResponse)
async def post_clock_out(
    latitude: float = Form(..., ge=-90, le=90),
    longitude: float = Form(..., ge=-180, le=180),
    accuracy_meters: float = Form(..., ge=0, le=5000),
    timestamp_utc: str = Form(...),
    selfie: UploadFile = File(...),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> ClockActionResponse:
    selfie_bytes = await selfie.read()
    try:
        timestamp = parse_timestamp_utc(timestamp_utc)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="timestamp_utc must be a valid ISO-8601 datetime.",
        ) from exc

    try:
        shift = clock_out(
            db_session=db_session,
            actor=current_user,
            latitude=latitude,
            longitude=longitude,
            accuracy_meters=accuracy_meters,
            timestamp_utc=timestamp,
            selfie_content_type=selfie.content_type or "application/octet-stream",
            selfie_bytes=selfie_bytes,
        )
    except (LocationAccessError, GeofenceValidationError, ClockStateError) as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return ClockActionResponse(
        shift_id=shift.id,
        status=shift.status,
        worked_seconds=shift.worked_seconds,
        break_seconds=shift.break_seconds,
    )


@router.post("/break-start", response_model=BreakActionResponse)
def post_break_start(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> BreakActionResponse:
    try:
        shift_break = break_start(db_session, current_user)
    except ClockStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return BreakActionResponse(
        shift_id=shift_break.time_shift_id,
        break_id=shift_break.id,
        status="break_open",
    )


@router.post("/break-end", response_model=BreakActionResponse)
def post_break_end(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> BreakActionResponse:
    try:
        shift_break = break_end(db_session, current_user)
    except ClockStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return BreakActionResponse(
        shift_id=shift_break.time_shift_id,
        break_id=shift_break.id,
        status="break_closed",
    )
