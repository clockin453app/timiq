from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.time_clock.schemas import (
    BreakActionResponse,
    ClockActionResponse,
    ClockStatusResponse,
)
from app.modules.time_clock.service import (
    ClockStateError,
    GeofenceValidationError,
    LocationAccessError,
    break_end,
    break_start,
    clock_in,
    clock_out,
    get_clock_status,
    parse_timestamp_utc,
)

router = APIRouter(prefix="/api/time-clock", tags=["time-clock"])


@router.get("/status", response_model=ClockStatusResponse)
def get_time_clock_status(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> ClockStatusResponse:
    data = get_clock_status(db_session, current_user)
    return ClockStatusResponse(**data)


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
