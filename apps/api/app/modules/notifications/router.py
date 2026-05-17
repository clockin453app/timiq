import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import get_current_user, require_authenticated_employee
from app.modules.auth.models import User
from app.modules.notifications import repository as notification_repo
from app.modules.notifications.push_service import (
    public_vapid_key,
    web_push_configured,
)
from app.modules.notifications.schemas import (
    NotificationMarkAllSeenRequest,
    NotificationMarkAllSeenResponse,
    NotificationMarkSeenRequest,
    NotificationMarkSeenResponse,
    NotificationSummaryResponse,
    PushPublicKeyResponse,
    PushSubscriptionBody,
    PushSubscriptionResponse,
    PushTestResponse,
    PushUnsubscribeBody,
)
from app.modules.notifications.service import (
    get_notification_summary,
    mark_all_informational_seen,
    mark_notification_seen,
)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])
push_router = APIRouter(prefix="/api/push", tags=["push"])


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


@router.post("/mark-all-seen", response_model=NotificationMarkAllSeenResponse)
def post_notification_mark_all_seen(
    body: NotificationMarkAllSeenRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> NotificationMarkAllSeenResponse:
    try:
        mark_all_informational_seen(db_session, current_user, body)
        db_session.commit()
    except ValueError as exc:
        db_session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return NotificationMarkAllSeenResponse(ok=True)


@push_router.get("/public-key", response_model=PushPublicKeyResponse)
def read_push_public_key() -> PushPublicKeyResponse:
    key = public_vapid_key()
    return PushPublicKeyResponse(enabled=bool(key), public_key=key)


@push_router.post("/subscribe", response_model=PushSubscriptionResponse)
def subscribe_push(
    body: PushSubscriptionBody,
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee),
) -> PushSubscriptionResponse:
    session_id = getattr(request.state, "auth_session_id", None)
    if session_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session.")
    row = notification_repo.upsert_push_subscription(
        db_session,
        user_id=current_user.id,
        endpoint=body.endpoint,
        p256dh=body.keys.p256dh,
        auth=body.keys.auth,
        session_id=session_id,
        user_agent=body.user_agent,
        device_label=body.device_label,
    )
    db_session.commit()
    return PushSubscriptionResponse(ok=True, enabled=bool(row.is_active))


@push_router.post("/unsubscribe", response_model=PushSubscriptionResponse)
def unsubscribe_push(
    body: PushUnsubscribeBody,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee),
) -> PushSubscriptionResponse:
    notification_repo.deactivate_push_subscription(db_session, user_id=current_user.id, endpoint=body.endpoint)
    db_session.commit()
    return PushSubscriptionResponse(ok=True, enabled=False)


@push_router.post("/test", response_model=PushTestResponse)
def test_push(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee),
) -> PushTestResponse:
    if not web_push_configured():
        return PushTestResponse(ok=True, sent=0, enabled=False)
    subscriptions = notification_repo.list_active_push_subscriptions_for_user(db_session, user_id=current_user.id)
    if not subscriptions:
        return PushTestResponse(ok=True, sent=0, enabled=True)
    created = notification_repo.create_notification_record_once(
        db_session,
        recipient_user_id=current_user.id,
        company_id=current_user.company_id,
        kind="push_test",
        dedupe_key=f"push-test:{uuid.uuid4()}",
        title="TimIQ test notification",
        description="Push notifications are enabled on this device.",
        href="/settings",
        priority="normal",
        category="account",
    )
    db_session.commit()
    return PushTestResponse(ok=True, sent=len(subscriptions) if created else 0, enabled=True)
