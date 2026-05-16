import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import get_current_user, require_admin_or_administrator
from app.modules.auth.models import User

from .schemas import (
    AnnouncementCreateRequest,
    AnnouncementDetailResponse,
    AnnouncementListItem,
    AnnouncementPatchRequest,
    ColleagueResponse,
    ConversationCreateRequest,
    ConversationListItem,
    ConversationParticipantsAddRequest,
    ConversationPatchRequest,
    MessageCreateRequest,
    MessageResponse,
)
from .service import (
    MessagingNotFoundError,
    MessagingPermissionError,
    add_group_conversation_participants,
    append_message,
    archive_announcement,
    create_announcement,
    create_conversation,
    get_announcement_detail,
    list_announcements,
    list_colleagues,
    list_conversations,
    list_messages,
    mark_announcement_read,
    mark_conversation_read,
    patch_announcement,
    patch_group_conversation_title,
    record_conversation_presence,
)

router = APIRouter(prefix="/api/messaging", tags=["messaging"])


def _perm(exc: MessagingPermissionError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


def _nf(exc: MessagingNotFoundError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/colleagues", response_model=list[ColleagueResponse])
def read_colleagues(
    company_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> list[ColleagueResponse]:
    try:
        return list_colleagues(db_session, current_user, company_id)
    except MessagingPermissionError as exc:
        raise _perm(exc) from exc


@router.get("/announcements", response_model=list[AnnouncementListItem])
def read_announcements(
    company_id: uuid.UUID | None = Query(default=None, description="Administrator: scope company announcements."),
    include_drafts: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> list[AnnouncementListItem]:
    try:
        return list_announcements(
            db_session,
            current_user,
            company_id=company_id,
            include_drafts=include_drafts,
            limit=limit,
            offset=offset,
        )
    except MessagingPermissionError as exc:
        raise _perm(exc) from exc


@router.post("/announcements", response_model=AnnouncementDetailResponse)
def post_announcement(
    body: AnnouncementCreateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> AnnouncementDetailResponse:
    try:
        return create_announcement(db_session, current_user, body)
    except MessagingPermissionError as exc:
        raise _perm(exc) from exc


@router.get("/announcements/{announcement_id}", response_model=AnnouncementDetailResponse)
def read_announcement(
    announcement_id: uuid.UUID,
    company_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> AnnouncementDetailResponse:
    try:
        return get_announcement_detail(db_session, current_user, announcement_id, company_id=company_id)
    except MessagingPermissionError as exc:
        raise _perm(exc) from exc
    except MessagingNotFoundError as exc:
        raise _nf(exc) from exc


@router.patch("/announcements/{announcement_id}", response_model=AnnouncementDetailResponse)
def patch_announcement_route(
    announcement_id: uuid.UUID,
    body: AnnouncementPatchRequest,
    company_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> AnnouncementDetailResponse:
    try:
        return patch_announcement(db_session, current_user, announcement_id, body, company_id=company_id)
    except MessagingPermissionError as exc:
        raise _perm(exc) from exc
    except MessagingNotFoundError as exc:
        raise _nf(exc) from exc


@router.post("/announcements/{announcement_id}/archive", response_model=AnnouncementDetailResponse)
def post_announcement_archive(
    announcement_id: uuid.UUID,
    company_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> AnnouncementDetailResponse:
    try:
        return archive_announcement(db_session, current_user, announcement_id, company_id=company_id)
    except MessagingPermissionError as exc:
        raise _perm(exc) from exc
    except MessagingNotFoundError as exc:
        raise _nf(exc) from exc


@router.post("/announcements/{announcement_id}/mark-read", status_code=status.HTTP_204_NO_CONTENT)
def post_announcement_mark_read(
    announcement_id: uuid.UUID,
    company_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> None:
    try:
        mark_announcement_read(db_session, current_user, announcement_id, company_id=company_id)
    except MessagingPermissionError as exc:
        raise _perm(exc) from exc
    except MessagingNotFoundError as exc:
        raise _nf(exc) from exc


@router.get("/conversations", response_model=list[ConversationListItem])
def read_conversations(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> list[ConversationListItem]:
    return list_conversations(db_session, current_user, limit=limit, offset=offset)


@router.post("/conversations", response_model=ConversationListItem)
def post_conversation(
    body: ConversationCreateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> ConversationListItem:
    try:
        return create_conversation(db_session, current_user, body)
    except MessagingPermissionError as exc:
        raise _perm(exc) from exc


@router.patch("/conversations/{conversation_id}", response_model=ConversationListItem)
def patch_conversation_route(
    conversation_id: uuid.UUID,
    body: ConversationPatchRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> ConversationListItem:
    try:
        return patch_group_conversation_title(db_session, current_user, conversation_id, body)
    except MessagingPermissionError as exc:
        raise _perm(exc) from exc
    except MessagingNotFoundError as exc:
        raise _nf(exc) from exc


@router.post("/conversations/{conversation_id}/participants", response_model=ConversationListItem)
def post_conversation_participants(
    conversation_id: uuid.UUID,
    body: ConversationParticipantsAddRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> ConversationListItem:
    try:
        return add_group_conversation_participants(db_session, current_user, conversation_id, body)
    except MessagingPermissionError as exc:
        raise _perm(exc) from exc
    except MessagingNotFoundError as exc:
        raise _nf(exc) from exc


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageResponse])
def read_conversation_messages(
    conversation_id: uuid.UUID,
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> list[MessageResponse]:
    try:
        return list_messages(db_session, current_user, conversation_id, limit=limit, offset=offset)
    except MessagingPermissionError as exc:
        raise _perm(exc) from exc


@router.post("/conversations/{conversation_id}/messages", response_model=MessageResponse)
def post_conversation_message(
    conversation_id: uuid.UUID,
    body: MessageCreateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> MessageResponse:
    try:
        return append_message(db_session, current_user, conversation_id, body)
    except MessagingPermissionError as exc:
        raise _perm(exc) from exc


@router.post("/conversations/{conversation_id}/mark-read", status_code=status.HTTP_204_NO_CONTENT)
def post_conversation_mark_read(
    conversation_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> None:
    try:
        mark_conversation_read(db_session, current_user, conversation_id)
    except MessagingPermissionError as exc:
        raise _perm(exc) from exc


@router.post("/conversations/{conversation_id}/presence", status_code=status.HTTP_204_NO_CONTENT)
def post_conversation_presence(
    conversation_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> None:
    try:
        record_conversation_presence(db_session, current_user, conversation_id)
    except MessagingPermissionError as exc:
        raise _perm(exc) from exc
