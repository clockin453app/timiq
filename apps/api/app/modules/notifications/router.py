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
    PushFailureDetail,
    PushPublicKeyResponse,
    PushStatusResponse,
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


@push_router.get("/status", response_model=PushStatusResponse)
def read_push_status(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee),
) -> PushStatusResponse:
    configured = web_push_configured()
    counts = notification_repo.push_subscription_counts_for_user(db_session, user_id=current_user.id)
    return PushStatusResponse(
        configured=configured,
        push_delivery_enabled=notification_repo.push_delivery_enabled_for_user(db_session, user_id=current_user.id),
        active_subscriptions=counts.active,
        deliverable_subscriptions=counts.deliverable,
    )


def _push_failure_details(push_failures: list[tuple[int | None, str]] | None) -> list[PushFailureDetail]:
    if not push_failures:
        return []
    return [
        PushFailureDetail(status_code=status_code, error=error)
        for status_code, error in push_failures
    ]


def _push_failure_summary(
    *,
    configured: bool,
    push_delivery_enabled: bool,
    active_subscriptions: int,
    deliverable_subscriptions: int,
    notification_record_created: bool,
    sent: int,
    failures: list[PushFailureDetail],
) -> str | None:
    if not configured:
        return "Web push is not configured on the server."
    if not push_delivery_enabled:
        return "Push delivery is disabled by user or company notification settings."
    if active_subscriptions == 0:
        return "No active push subscription is stored for this account."
    if deliverable_subscriptions == 0:
        return "Push subscription exists but is not bound to the current login session. Open TimIQ again or re-enable push."
    if not notification_record_created:
        return "Test notification record was not created."
    if sent > 0:
        return None
    if failures:
        return failures[0].error or "Web push delivery failed."
    return "Web push delivery failed."


@push_router.post("/test", response_model=PushTestResponse)
def test_push(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee),
) -> PushTestResponse:
    configured = web_push_configured()
    push_delivery_enabled = notification_repo.push_delivery_enabled_for_user(db_session, user_id=current_user.id)
    counts = notification_repo.push_subscription_counts_for_user(db_session, user_id=current_user.id)
    if not configured:
        return PushTestResponse(
            ok=True,
            sent=0,
            enabled=False,
            configured=False,
            push_delivery_enabled=push_delivery_enabled,
            active_subscriptions=counts.active,
            deliverable_subscriptions=counts.deliverable,
            test_push_sent=False,
            failure_summary="Web push is not configured on the server.",
        )

    created = notification_repo.create_notification_record_once_detailed(
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
    failures = _push_failure_details(created.push_failures)
    sent = created.push_sent
    return PushTestResponse(
        ok=True,
        sent=sent,
        enabled=True,
        configured=True,
        push_delivery_enabled=push_delivery_enabled,
        notification_record_created=created.created,
        active_subscriptions=counts.active,
        deliverable_subscriptions=counts.deliverable,
        attempted=created.push_attempted,
        test_push_sent=sent > 0,
        failures=failures,
        failure_summary=_push_failure_summary(
            configured=True,
            push_delivery_enabled=push_delivery_enabled,
            active_subscriptions=counts.active,
            deliverable_subscriptions=counts.deliverable,
            notification_record_created=created.created,
            sent=sent,
            failures=failures,
        ),
    )
