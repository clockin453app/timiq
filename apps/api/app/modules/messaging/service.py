from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id, list_users_visible_to_user_with_profile_names
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id
from app.modules.messaging.models import Announcement, Conversation, ConversationParticipant, Message
from app.modules.messaging.repository import (
    add_participant,
    count_announcement_reads,
    find_direct_conversation_between_users,
    get_announcement,
    get_announcement_read_for_user,
    get_conversation,
    get_last_message,
    get_participant,
    list_announcement_reads,
    list_announcements_visible,
    list_messages_for_conversation,
    list_participants_for_conversation,
    list_conversations_for_user,
    save_announcement,
    save_conversation,
    save_message,
    touch_conversation_updated,
    upsert_announcement_read,
)
from app.modules.messaging.schemas import (
    AnnouncementCreateRequest,
    AnnouncementDetailResponse,
    AnnouncementListItem,
    AnnouncementPatchRequest,
    AnnouncementReadEntry,
    ColleagueResponse,
    ConversationCreateRequest,
    ConversationListItem,
    ConversationParticipantsAddRequest,
    ConversationPatchRequest,
    MessageCreateRequest,
    MessageResponse,
)

_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(s: str) -> str:
    return _TAG_RE.sub("", s).strip()


class MessagingPermissionError(Exception):
    pass


class MessagingNotFoundError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _announcement_visible_to_actor(
    actor: User,
    row: Announcement,
    *,
    company_filter: uuid.UUID | None,
) -> bool:
    if row.audience_type == "company":
        if actor.system_role == SystemRole.ADMINISTRATOR and company_filter is not None:
            return row.company_id == company_filter
        return actor.company_id is not None and row.company_id == actor.company_id
    if row.audience_type == "all_companies":
        return actor.company_id is not None or actor.system_role == SystemRole.ADMINISTRATOR
    if row.audience_type == "administrators":
        return actor.system_role == SystemRole.ADMINISTRATOR
    return False


def _can_manage_announcement(actor: User, row: Announcement) -> bool:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return True
    if actor.system_role == SystemRole.ADMIN:
        return row.audience_type == "company" and actor.company_id is not None and row.company_id == actor.company_id
    return False


def _resolve_company_filter(actor: User, company_id: uuid.UUID | None) -> uuid.UUID | None:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return company_id
    return actor.company_id


def _include_drafts(actor: User) -> bool:
    return actor.system_role in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR)


def list_colleagues(
    db_session: Session,
    actor: User,
    company_id: uuid.UUID | None,
) -> list[ColleagueResponse]:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        if company_id is None:
            raise MessagingPermissionError("Select a company to list colleagues.")
        scope_company = company_id
    else:
        if actor.company_id is None:
            return []
        scope_company = actor.company_id

    rows = list_users_visible_to_user_with_profile_names(db_session, actor)
    out: list[ColleagueResponse] = []
    for user, fn, ln, _jt in rows:
        if user.id == actor.id:
            continue
        if not user.is_active:
            continue
        if user.company_id != scope_company:
            continue
        name = f"{(fn or '').strip()} {(ln or '').strip()}".strip()
        display = name if name else user.email
        out.append(
            ColleagueResponse(
                user_id=user.id,
                email=user.email,
                display_name=display,
            ),
        )
    return sorted(out, key=lambda r: r.display_name.lower())


def list_announcements(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    include_drafts: bool,
    limit: int,
    offset: int,
) -> list[AnnouncementListItem]:
    cf = _resolve_company_filter(actor, company_id)
    drafts = include_drafts and _include_drafts(actor)
    rows = list_announcements_visible(
        db_session,
        actor=actor,
        company_filter=cf if actor.system_role == SystemRole.ADMINISTRATOR else None,
        now=_now(),
        include_drafts=drafts,
        limit=limit,
        offset=offset,
    )
    return _hydrate_announcement_list(db_session, actor, rows, with_read_count=True)


def _hydrate_announcement_list(
    db_session: Session,
    actor: User,
    rows: list[Announcement],
    *,
    with_read_count: bool,
) -> list[AnnouncementListItem]:
    out: list[AnnouncementListItem] = []
    for row in rows:
        ar = get_announcement_read_for_user(db_session, announcement_id=row.id, user_id=actor.id)
        rc = None
        if with_read_count and _can_manage_announcement(actor, row):
            rc = count_announcement_reads(db_session, row.id)
        out.append(
            AnnouncementListItem(
                id=row.id,
                company_id=row.company_id,
                title=row.title,
                body=row.body,
                audience_type=row.audience_type,
                priority=row.priority,
                published_at=row.published_at,
                expires_at=row.expires_at,
                is_active=row.is_active,
                created_at=row.created_at,
                updated_at=row.updated_at,
                read_at=ar.read_at if ar else None,
                read_count=rc,
            ),
        )
    return out


