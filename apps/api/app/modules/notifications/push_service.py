from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.core.config import settings
from app.modules.notifications import repository as notification_repo
from app.modules.notifications.models import PushSubscription

try:
    from pywebpush import WebPushException, webpush
except Exception:  # pragma: no cover - exercised only when dependency is missing.
    WebPushException = Exception
    webpush = None

@dataclass
class PushAttemptResult:
    success: bool
    status_code: int | None = None
    error: str | None = None


@dataclass
class PushDeliveryResult:
    sent: int = 0
    attempted: int = 0
    failures: list[PushAttemptResult] = field(default_factory=list)


PRIVATE_TEXT_MARKERS = (
    "storage",
    "face image",
    "gps",
    "latitude",
    "longitude",
    "payroll amount",
    "token",
    "secret",
)


def web_push_configured() -> bool:
    return (
        bool(settings.timiq_web_push_enabled)
        and bool(settings.timiq_web_push_vapid_public_key.strip())
        and bool(settings.timiq_web_push_vapid_private_key.strip())
        and webpush is not None
    )


def public_vapid_key() -> str:
    if not settings.timiq_web_push_enabled:
        return ""
    return settings.timiq_web_push_vapid_public_key.strip()


def _safe_path(raw: str) -> str:
    value = (raw or "/").strip() or "/"
    if value.startswith("http://") or value.startswith("https://") or value.startswith("//"):
        return "/"
    if not value.startswith("/"):
        return "/"
    return value[:300]


def _safe_text(raw: str, limit: int) -> str:
    value = " ".join((raw or "").split())[:limit]
    lowered = value.lower()
    if any(marker in lowered for marker in PRIVATE_TEXT_MARKERS):
        return "You have a new TimIQ notification."
    return value


def build_push_payload(
    *,
    notification_id: uuid.UUID | None,
    title: str,
    body: str,
    href: str,
    kind: str,
) -> dict[str, Any]:
    return {
        "title": _safe_text(title, 120) or "TimIQ notification",
        "body": _safe_text(body, 240) or "Open TimIQ to view details.",
        "url": _safe_path(href),
        "kind": kind[:64],
        "notification_id": str(notification_id) if notification_id is not None else "",
    }


def _subscription_info(row: PushSubscription) -> dict[str, Any]:
    return {
        "endpoint": row.endpoint,
        "keys": {
            "p256dh": row.p256dh,
            "auth": row.auth,
        },
    }


def _safe_webpush_error(exc: WebPushException) -> tuple[int | None, str]:
    status_code = getattr(getattr(exc, "response", None), "status_code", None)
    message = f"Web push HTTP {status_code}" if status_code is not None else "Web push delivery failed"
    try:
        response = exc.response
        if response is not None:
            body = (getattr(response, "text", "") or "").strip()[:160]
            lowered = body.lower()
            if body and "endpoint" not in lowered and "p256dh" not in lowered and "auth" not in lowered:
                message = f"{message}: {body}"
    except Exception:
        pass
    return status_code, message


def send_payload_to_subscription(db: Session, row: PushSubscription, payload: dict[str, Any]) -> PushAttemptResult:
    if not web_push_configured():
        return PushAttemptResult(success=False, error="Web push is not configured on the server.")
    try:
        webpush(
            subscription_info=_subscription_info(row),
            data=json.dumps(payload),
            vapid_private_key=settings.timiq_web_push_vapid_private_key.strip(),
            vapid_claims={"sub": settings.timiq_web_push_subject.strip() or "mailto:admin@example.com"},
        )
        return PushAttemptResult(success=True)
    except WebPushException as exc:
        status_code, message = _safe_webpush_error(exc)
        logger.warning(
            "web push delivery failed user_id=%s status_code=%s reason=%s",
            row.user_id,
            status_code,
            message,
        )
        if status_code in (404, 410):
            notification_repo.mark_push_subscription_inactive(db, row)
        return PushAttemptResult(success=False, status_code=status_code, error=message)
    except Exception as exc:
        message = "Web push delivery failed."
        logger.warning(
            "web push delivery failed user_id=%s reason=%s",
            row.user_id,
            exc.__class__.__name__,
        )
        return PushAttemptResult(success=False, error=message)


def send_push_for_notification_record(
    db: Session,
    *,
    notification_id: uuid.UUID | None,
    recipient_user_id: uuid.UUID,
    title: str,
    body: str,
    href: str,
    kind: str,
) -> PushDeliveryResult:
    result = PushDeliveryResult()
    if not web_push_configured():
        result.failures.append(PushAttemptResult(success=False, error="Web push is not configured on the server."))
        return result
    if not notification_repo.push_delivery_enabled_for_user(db, user_id=recipient_user_id):
        result.failures.append(PushAttemptResult(success=False, error="Push delivery is disabled by user or company settings."))
        return result
    payload = build_push_payload(
        notification_id=notification_id,
        title=title,
        body=body,
        href=href,
        kind=kind,
    )
    subscriptions = notification_repo.list_active_push_subscriptions_for_user(db, user_id=recipient_user_id)
    result.attempted = len(subscriptions)
    if result.attempted == 0:
        result.failures.append(
            PushAttemptResult(
                success=False,
                error="No deliverable push subscription for the current auth session.",
            ),
        )
        return result
    for sub in subscriptions:
        attempt = send_payload_to_subscription(db, sub, payload)
        if attempt.success:
            result.sent += 1
        else:
            result.failures.append(attempt)
    return result
