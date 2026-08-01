"""HTTP API for payable timesheet hours adjustments."""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import get_current_user, require_admin_or_administrator
from app.modules.auth.models import User
from app.modules.timesheet_extra_hours.schemas import (
    TimesheetExtraHoursCreate,
    TimesheetExtraHoursPatch,
    TimesheetExtraHoursResponse,
)
from app.modules.timesheet_extra_hours.service import (
    ExtraHoursError,
    ExtraHoursPermissionError,
    create_extra_hours,
    delete_extra_hours,
    list_extra_hours_for_admin,
    list_extra_hours_for_me,
    patch_extra_hours,
)

router = APIRouter(prefix="/api/timesheet-extra-hours", tags=["timesheet-extra-hours"])


def _http(exc: Exception) -> HTTPException:
    if isinstance(exc, ExtraHoursPermissionError):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    if isinstance(exc, ExtraHoursError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Extra hours error.")


@router.post("", response_model=TimesheetExtraHoursResponse, status_code=status.HTTP_201_CREATED)
def create_entry(
    body: TimesheetExtraHoursCreate,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> TimesheetExtraHoursResponse:
    try:
        return create_extra_hours(db_session, current_user, body)
    except (ExtraHoursError, ExtraHoursPermissionError) as exc:
        raise _http(exc) from exc


@router.get("", response_model=list[TimesheetExtraHoursResponse])
def list_entries(
    company_id: uuid.UUID | None = Query(default=None),
    user_id: uuid.UUID | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    location_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[TimesheetExtraHoursResponse]:
    try:
        return list_extra_hours_for_admin(
            db_session,
            current_user,
            company_id=company_id,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            location_id=location_id,
        )
    except (ExtraHoursError, ExtraHoursPermissionError) as exc:
        raise _http(exc) from exc


@router.get("/me", response_model=list[TimesheetExtraHoursResponse])
def list_my_entries(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> list[TimesheetExtraHoursResponse]:
    try:
        return list_extra_hours_for_me(
            db_session,
            current_user,
            start_date=start_date,
            end_date=end_date,
        )
    except (ExtraHoursError, ExtraHoursPermissionError) as exc:
        raise _http(exc) from exc


@router.patch("/{entry_id}", response_model=TimesheetExtraHoursResponse)
def patch_entry(
    entry_id: uuid.UUID,
    body: TimesheetExtraHoursPatch,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> TimesheetExtraHoursResponse:
    try:
        return patch_extra_hours(db_session, current_user, entry_id, body)
    except (ExtraHoursError, ExtraHoursPermissionError) as exc:
        raise _http(exc) from exc


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_entry(
    entry_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    try:
        delete_extra_hours(db_session, current_user, entry_id)
    except (ExtraHoursError, ExtraHoursPermissionError) as exc:
        raise _http(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