def get_announcement_detail(
    db_session: Session,
    actor: User,
    announcement_id: uuid.UUID,
    *,
    company_id: uuid.UUID | None,
) -> AnnouncementDetailResponse:
    row = get_announcement(db_session, announcement_id)
    if row is None:
        raise MessagingNotFoundError("Announcement not found.")
    cf = _resolve_company_filter(actor, company_id)
    if not row.is_active:
        if not _can_manage_announcement(actor, row):
            raise MessagingPermissionError("You cannot view this announcement.")
    else:
        visible = _announcement_visible_to_actor(actor, row, company_filter=cf)
        draft_access = (
            _include_drafts(actor) and row.published_at is None and _can_manage_announcement(actor, row)
        )
        if not visible and not draft_access:
            raise MessagingPermissionError("You cannot view this announcement.")

    read_self = get_announcement_read_for_user(db_session, announcement_id=row.id, user_id=actor.id)
    rc = None
    reads: list[AnnouncementReadEntry] | None = None
    if _can_manage_announcement(actor, row):
        rc = count_announcement_reads(db_session, row.id)
        raw_reads = list_announcement_reads(db_session, row.id, 500)
        reads = [AnnouncementReadEntry(user_id=r.user_id, read_at=r.read_at) for r in raw_reads]
    return AnnouncementDetailResponse(
        id=row.id,
        company_id=row.company_id,
        title=row.title,
        body=row.body,
        audience_type=row.audience_type,
        priority=row.priority,
        published_at=row.published_at,
        expires_at=row.expires_at,
        is_active=row.is_active,
        created_at=row.created_at,
        updated_at=row.updated_at,
        read_at=read_self.read_at if read_self else None,
        read_count=rc,
        reads=reads,
    )


def create_announcement(
    db_session: Session,
    actor: User,
    body: AnnouncementCreateRequest,
) -> AnnouncementDetailResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        raise MessagingPermissionError("You cannot create announcements.")
    title = _strip_html(body.title)
    text = _strip_html(body.body)
    if not title or not text:
        raise MessagingPermissionError("Title and body cannot be empty.")
    aud = body.audience_type
    if actor.system_role == SystemRole.ADMIN:
        if aud != "company":
            raise MessagingPermissionError("Company admins may only post company announcements.")
        if actor.company_id is None:
            raise MessagingPermissionError("Your account is not linked to a company.")
        cid = actor.company_id
    else:
        cid = body.company_id
        if aud == "company":
            if cid is None:
                raise MessagingPermissionError("company_id is required for company announcements.")
        elif aud == "all_companies":
            if cid is not None:
                raise MessagingPermissionError("all_companies announcements must not set company_id.")
        elif aud == "administrators":
            if cid is not None:
                raise MessagingPermissionError("administrators announcements must not set company_id.")
    row = Announcement(
        company_id=cid,
        title=title,
        body=text,
        audience_type=aud,
        priority=body.priority,
        created_by_user_id=actor.id,
        published_at=body.published_at,
        expires_at=body.expires_at,
        is_active=True,
    )
    save_announcement(db_session, row)
    create_internal_audit_event(
        db_session,
        actor,
        action="messaging.announcement_created",
        entity_type="announcement",
        entity_id=str(row.id),
        company_id=cid if cid is not None else actor.company_id,
        details={"announcement_id": str(row.id), "audience_type": aud, "recipient_count": 0},
    )
    return get_announcement_detail(db_session, actor, row.id, company_id=cid if actor.system_role == SystemRole.ADMINISTRATOR else None)


