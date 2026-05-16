"""HTTP routes for toolbox talks (site safety briefings and sign-offs)."""

from __future__ import annotations

import uuid
from datetime import date
from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.storage.file_response import content_disposition_attachment
from app.db.session import get_db_session
from app.modules.auth.dependencies import (
    get_current_user,
    require_admin_or_administrator,
    require_roles,
)
from app.modules.auth.models import SystemRole, User
from app.modules.toolbox_talks.schemas import (
    ToolboxTalkAttendeeResponse,
    ToolboxTalkAttendeesAddRequest,
    ToolboxTalkCreateRequest,
    ToolboxTalkDeclineRequest,
    ToolboxTalkDetailResponse,
    ToolboxTalkManualSignRequest,
    ToolboxTalkPatchRequest,
    ToolboxTalkSignRequest,
    ToolboxTalkSummaryResponse,
    ToolboxTopicOption,
    ToolboxTopicTemplateResponse,
)
from app.modules.toolbox_talks.service import (
    ToolboxTalkError,
    ToolboxTalkNotFoundError,
    ToolboxTalkPermissionError,
    ToolboxTalkValidationError,
    add_attendees,
    archive_talk,
    complete_talk,
    create_talk,
    decline_talk,
    delete_talk_hard,
    export_csv_bytes,
    export_talk_pdf_bytes,
    get_talk_for_viewer,
    list_talks_admin,
    list_talks_me,
    list_topic_options,
    list_topic_templates,
    manual_sign_attendee,
    patch_talk,
    publish_talk,
    remove_attendee,
    render_print_html,
    sign_talk,
)

router = APIRouter(prefix="/api/toolbox-talks", tags=["toolbox_talks"])

NOT_FOUND = "Not found."


