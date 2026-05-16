from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.attendance_notifications.schemas import (
    AttendanceNotificationSettingsPatchRequest,
    AttendanceNotificationSettingsResponse,
)
from app.modules.attendance_notifications.service import (
    AttendanceNotificationNotFoundError,
    AttendanceNotificationPermissionError,
    get_attendance_notification_settings,
    patch_attendance_notification_settings,
)
from app.modules.auth.dependencies import require_admin_or_administrator
from app.modules.auth.models import User

router = APIRouter(prefix="/api/attendance-notification-settings", tags=["attendance-notification-settings"])


def _attendance_settings_http(exc: AttendanceNotificationPermissionError) -> HTTPException:
    msg = str(exc)
    code = status.HTTP_400_BAD_REQUEST if "required for administrators" in msg else status.HTTP_403_FORBIDDEN
    return HTTPException(status_code=code, detail=msg)


@router.get("", response_model=AttendanceNotificationSettingsResponse)
def read_attendance_notification_settings(
    company_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> AttendanceNotificationSettingsResponse:
    try:
        return get_attendance_notification_settings(db_session, current_user, company_id=company_id)
    except AttendanceNotificationPermissionError as exc:
        raise _attendance_settings_http(exc) from exc
    except AttendanceNotificationNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("", response_model=AttendanceNotificationSettingsResponse)
def update_attendance_notification_settings(
    body: AttendanceNotificationSettingsPatchRequest,
    company_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> AttendanceNotificationSettingsResponse:
    try:
        response = patch_attendance_notification_settings(
            db_session,
            current_user,
            company_id=company_id,
            body=body,
        )
        db_session.commit()
        return response
    except AttendanceNotificationPermissionError as exc:
        db_session.rollback()
        raise _attendance_settings_http(exc) from exc
    except AttendanceNotificationNotFoundError as exc:
        db_session.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
