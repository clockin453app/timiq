from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Select, and_, false, func, or_, select, update
from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.messaging.models import (
    Announcement,
    AnnouncementRead,
    Conversation,
    ConversationParticipant,
    Message,
)


def get_announcement(db_session: Session, announcement_id: uuid.UUID) -> Announcement | None:
    return db_session.get(Announcement, announcement_id)


def save_announcement(db_session: Session, row: Announcement) -> Announcement:
    db_session.add(row)
    db_session.flush()
    return row


def count_announcement_reads(db_session: Session, announcement_id: uuid.UUID) -> int:
    stmt = select(func.count()).select_from(AnnouncementRead).where(AnnouncementRead.announcement_id == announcement_id)
    return int(db_session.scalar(stmt) or 0)


def list_announcement_reads(db_session: Session, announcement_id: uuid.UUID, limit: int) -> list[AnnouncementRead]:
    stmt = (
        select(AnnouncementRead)
        .where(AnnouncementRead.announcement_id == announcement_id)
        .order_by(AnnouncementRead.read_at.desc())
        .limit(limit)
    )
    return list(db_session.scalars(stmt).unique().all())


def get_announcement_read_for_user(
    db_session: Session,
    *,
    announcement_id: uuid.UUID,
    user_id: uuid.UUID,
) -> AnnouncementRead | None:
    stmt = select(AnnouncementRead).where(
        AnnouncementRead.announcement_id == announcement_id,
        AnnouncementRead.user_id == user_id,
    )
    return db_session.scalar(stmt)


def upsert_announcement_read(
    db_session: Session,
    *,
    announcement_id: uuid.UUID,
    user_id: uuid.UUID,
    read_at: datetime,
) -> AnnouncementRead:
    existing = get_announcement_read_for_user(db_session, announcement_id=announcement_id, user_id=user_id)
    if existing is not None:
        existing.read_at = read_at
        db_session.flush()
        return existing
    row = AnnouncementRead(
        announcement_id=announcement_id,
        user_id=user_id,
        read_at=read_at,
    )
    db_session.add(row)
    db_session.flush()
    return row


def get_conversation(db_session: Session, conversation_id: uuid.UUID) -> Conversation | None:
    return db_session.get(Conversation, conversation_id)


def save_conversation(db_session: Session, row: Conversation) -> Conversation:
    db_session.add(row)
    db_session.flush()
    return row


def touch_conversation_updated(db_session: Session, conversation_id: uuid.UUID, when: datetime) -> None:
    stmt = update(Conversation).where(Conversation.id == conversation_id).values(updated_at=when)
    db_session.execute(stmt)


def add_participant(db_session: Session, row: ConversationParticipant) -> ConversationParticipant:
    db_session.add(row)
    db_session.flush()
    return row


def get_participant(
    db_session: Session,
    *,
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
) -> ConversationParticipant | None:
    stmt = select(ConversationParticipant).where(
        ConversationParticipant.conversation_id == conversation_id,
        ConversationParticipant.user_id == user_id,
    )
    return db_session.scalar(stmt)


def list_participants_for_conversation(db_session: Session, conversation_id: uuid.UUID) -> list[ConversationParticipant]:
    stmt = select(ConversationParticipant).where(ConversationParticipant.conversation_id == conversation_id)
    return list(db_session.scalars(stmt).unique().all())


def list_conversation_ids_for_user(db_session: Session, user_id: uuid.UUID) -> list[uuid.UUID]:
    stmt = select(ConversationParticipant.conversation_id).where(ConversationParticipant.user_id == user_id)
    return list(db_session.scalars(stmt).all())


