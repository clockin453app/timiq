from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.notifications import repository as notification_repo
from app.modules.notifications.models import PushSubscription

try:
    from pywebpush import WebPushException, webpush
except Exception:  # pragma: no cover - exercised only when dependency is missing.
    WebPushException = Exception
    webpush = None

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


def send_payload_to_subscription(db: Session, row: PushSubscription, payload: dict[str, Any]) -> bool:
    if not web_push_configured():
        return False
    try:
        webpush(
            subscription_info=_subscription_info(row),
            data=json.dumps(payload),
            vapid_private_key=settings.timiq_web_push_vapid_private_key.strip(),
            vapid_claims={"sub": settings.timiq_web_push_subject.strip() or "mailto:admin@example.com"},
        )
        return True
    except WebPushException as exc:
        status_code = getattr(getattr(exc, "response", None), "status_code", None)
        if status_code in (404, 410):
            notification_repo.mark_push_subscription_inactive(db, row)
        return False
    except Exception:
        return False


def send_push_for_notification_record(
    db: Session,
    *,
    notification_id: uuid.UUID | None,
    recipient_user_id: uuid.UUID,
    title: str,
    body: str,
    href: str,
    kind: str,
) -> int:
    if not web_push_configured():
        return 0
    payload = build_push_payload(
        notification_id=notification_id,
        title=title,
        body=body,
        href=href,
        kind=kind,
    )
    sent = 0
    for sub in notification_repo.list_active_push_subscriptions_for_user(db, user_id=recipient_user_id):
        if send_payload_to_subscription(db, sub, payload):
            sent += 1
    return sent