def patch_announcement(
    db_session: Session,
    actor: User,
    announcement_id: uuid.UUID,
    body: AnnouncementPatchRequest,
    *,
    company_id: uuid.UUID | None,
) -> AnnouncementDetailResponse:
    row = get_announcement(db_session, announcement_id)
    if row is None:
        raise MessagingNotFoundError("Announcement not found.")
    if not _can_manage_announcement(actor, row):
        raise MessagingPermissionError("You cannot edit this announcement.")
    if body.title is not None:
        t = _strip_html(body.title)
        if not t:
            raise MessagingPermissionError("Title cannot be empty.")
        row.title = t
    if body.body is not None:
        b = _strip_html(body.body)
        if not b:
            raise MessagingPermissionError("Body cannot be empty.")
        row.body = b
    if body.priority is not None:
        row.priority = body.priority
    if body.published_at is not None:
        row.published_at = body.published_at
    if body.expires_at is not None:
        row.expires_at = body.expires_at
    row.updated_at = _now()
    save_announcement(db_session, row)
    create_internal_audit_event(
        db_session,
        actor,
        action="messaging.announcement_updated",
        entity_type="announcement",
        entity_id=str(row.id),
        company_id=row.company_id if row.company_id is not None else actor.company_id,
        details={"announcement_id": str(row.id), "recipient_count": 0},
    )
    return get_announcement_detail(db_session, actor, announcement_id, company_id=company_id)


def archive_announcement(
    db_session: Session,
    actor: User,
    announcement_id: uuid.UUID,
    *,
    company_id: uuid.UUID | None,
) -> AnnouncementDetailResponse:
    row = get_announcement(db_session, announcement_id)
    if row is None:
        raise MessagingNotFoundError("Announcement not found.")
    if not _can_manage_announcement(actor, row):
        raise MessagingPermissionError("You cannot archive this announcement.")
    row.is_active = False
    row.updated_at = _now()
    save_announcement(db_session, row)
    create_internal_audit_event(
        db_session,
        actor,
        action="messaging.announcement_archived",
        entity_type="announcement",
        entity_id=str(row.id),
        company_id=row.company_id if row.company_id is not None else actor.company_id,
        details={"announcement_id": str(row.id), "recipient_count": 0},
    )
    return get_announcement_detail(db_session, actor, announcement_id, company_id=company_id)


def mark_announcement_read(
    db_session: Session,
    actor: User,
    announcement_id: uuid.UUID,
    *,
    company_id: uuid.UUID | None,
) -> None:
    row = get_announcement(db_session, announcement_id)
    if row is None:
        raise MessagingNotFoundError("Announcement not found.")
    if not row.is_active:
        raise MessagingPermissionError("You cannot acknowledge this announcement.")
    cf = _resolve_company_filter(actor, company_id)
    if not _announcement_visible_to_actor(actor, row, company_filter=cf):
        raise MessagingPermissionError("You cannot acknowledge this announcement.")
    upsert_announcement_read(db_session, announcement_id=announcement_id, user_id=actor.id, read_at=_now())
    db_session.commit()


def _conversation_company_id(actor: User, body_company: uuid.UUID | None) -> uuid.UUID:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        if body_company is None:
            raise MessagingPermissionError("company_id is required to start a conversation.")
        return body_company
    if actor.company_id is None:
        raise MessagingPermissionError("Your account is not linked to a company.")
    return actor.company_id


def _validate_participants_same_company(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    user_ids: list[uuid.UUID],
    actor: User,
) -> list[User]:
    users: list[User] = []
    for uid in user_ids:
        u = get_user_by_id(db_session, uid)
        if u is None or not u.is_active:
            raise MessagingPermissionError("Invalid participant.")
        if u.company_id != company_id:
            if not (u.id == actor.id and actor.system_role == SystemRole.ADMINISTRATOR):
                raise MessagingPermissionError("Participants must belong to the same company.")
        users.append(u)
    return users


def _peer_display_name(db_session: Session, user_id: uuid.UUID) -> str:
    u = get_user_by_id(db_session, user_id)
    if u is None:
        return "User"
    profile = get_employee_profile_by_user_id(db_session, user_id)
    if profile is not None:
        name = f"{(profile.first_name or '').strip()} {(profile.last_name or '').strip()}".strip()
        if name:
            return name
    return u.email or "User"


