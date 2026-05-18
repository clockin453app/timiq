from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.modules.auth.models import User
from app.modules.notifications.models import NotificationRecord, NotificationSeen, PushSubscription
from app.modules.settings.models import CompanyAppSettings, UserPreference


def has_seen(db: Session, *, user_id: uuid.UUID, kind: str, target_key: str) -> bool:
    stmt = select(NotificationSeen.id).where(
        NotificationSeen.user_id == user_id,
        NotificationSeen.kind == kind,
        NotificationSeen.target_key == target_key,
    )
    return db.scalar(stmt) is not None


def upsert_seen(db: Session, *, user_id: uuid.UUID, kind: str, target_key: str, seen_at: datetime | None = None) -> None:
    when = seen_at or datetime.now(timezone.utc)
    stmt = (
        insert(NotificationSeen)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            kind=kind,
            target_key=target_key,
            seen_at=when,
            created_at=when,
        )
        .on_conflict_do_update(
            constraint="uq_notification_seen_user_kind_target",
            set_={"seen_at": when},
        )
    )
    db.execute(stmt)


def create_notification_record_once(
    db: Session,
    *,
    recipient_user_id: uuid.UUID,
    company_id: uuid.UUID | None,
    kind: str,
    dedupe_key: str,
    title: str,
    description: str,
    href: str,
    priority: str = "normal",
    category: str = "admin",
    source_rule_type: str | None = None,
    subject_user_id: uuid.UUID | None = None,
    shift_id: uuid.UUID | None = None,
    work_date: date | None = None,
    created_at: datetime | None = None,
) -> bool:
    when = created_at or datetime.now(timezone.utc)
    stmt = (
        insert(NotificationRecord)
        .values(
            id=uuid.uuid4(),
            recipient_user_id=recipient_user_id,
            company_id=company_id,
            kind=kind,
            dedupe_key=dedupe_key[:512],
            title=title[:160],
            description=description[:500],
            href=href[:300],
            priority=priority,
            category=category,
            source_rule_type=source_rule_type,
            subject_user_id=subject_user_id,
            shift_id=shift_id,
            work_date=work_date,
            created_at=when,
        )
        .on_conflict_do_nothing(constraint="uq_notification_records_recipient_kind_dedupe")
        .returning(NotificationRecord.id)
    )
    record_id = db.scalar(stmt)
    if record_id is None:
        return False
    try:
        from app.modules.notifications.push_service import send_push_for_notification_record

        send_push_for_notification_record(
            db,
            notification_id=record_id,
            recipient_user_id=recipient_user_id,
            title=title,
            body=description,
            href=href,
            kind=kind,
        )
    except Exception:
        # Push must never break notification creation or attendance jobs.
        pass
    return True


def list_unseen_records_for_user(
    db: Session,
    *,
    user_id: uuid.UUID,
    company_id: uuid.UUID | None = None,
) -> list[NotificationRecord]:
    stmt = (
        select(NotificationRecord)
        .where(NotificationRecord.recipient_user_id == user_id)
        .where(NotificationRecord.seen_at.is_(None))
        .order_by(NotificationRecord.created_at.desc())
    )
    if company_id is not None:
        stmt = stmt.where(NotificationRecord.company_id == company_id)
    return list(db.scalars(stmt).all())


def mark_record_seen(
    db: Session,
    *,
    user_id: uuid.UUID,
    kind: str,
    dedupe_key: str,
    seen_at: datetime | None = None,
) -> None:
    when = seen_at or datetime.now(timezone.utc)
    stmt = (
        update(NotificationRecord)
        .where(NotificationRecord.recipient_user_id == user_id)
        .where(NotificationRecord.kind == kind)
        .where(NotificationRecord.dedupe_key == dedupe_key)
        .where(NotificationRecord.seen_at.is_(None))
        .values(seen_at=when)
    )
    db.execute(stmt)


