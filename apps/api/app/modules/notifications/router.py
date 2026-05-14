import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.notifications.schemas import (
    NotificationMarkSeenRequest,
    NotificationMarkSeenResponse,
    NotificationSummaryResponse,
)
from app.modules.notifications.service import get_notification_summary, mark_notification_seen

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("/summary", response_model=NotificationSummaryResponse)
def read_notification_summary(
    company_id: uuid.UUID | None = Query(
        default=None,
        description="Administrator: scope company-specific review counts (optional).",
    ),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> NotificationSummaryResponse:
    return get_notification_summary(db_session, current_user, company_id=company_id)


@router.post("/mark-seen", response_model=NotificationMarkSeenResponse)
def post_notification_mark_seen(
    body: NotificationMarkSeenRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> NotificationMarkSeenResponse:
    try:
        mark_notification_seen(db_session, current_user, body)
        db_session.commit()
    except ValueError as exc:
        db_session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return NotificationMarkSeenResponse(ok=True)
