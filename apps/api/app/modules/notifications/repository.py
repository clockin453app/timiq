from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.modules.notifications.models import NotificationRecord, NotificationSeen


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
    return db.scalar(stmt) is not None


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