def create_conversation(
    db_session: Session,
    actor: User,
    body: ConversationCreateRequest,
) -> ConversationListItem:
    cid = _conversation_company_id(actor, body.company_id)
    msg_text = _strip_html(body.initial_message)
    if not msg_text:
        raise MessagingPermissionError("Message cannot be empty.")
    ct = body.conversation_type
    participants = list({*body.participant_user_ids, actor.id})
    if len(participants) < 2:
        raise MessagingPermissionError("Select at least one other participant.")
    others = [p for p in participants if p != actor.id]
    if not others:
        raise MessagingPermissionError("Select at least one other participant.")
    _validate_participants_same_company(db_session, company_id=cid, user_ids=participants, actor=actor)

    if ct == "direct":
        if len(others) != 1:
            raise MessagingPermissionError("Direct conversations must have exactly one other participant.")
        other = others[0]
        existing = find_direct_conversation_between_users(
            db_session,
            company_id=cid,
            user_a=actor.id,
            user_b=other,
        )
        if existing is not None:
            msg = Message(conversation_id=existing.id, sender_user_id=actor.id, body=msg_text[:4000])
            save_message(db_session, msg)
            touch_conversation_updated(db_session, existing.id, _now())
            create_internal_audit_event(
                db_session,
                actor,
                action="messaging.message_sent",
                entity_type="conversation",
                entity_id=str(existing.id),
                company_id=cid,
                details={"conversation_id": str(existing.id), "recipient_count": 1},
            )
            return _conversation_to_list_item(db_session, existing, actor.id)

        conv = Conversation(
            company_id=cid,
            created_by_user_id=actor.id,
            conversation_type="direct",
            title=None,
        )
        save_conversation(db_session, conv)
        for uid in participants:
            add_participant(
                db_session,
                ConversationParticipant(conversation_id=conv.id, user_id=uid, last_read_at=None),
            )
        msg = Message(conversation_id=conv.id, sender_user_id=actor.id, body=msg_text[:4000])
        save_message(db_session, msg)
        touch_conversation_updated(db_session, conv.id, _now())
        create_internal_audit_event(
            db_session,
            actor,
            action="messaging.message_sent",
            entity_type="conversation",
            entity_id=str(conv.id),
            company_id=cid,
            details={"conversation_id": str(conv.id), "recipient_count": len(others)},
        )
        return _conversation_to_list_item(db_session, conv, actor.id)

    if len(others) < 2:
        raise MessagingPermissionError("Group conversations require at least two other participants.")
    title = _strip_html(body.title or "")
    if not title:
        raise MessagingPermissionError("Group title cannot be empty.")
    conv = Conversation(
        company_id=cid,
        created_by_user_id=actor.id,
        conversation_type="group",
        title=title[:200],
    )
    save_conversation(db_session, conv)
    for uid in participants:
        add_participant(
            db_session,
            ConversationParticipant(conversation_id=conv.id, user_id=uid, last_read_at=None),
        )
    msg = Message(conversation_id=conv.id, sender_user_id=actor.id, body=msg_text[:4000])
    save_message(db_session, msg)
    touch_conversation_updated(db_session, conv.id, _now())
    create_internal_audit_event(
        db_session,
        actor,
        action="messaging.group_created",
        entity_type="conversation",
        entity_id=str(conv.id),
        company_id=cid,
        details={"conversation_id": str(conv.id), "participant_count": len(participants)},
    )
    return _conversation_to_list_item(db_session, conv, actor.id)


def list_conversations(
    db_session: Session,
    actor: User,
    *,
    limit: int,
    offset: int,
) -> list[ConversationListItem]:
    rows = list_conversations_for_user(db_session, user_id=actor.id, limit=limit, offset=offset)
    return [_conversation_to_list_item(db_session, r, actor.id) for r in rows]


def _conversation_to_list_item(db_session: Session, conv: Conversation, viewer_id: uuid.UUID) -> ConversationListItem:
    parts = list_participants_for_conversation(db_session, conv.id)
    pids = [p.user_id for p in parts]
    last = get_last_message(db_session, conv.id)
    preview = None
    last_at = None
    if last is not None:
        preview = last.body[:140] + ("…" if len(last.body) > 140 else "")
        last_at = last.created_at
    ctype = getattr(conv, "conversation_type", None) or "direct"
    gtitle = getattr(conv, "title", None)
    other_name: str | None = None
    if ctype == "direct" and len(pids) == 2:
        other = pids[0] if pids[1] == viewer_id else pids[1]
        other_name = _peer_display_name(db_session, other)
    return ConversationListItem(
        id=conv.id,
        company_id=conv.company_id,
        conversation_type=ctype,
        title=gtitle,
        participant_count=len(parts),
        other_user_display_name=other_name,
        updated_at=conv.updated_at,
        participant_user_ids=pids,
        last_message_preview=preview,
        last_message_at=last_at,
    )


def list_messages(
    db_session: Session,
    actor: User,
    conversation_id: uuid.UUID,
    *,
    limit: int,
    offset: int,
) -> list[MessageResponse]:
    if get_participant(db_session, conversation_id=conversation_id, user_id=actor.id) is None:
        raise MessagingPermissionError("You are not part of this conversation.")
    rows = list_messages_for_conversation(db_session, conversation_id=conversation_id, limit=limit, offset=offset)
    return [MessageResponse.model_validate(m) for m in rows]


