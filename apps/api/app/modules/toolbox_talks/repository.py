from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Select, and_, func, select
from sqlalchemy.orm import Session

from app.modules.toolbox_talks.models import ToolboxTalk, ToolboxTalkAttendee


def get_talk(db: Session, talk_id: uuid.UUID) -> ToolboxTalk | None:
    return db.get(ToolboxTalk, talk_id)


def get_attendee(db: Session, talk_id: uuid.UUID, user_id: uuid.UUID) -> ToolboxTalkAttendee | None:
    stmt = (
        select(ToolboxTalkAttendee)
        .where(ToolboxTalkAttendee.talk_id == talk_id)
        .where(ToolboxTalkAttendee.user_id == user_id)
    )
    return db.scalar(stmt)


def list_attendees_for_talk(db: Session, talk_id: uuid.UUID) -> list[ToolboxTalkAttendee]:
    stmt = (
        select(ToolboxTalkAttendee)
        .where(ToolboxTalkAttendee.talk_id == talk_id)
        .order_by(ToolboxTalkAttendee.created_at.asc())
    )
    return list(db.scalars(stmt).all())


def list_talks_for_admin(
    db: Session,
    *,
    company_id: uuid.UUID | None,
    status: str | None,
    location_id: uuid.UUID | None,
    date_from: date | None,
    date_to: date | None,
) -> list[ToolboxTalk]:
    stmt: Select[ToolboxTalk] = select(ToolboxTalk).order_by(ToolboxTalk.updated_at.desc())
    conditions = []
    if company_id is not None:
        conditions.append(ToolboxTalk.company_id == company_id)
    if status:
        conditions.append(ToolboxTalk.status == status)
    if location_id is not None:
        conditions.append(ToolboxTalk.location_id == location_id)
    if date_from is not None:
        conditions.append(ToolboxTalk.scheduled_date.isnot(None))
        conditions.append(ToolboxTalk.scheduled_date >= date_from)
    if date_to is not None:
        conditions.append(ToolboxTalk.scheduled_date.isnot(None))
        conditions.append(ToolboxTalk.scheduled_date <= date_to)
    if conditions:
        stmt = stmt.where(and_(*conditions))
    return list(db.scalars(stmt).all())


def list_talks_for_employee(db: Session, user_id: uuid.UUID) -> list[ToolboxTalk]:
    stmt = (
        select(ToolboxTalk)
        .join(ToolboxTalkAttendee, ToolboxTalkAttendee.talk_id == ToolboxTalk.id)
        .where(ToolboxTalkAttendee.user_id == user_id)
        .where(ToolboxTalk.status.in_(("published", "completed", "archived")))
        .order_by(ToolboxTalk.updated_at.desc())
    )
    return list(db.scalars(stmt).all())


def save_talk(db: Session, row: ToolboxTalk) -> ToolboxTalk:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def save_attendee(db: Session, row: ToolboxTalkAttendee) -> ToolboxTalkAttendee:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_attendee(db: Session, row: ToolboxTalkAttendee) -> None:
    db.delete(row)
    db.commit()


def count_pending_sign_for_user(db: Session, user_id: uuid.UUID) -> int:
    stmt = (
        select(func.count())
        .select_from(ToolboxTalkAttendee)
        .join(ToolboxTalk, ToolboxTalk.id == ToolboxTalkAttendee.talk_id)
        .where(ToolboxTalkAttendee.user_id == user_id)
        .where(ToolboxTalkAttendee.status == "pending")
        .where(ToolboxTalk.status == "published")
    )
    return int(db.scalar(stmt) or 0)


def count_talks_for_company_by_status(db: Session, company_id: uuid.UUID, talk_status: str) -> int:
    stmt = (
        select(func.count())
        .select_from(ToolboxTalk)
        .where(ToolboxTalk.company_id == company_id)
        .where(ToolboxTalk.status == talk_status)
    )
    return int(db.scalar(stmt) or 0)


def count_talks_by_status_global(db: Session, talk_status: str) -> int:
    stmt = select(func.count()).select_from(ToolboxTalk).where(ToolboxTalk.status == talk_status)
    return int(db.scalar(stmt) or 0)


def count_attendees_for_talk(db: Session, talk_id: uuid.UUID) -> int:
    stmt = select(ToolboxTalkAttendee).where(ToolboxTalkAttendee.talk_id == talk_id)
    return len(list(db.scalars(stmt).all()))


def count_signed_attendees_for_talk(db: Session, talk_id: uuid.UUID) -> int:
    stmt = (
        select(func.count())
        .select_from(ToolboxTalkAttendee)
        .where(ToolboxTalkAttendee.talk_id == talk_id)
        .where(ToolboxTalkAttendee.status == "signed")
    )
    return int(db.scalar(stmt) or 0)


def delete_talk_row(db: Session, talk: ToolboxTalk) -> None:
    db.delete(talk)
    db.commit()
