import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import get_current_user, require_admin_or_administrator
from app.modules.auth.models import User
from app.modules.time_records.schemas import TimeRecordShiftRow, TimesheetWeekResponse
from app.modules.time_records.service import (
    TimeRecordsPermissionError,
    list_time_records_admin,
    list_time_records_me,
    timesheet_week_for_user,
)

time_records_router = APIRouter(prefix="/api/time-records", tags=["time-records"])
timesheets_router = APIRouter(prefix="/api/timesheets", tags=["timesheets"])


def _opt_date(raw: str | None) -> date | None:
    if raw is None or raw.strip() == "":
        return None
    return date.fromisoformat(raw.strip())


def _status_filter(raw: str | None) -> str | None:
    if raw is None or raw.strip() == "":
        return None
    cleaned = raw.strip().lower()
    if cleaned not in ("open", "completed"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="status must be open or completed.",
        )
    return cleaned


@time_records_router.get("/me", response_model=list[TimeRecordShiftRow])
def read_my_time_records(
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    location_id: uuid.UUID | None = None,
    status: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1),
    offset: int | None = Query(default=None, ge=0),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> list[TimeRecordShiftRow]:
    try:
        return list_time_records_me(
            db_session,
            current_user,
            start_date=_opt_date(start_date),
            end_date_exclusive=_opt_date(end_date),
            location_id=location_id,
            status=_status_filter(status),
            limit=limit,
            offset=offset,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@time_records_router.get("/admin", response_model=list[TimeRecordShiftRow])
def read_admin_time_records(
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    location_id: uuid.UUID | None = None,
    status: str | None = Query(default=None),
    user_id: uuid.UUID | None = None,
    company_id: uuid.UUID | None = None,
    limit: int | None = Query(default=None, ge=1),
    offset: int | None = Query(default=None, ge=0),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[TimeRecordShiftRow]:
    try:
        return list_time_records_admin(
            db_session,
            current_user,
            start_date=_opt_date(start_date),
            end_date_exclusive=_opt_date(end_date),
            location_id=location_id,
            status=_status_filter(status),
            user_id=user_id,
            company_id=company_id,
            limit=limit,
            offset=offset,
        )
    except TimeRecordsPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@timesheets_router.get("/me/week", response_model=TimesheetWeekResponse)
def read_my_timesheet_week(
    week_start: str = Query(..., description="Monday local date for the company policy timezone (YYYY-MM-DD)."),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> TimesheetWeekResponse:
    try:
        parsed = _opt_date(week_start)
        if parsed is None:
            raise ValueError("week_start is required.")
        return timesheet_week_for_user(
            db_session,
            current_user,
            subject_user_id=current_user.id,
            week_start=parsed,
        )
    except TimeRecordsPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@timesheets_router.get("/admin/week", response_model=TimesheetWeekResponse)
def read_admin_timesheet_week(
    week_start: str = Query(...),
    user_id: uuid.UUID = Query(...),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> TimesheetWeekResponse:
    try:
        parsed = _opt_date(week_start)
        if parsed is None:
            raise ValueError("week_start is required.")
        return timesheet_week_for_user(
            db_session,
            current_user,
            subject_user_id=user_id,
            week_start=parsed,
        )
    except TimeRecordsPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