def list_conversations_for_user(
    db_session: Session,
    *,
    user_id: uuid.UUID,
    limit: int,
    offset: int,
) -> list[Conversation]:
    subq = (
        select(ConversationParticipant.conversation_id)
        .where(ConversationParticipant.user_id == user_id)
        .scalar_subquery()
    )
    stmt: Select[tuple[Conversation]] = (
        select(Conversation)
        .where(Conversation.id.in_(subq))
        .order_by(Conversation.updated_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(db_session.scalars(stmt).unique().all())


def save_message(db_session: Session, row: Message) -> Message:
    db_session.add(row)
    db_session.flush()
    return row


def list_messages_for_conversation(
    db_session: Session,
    *,
    conversation_id: uuid.UUID,
    limit: int,
    offset: int,
) -> list[Message]:
    stmt = (
        select(Message)
        .where(
            Message.conversation_id == conversation_id,
            Message.deleted_at.is_(None),
        )
        .order_by(Message.created_at.asc())
        .limit(limit)
        .offset(offset)
    )
    return list(db_session.scalars(stmt).unique().all())


def get_last_message(db_session: Session, conversation_id: uuid.UUID) -> Message | None:
    stmt = (
        select(Message)
        .where(
            Message.conversation_id == conversation_id,
            Message.deleted_at.is_(None),
        )
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    return db_session.scalar(stmt)


def _announcement_visibility_clause(actor: User, company_filter: uuid.UUID | None):
    parts = []
    if actor.company_id is not None:
        parts.append(
            and_(Announcement.audience_type == "company", Announcement.company_id == actor.company_id),
        )
        parts.append(Announcement.audience_type == "all_companies")
    if actor.system_role == SystemRole.ADMINISTRATOR:
        parts.append(Announcement.audience_type == "administrators")
        parts.append(Announcement.audience_type == "all_companies")
        if company_filter is not None:
            parts.append(
                and_(Announcement.audience_type == "company", Announcement.company_id == company_filter),
            )
    if not parts:
        return false()
    return or_(*parts)


def _draft_manageable_clause(actor: User, company_filter: uuid.UUID | None):
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            return false()
        return and_(
            Announcement.published_at.is_(None),
            Announcement.audience_type == "company",
            Announcement.company_id == actor.company_id,
        )
    if actor.system_role == SystemRole.ADMINISTRATOR:
        if company_filter is None:
            return false()
        return and_(
            Announcement.published_at.is_(None),
            Announcement.audience_type == "company",
            Announcement.company_id == company_filter,
        )
    return false()


def list_announcements_visible(
    db_session: Session,
    *,
    actor: User,
    company_filter: uuid.UUID | None,
    now: datetime,
    include_drafts: bool,
    limit: int,
    offset: int,
) -> list[Announcement]:
    vis = _announcement_visibility_clause(actor, company_filter)
    active = Announcement.is_active.is_(True)
    not_expired = or_(Announcement.expires_at.is_(None), Announcement.expires_at > now)
    published_live = and_(Announcement.published_at.isnot(None), Announcement.published_at <= now)
    if include_drafts and actor.system_role in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        draft = _draft_manageable_clause(actor, company_filter)
        where = and_(active, not_expired, vis, or_(published_live, draft))
    else:
        where = and_(active, not_expired, vis, published_live)
    stmt = (
        select(Announcement)
        .where(where)
        .order_by(Announcement.published_at.desc().nulls_last(), Announcement.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(db_session.scalars(stmt).unique().all())


def count_unread_visible_announcements(
    db_session: Session,
    *,
    actor: User,
    company_filter: uuid.UUID | None,
    now: datetime,
) -> int:
    """Published announcements visible to the actor with no AnnouncementRead row."""
    vis = _announcement_visibility_clause(actor, company_filter)
    active = Announcement.is_active.is_(True)
    not_expired = or_(Announcement.expires_at.is_(None), Announcement.expires_at > now)
    published_live = and_(Announcement.published_at.isnot(None), Announcement.published_at <= now)
    where = and_(active, not_expired, vis, published_live)
    stmt = (
        select(func.count())
        .select_from(Announcement)
        .outerjoin(
            AnnouncementRead,
            and_(
                AnnouncementRead.announcement_id == Announcement.id,
                AnnouncementRead.user_id == actor.id,
            ),
        )
        .where(where)
        .where(AnnouncementRead.id.is_(None))
    )
    return int(db_session.scalar(stmt) or 0)


def list_unread_visible_announcement_ids(
    db_session: Session,
    *,
    actor: User,
    company_filter: uuid.UUID | None,
    now: datetime,
) -> list[uuid.UUID]:
    """Published announcements visible to the actor with no AnnouncementRead row."""
    vis = _announcement_visibility_clause(actor, company_filter)
    active = Announcement.is_active.is_(True)
    not_expired = or_(Announcement.expires_at.is_(None), Announcement.expires_at > now)
    published_live = and_(Announcement.published_at.isnot(None), Announcement.published_at <= now)
    where = and_(active, not_expired, vis, published_live)
    stmt = (
        select(Announcement.id)
        .outerjoin(
            AnnouncementRead,
            and_(
                AnnouncementRead.announcement_id == Announcement.id,
                AnnouncementRead.user_id == actor.id,
            ),
        )
        .where(where)
        .where(AnnouncementRead.id.is_(None))
    )
    return list(db_session.scalars(stmt).unique().all())


def count_conversations_with_unread_incoming(
    db_session: Session,
    *,
    user_id: uuid.UUID,
) -> int:
    """Conversations where an incoming message exists after last_read_at (or last_read is null)."""
    sub_exists = (
        select(1)
        .select_from(Message)
        .where(
            Message.conversation_id == ConversationParticipant.conversation_id,
            Message.deleted_at.is_(None),
            Message.sender_user_id != user_id,
            or_(
                ConversationParticipant.last_read_at.is_(None),
                Message.created_at > ConversationParticipant.last_read_at,
            ),
        )
        .exists()
    )
    stmt = (
        select(func.count())
        .select_from(ConversationParticipant)
        .where(ConversationParticipant.user_id == user_id)
        .where(sub_exists)
    )
    return int(db_session.scalar(stmt) or 0)


def count_unread_incoming_in_conversation(
    db_session: Session,
    *,
    conversation_id: uuid.UUID,
    user_id: uuid.UUID,
) -> int:
    cp = get_participant(db_session, conversation_id=conversation_id, user_id=user_id)
    if cp is None:
        return 0
    clauses = [
        Message.conversation_id == conversation_id,
        Message.deleted_at.is_(None),
        Message.sender_user_id != user_id,
    ]
    if cp.last_read_at is None:
        where = and_(*clauses)
    else:
        where = and_(*clauses, Message.created_at > cp.last_read_at)
    stmt = select(func.count()).select_from(Message).where(where)
    return int(db_session.scalar(stmt) or 0)


def list_conversation_ids_with_unread_ordered(
    db_session: Session,
    *,
    user_id: uuid.UUID,
    limit: int,
) -> list[uuid.UUID]:
    sub_exists = (
        select(1)
        .select_from(Message)
        .where(
            Message.conversation_id == ConversationParticipant.conversation_id,
            Message.deleted_at.is_(None),
            Message.sender_user_id != user_id,
            or_(
                ConversationParticipant.last_read_at.is_(None),
                Message.created_at > ConversationParticipant.last_read_at,
            ),
        )
        .exists()
    )
    stmt = (
        select(Conversation.id)
        .join(
            ConversationParticipant,
            and_(
                ConversationParticipant.conversation_id == Conversation.id,
                ConversationParticipant.user_id == user_id,
            ),
        )
        .where(sub_exists)
        .order_by(Conversation.updated_at.desc())
        .limit(limit)
    )
    return list(db_session.scalars(stmt).all())


def find_direct_conversation_between_users(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    user_a: uuid.UUID,
    user_b: uuid.UUID,
) -> Conversation | None:
    """Return an existing direct conversation with exactly these two participants, if any."""
    if user_a == user_b:
        return None
    convs = list_conversations_for_user(db_session, user_id=user_a, limit=200, offset=0)
    want = {user_a, user_b}
    for conv in convs:
        if getattr(conv, "conversation_type", "direct") != "direct":
            continue
        if conv.company_id != company_id:
            continue
        parts = list_participants_for_conversation(db_session, conv.id)
        ids = {p.user_id for p in parts}
        if ids == want:
            return conv
    return None