def _raise_http_from_toolbox_exc(exc: ToolboxTalkError) -> NoReturn:
    if isinstance(exc, ToolboxTalkNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from exc
    if isinstance(exc, ToolboxTalkPermissionError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden.") from exc
    if isinstance(exc, ToolboxTalkValidationError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unexpected error.") from exc


@router.get("/topics", response_model=list[ToolboxTopicOption])
def get_toolbox_topics(
    _current_user: User = Depends(get_current_user),
) -> list[ToolboxTopicOption]:
    return list_topic_options()


@router.get("/templates", response_model=list[ToolboxTopicTemplateResponse])
def get_toolbox_talk_templates(
    _current_user: User = Depends(get_current_user),
) -> list[ToolboxTopicTemplateResponse]:
    return list_topic_templates()


@router.get("/me", response_model=list[ToolboxTalkSummaryResponse])
def get_my_toolbox_talks(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_roles(SystemRole.EMPLOYEE)),
) -> list[ToolboxTalkSummaryResponse]:
    try:
        return list_talks_me(db_session, current_user)
    except ToolboxTalkError as exc:
        _raise_http_from_toolbox_exc(exc)


@router.get("", response_model=list[ToolboxTalkSummaryResponse])
def list_toolbox_talks(
    company_id: uuid.UUID | None = Query(default=None),
    talk_status: str | None = Query(default=None, alias="status"),
    location_id: uuid.UUID | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[ToolboxTalkSummaryResponse]:
    try:
        return list_talks_admin(
            db_session,
            current_user,
            company_id=company_id,
            status=talk_status,
            location_id=location_id,
            date_from=date_from,
            date_to=date_to,
        )
    except ToolboxTalkError as exc:
        _raise_http_from_toolbox_exc(exc)


@router.post("", response_model=ToolboxTalkDetailResponse, status_code=status.HTTP_201_CREATED)
def post_toolbox_talk(
    body: ToolboxTalkCreateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> ToolboxTalkDetailResponse:
    try:
        return create_talk(db_session, current_user, body)
    except ToolboxTalkError as exc:
        _raise_http_from_toolbox_exc(exc)


@router.get("/{talk_id}", response_model=ToolboxTalkDetailResponse)
def get_toolbox_talk(
    talk_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> ToolboxTalkDetailResponse:
    try:
        return get_talk_for_viewer(db_session, current_user, talk_id)
    except ToolboxTalkError as exc:
        _raise_http_from_toolbox_exc(exc)


@router.patch("/{talk_id}", response_model=ToolboxTalkDetailResponse)
def patch_toolbox_talk(
    talk_id: uuid.UUID,
    body: ToolboxTalkPatchRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> ToolboxTalkDetailResponse:
    try:
        return patch_talk(db_session, current_user, talk_id, body)
    except ToolboxTalkError as exc:
        _raise_http_from_toolbox_exc(exc)


@router.post("/{talk_id}/publish", response_model=ToolboxTalkDetailResponse)
def post_publish_toolbox_talk(
    talk_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> ToolboxTalkDetailResponse:
    try:
        return publish_talk(db_session, current_user, talk_id)
    except ToolboxTalkError as exc:
        _raise_http_from_toolbox_exc(exc)


@router.post("/{talk_id}/complete", response_model=ToolboxTalkDetailResponse)
def post_complete_toolbox_talk(
    talk_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> ToolboxTalkDetailResponse:
    try:
        return complete_talk(db_session, current_user, talk_id)
    except ToolboxTalkError as exc:
        _raise_http_from_toolbox_exc(exc)


@router.post("/{talk_id}/archive", response_model=ToolboxTalkDetailResponse)
def post_archive_toolbox_talk(
    talk_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> ToolboxTalkDetailResponse:
    try:
        return archive_talk(db_session, current_user, talk_id)
    except ToolboxTalkError as exc:
        _raise_http_from_toolbox_exc(exc)


@router.delete("/{talk_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_toolbox_talk_route(
    talk_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    try:
        delete_talk_hard(db_session, current_user, talk_id)
    except ToolboxTalkError as exc:
        _raise_http_from_toolbox_exc(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{talk_id}/pdf")
def get_toolbox_talk_pdf(
    talk_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> Response:
    try:
        raw, filename = export_talk_pdf_bytes(db_session, current_user, talk_id)
    except ToolboxTalkError as exc:
        _raise_http_from_toolbox_exc(exc)
    headers = {"Content-Disposition": content_disposition_attachment(filename)}
    return Response(content=raw, media_type="application/pdf", headers=headers)


@router.get("/{talk_id}/record.pdf")
def get_toolbox_talk_record_pdf(
    talk_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> Response:
    try:
        raw, filename = export_talk_pdf_bytes(db_session, current_user, talk_id)
    except ToolboxTalkError as exc:
        _raise_http_from_toolbox_exc(exc)
    headers = {"Content-Disposition": content_disposition_attachment(filename)}
    return Response(content=raw, media_type="application/pdf", headers=headers)


@router.get("/{talk_id}/attendees", response_model=list[ToolboxTalkAttendeeResponse])
def get_toolbox_talk_attendees(
    talk_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> list[ToolboxTalkAttendeeResponse]:
    try:
        detail = get_talk_for_viewer(db_session, current_user, talk_id)
        return detail.attendees
    except ToolboxTalkError as exc:
        _raise_http_from_toolbox_exc(exc)


@router.post("/{talk_id}/attendees", response_model=ToolboxTalkDetailResponse)
def post_toolbox_talk_attendees(
    talk_id: uuid.UUID,
    body: ToolboxTalkAttendeesAddRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> ToolboxTalkDetailResponse:
    try:
        return add_attendees(db_session, current_user, talk_id, body)
    except ToolboxTalkError as exc:
        _raise_http_from_toolbox_exc(exc)


@router.delete("/{talk_id}/attendees/{user_id}", response_model=ToolboxTalkDetailResponse)
def delete_toolbox_talk_attendee(
    talk_id: uuid.UUID,
    user_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> ToolboxTalkDetailResponse:
    try:
        return remove_attendee(db_session, current_user, talk_id, user_id)
    except ToolboxTalkError as exc:
        _raise_http_from_toolbox_exc(exc)


@router.post("/{talk_id}/attendees/{user_id}/manual-sign", response_model=ToolboxTalkDetailResponse)
def post_toolbox_talk_manual_signature(
    talk_id: uuid.UUID,
    user_id: uuid.UUID,
    body: ToolboxTalkManualSignRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> ToolboxTalkDetailResponse:
    try:
        return manual_sign_attendee(db_session, current_user, talk_id, user_id, body)
    except ToolboxTalkError as exc:
        _raise_http_from_toolbox_exc(exc)


@router.post("/{talk_id}/sign", response_model=ToolboxTalkDetailResponse)
def post_sign_toolbox_talk(
    talk_id: uuid.UUID,
    body: ToolboxTalkSignRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_roles(SystemRole.EMPLOYEE)),
) -> ToolboxTalkDetailResponse:
    try:
        return sign_talk(db_session, current_user, talk_id, body)
    except ToolboxTalkError as exc:
        _raise_http_from_toolbox_exc(exc)


@router.post("/{talk_id}/decline", response_model=ToolboxTalkDetailResponse)
def post_decline_toolbox_talk(
    talk_id: uuid.UUID,
    body: ToolboxTalkDeclineRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_roles(SystemRole.EMPLOYEE)),
) -> ToolboxTalkDetailResponse:
    try:
        return decline_talk(db_session, current_user, talk_id, body)
    except ToolboxTalkError as exc:
        _raise_http_from_toolbox_exc(exc)


@router.get("/{talk_id}/print")
def get_toolbox_talk_print(
    talk_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> Response:
    try:
        html = render_print_html(db_session, current_user, talk_id)
    except ToolboxTalkError as exc:
        _raise_http_from_toolbox_exc(exc)
    return Response(content=html, media_type="text/html; charset=utf-8")


@router.get("/{talk_id}/export.csv")
def get_toolbox_talk_export_csv(
    talk_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    try:
        raw, filename = export_csv_bytes(db_session, current_user, talk_id)
    except ToolboxTalkError as exc:
        _raise_http_from_toolbox_exc(exc)
    headers = {"Content-Disposition": content_disposition_attachment(filename)}
    return Response(content=raw, media_type="text/csv; charset=utf-8", headers=headers)