def append_message(
    db_session: Session,
    actor: User,
    conversation_id: uuid.UUID,
    body: MessageCreateRequest,
) -> MessageResponse:
    if get_participant(db_session, conversation_id=conversation_id, user_id=actor.id) is None:
        raise MessagingPermissionError("You are not part of this conversation.")
    text = _strip_html(body.body)
    if not text:
        raise MessagingPermissionError("Message cannot be empty.")
    msg = Message(conversation_id=conversation_id, sender_user_id=actor.id, body=text[:4000])
    save_message(db_session, msg)
    touch_conversation_updated(db_session, conversation_id, _now())
    conv = get_conversation(db_session, conversation_id)
    if conv is None:
        raise MessagingNotFoundError("Conversation not found.")
    others = [p.user_id for p in list_participants_for_conversation(db_session, conversation_id) if p.user_id != actor.id]
    create_internal_audit_event(
        db_session,
        actor,
        action="messaging.message_sent",
        entity_type="conversation",
        entity_id=str(conversation_id),
        company_id=conv.company_id,
        details={"conversation_id": str(conversation_id), "recipient_count": len(others)},
    )
    return MessageResponse.model_validate(msg)


def patch_group_conversation_title(
    db_session: Session,
    actor: User,
    conversation_id: uuid.UUID,
    body: ConversationPatchRequest,
) -> ConversationListItem:
    if get_participant(db_session, conversation_id=conversation_id, user_id=actor.id) is None:
        raise MessagingPermissionError("You are not part of this conversation.")
    conv = get_conversation(db_session, conversation_id)
    if conv is None:
        raise MessagingNotFoundError("Conversation not found.")
    if conv.conversation_type != "group":
        raise MessagingPermissionError("Only group conversations can be renamed.")
    t = _strip_html(body.title)
    if not t:
        raise MessagingPermissionError("Title cannot be empty.")
    conv.title = t[:200]
    conv.updated_at = _now()
    db_session.add(conv)
    db_session.flush()
    create_internal_audit_event(
        db_session,
        actor,
        action="messaging.group_renamed",
        entity_type="conversation",
        entity_id=str(conversation_id),
        company_id=conv.company_id,
        details={"conversation_id": str(conversation_id), "change": "title_updated"},
    )
    return _conversation_to_list_item(db_session, conv, actor.id)


def add_group_conversation_participants(
    db_session: Session,
    actor: User,
    conversation_id: uuid.UUID,
    body: ConversationParticipantsAddRequest,
) -> ConversationListItem:
    if get_participant(db_session, conversation_id=conversation_id, user_id=actor.id) is None:
        raise MessagingPermissionError("You are not part of this conversation.")
    conv = get_conversation(db_session, conversation_id)
    if conv is None:
        raise MessagingNotFoundError("Conversation not found.")
    if conv.conversation_type != "group":
        raise MessagingPermissionError("You can only add participants to group conversations.")
    existing_ids = {p.user_id for p in list_participants_for_conversation(db_session, conversation_id)}
    to_add = [uid for uid in body.user_ids if uid not in existing_ids]
    if not to_add:
        raise MessagingPermissionError("No new participants to add.")
    _validate_participants_same_company(
        db_session,
        company_id=conv.company_id,
        user_ids=to_add,
        actor=actor,
    )
    for uid in to_add:
        add_participant(
            db_session,
            ConversationParticipant(conversation_id=conversation_id, user_id=uid, last_read_at=None),
        )
    touch_conversation_updated(db_session, conversation_id, _now())
    create_internal_audit_event(
        db_session,
        actor,
        action="messaging.group_participants_updated",
        entity_type="conversation",
        entity_id=str(conversation_id),
        company_id=conv.company_id,
        details={"conversation_id": str(conversation_id), "added_count": len(to_add)},
    )
    return _conversation_to_list_item(db_session, conv, actor.id)


def mark_conversation_read(
    db_session: Session,
    actor: User,
    conversation_id: uuid.UUID,
) -> None:
    part = get_participant(db_session, conversation_id=conversation_id, user_id=actor.id)
    if part is None:
        raise MessagingPermissionError("You are not part of this conversation.")
    part.last_read_at = _now()
    db_session.add(part)
    db_session.flush()
    db_session.commit()