def mark_all_records_seen_for_user(
    db: Session,
    *,
    user_id: uuid.UUID,
    company_id: uuid.UUID | None = None,
    seen_at: datetime | None = None,
) -> None:
    when = seen_at or datetime.now(timezone.utc)
    stmt = (
        update(NotificationRecord)
        .where(NotificationRecord.recipient_user_id == user_id)
        .where(NotificationRecord.seen_at.is_(None))
    )
    if company_id is not None:
        stmt = stmt.where(NotificationRecord.company_id == company_id)
    db.execute(stmt.values(seen_at=when))


def get_push_subscription_by_user_endpoint(
    db: Session,
    *,
    user_id: uuid.UUID,
    endpoint: str,
) -> PushSubscription | None:
    stmt = select(PushSubscription).where(
        PushSubscription.user_id == user_id,
        PushSubscription.endpoint == endpoint,
    )
    return db.scalar(stmt)


def upsert_push_subscription(
    db: Session,
    *,
    user_id: uuid.UUID,
    endpoint: str,
    p256dh: str,
    auth: str,
    session_id: uuid.UUID,
    user_agent: str | None,
    device_label: str | None,
) -> PushSubscription:
    now = datetime.now(timezone.utc)
    row = get_push_subscription_by_user_endpoint(db, user_id=user_id, endpoint=endpoint)
    if row is None:
        row = PushSubscription(
            user_id=user_id,
            endpoint=endpoint,
            p256dh=p256dh,
            auth=auth,
            session_id=session_id,
            user_agent=user_agent,
            device_label=device_label,
            is_active=True,
            created_at=now,
            updated_at=now,
            last_seen_at=now,
            revoked_at=None,
        )
        db.add(row)
    else:
        row.p256dh = p256dh
        row.auth = auth
        row.session_id = session_id
        row.user_agent = user_agent
        row.device_label = device_label
        row.is_active = True
        row.updated_at = now
        row.last_seen_at = now
        row.revoked_at = None
    db.flush()
    db.refresh(row)
    return row


def deactivate_push_subscription(
    db: Session,
    *,
    user_id: uuid.UUID,
    endpoint: str,
) -> bool:
    row = get_push_subscription_by_user_endpoint(db, user_id=user_id, endpoint=endpoint)
    if row is None:
        return False
    now = datetime.now(timezone.utc)
    row.is_active = False
    row.updated_at = now
    row.revoked_at = now
    db.flush()
    return True


def list_active_push_subscriptions_for_user(
    db: Session,
    *,
    user_id: uuid.UUID,
) -> list[PushSubscription]:
    stmt = (
        select(PushSubscription)
        .join(User, User.id == PushSubscription.user_id)
        .where(PushSubscription.user_id == user_id)
        .where(PushSubscription.is_active.is_(True))
        .where(PushSubscription.session_id == User.active_session_id)
        .order_by(PushSubscription.updated_at.desc())
    )
    return list(db.scalars(stmt).all())


def push_delivery_enabled_for_user(
    db: Session,
    *,
    user_id: uuid.UUID,
) -> bool:
    user = db.get(User, user_id)
    if user is None:
        return False

    pref = db.scalar(select(UserPreference).where(UserPreference.user_id == user_id))
    user_push_enabled = True if pref is None else bool(pref.push_notifications_enabled)
    if not user_push_enabled:
        return False

    if user.company_id is None:
        return True

    company_settings = db.scalar(
        select(CompanyAppSettings).where(CompanyAppSettings.company_id == user.company_id),
    )
    if company_settings is None:
        return True
    return bool(company_settings.notifications_enabled) and bool(company_settings.push_notifications_enabled)


def mark_push_subscription_inactive(
    db: Session,
    subscription: PushSubscription,
) -> None:
    now = datetime.now(timezone.utc)
    subscription.is_active = False
    subscription.updated_at = now
    subscription.revoked_at = now
    db.flush()
