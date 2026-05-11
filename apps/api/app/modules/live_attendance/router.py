import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import require_admin_or_administrator
from app.modules.auth.models import SystemRole, User

from .permissions import LiveAttendancePermissionError
from .schemas import (
    LiveAttendanceResponse,
    ManualClockActionResponse,
    ManualClockInRequest,
    ManualClockOutRequest,
)
from .service import (
    LiveAttendanceError,
    get_live_attendance_snapshot,
    manual_clock_in,
    manual_clock_out,
)

router = APIRouter(prefix="/api/live-attendance", tags=["live-attendance"])


def _handle_live_exc(exc: Exception) -> HTTPException:
    if isinstance(exc, LiveAttendancePermissionError):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    if isinstance(exc, LiveAttendanceError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Live attendance error.")


@router.get("", response_model=LiveAttendanceResponse)
def read_live_attendance(
    company_id: uuid.UUID | None = Query(default=None),
    location_id: uuid.UUID | None = Query(default=None),
    search: str | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> LiveAttendanceResponse:
    if current_user.system_role != SystemRole.ADMINISTRATOR and company_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="company_id filter is only valid for administrators.",
        )
    try:
        data = get_live_attendance_snapshot(
            db_session,
            current_user,
            company_id=company_id,
            location_id=location_id,
            search=search,
        )
        return LiveAttendanceResponse.model_validate(data)
    except LiveAttendancePermissionError as exc:
        raise _handle_live_exc(exc) from exc
    except LiveAttendanceError as exc:
        raise _handle_live_exc(exc) from exc


@router.post("/manual-clock-in", response_model=ManualClockActionResponse)
def post_manual_clock_in(
    body: ManualClockInRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> ManualClockActionResponse:
    try:
        shift = manual_clock_in(
            db_session,
            current_user,
            user_id=body.user_id,
            location_id=body.location_id,
            reason=body.reason,
        )
        return ManualClockActionResponse(
            shift_id=shift.id,
            status=shift.status,
            clock_in_at=shift.clock_in_at,
            clock_out_at=shift.clock_out_at,
            worked_seconds=shift.worked_seconds,
        )
    except LiveAttendancePermissionError as exc:
        raise _handle_live_exc(exc) from exc
    except LiveAttendanceError as exc:
        raise _handle_live_exc(exc) from exc


@router.post("/manual-clock-out", response_model=ManualClockActionResponse)
def post_manual_clock_out(
    body: ManualClockOutRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> ManualClockActionResponse:
    try:
        shift = manual_clock_out(
            db_session,
            current_user,
            user_id=body.user_id,
            shift_id=body.shift_id,
            reason=body.reason,
        )
        return ManualClockActionResponse(
            shift_id=shift.id,
            status=shift.status,
            clock_in_at=shift.clock_in_at,
            clock_out_at=shift.clock_out_at,
            worked_seconds=shift.worked_seconds,
        )
    except LiveAttendancePermissionError as exc:
        raise _handle_live_exc(exc) from exc
    except LiveAttendanceError as exc:
        raise _handle_live_exc(exc) from exc
