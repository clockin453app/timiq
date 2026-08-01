"""HTTP routes for RAMS / digital risk assessments."""

from __future__ import annotations

import uuid
from datetime import date
from typing import NoReturn

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.storage.file_response import (
    content_disposition_attachment,
    content_disposition_inline,
    protected_file_response,
)
from app.db.session import get_db_session
from app.modules.auth.dependencies import (
    get_current_user,
    require_admin_or_administrator,
    require_roles,
)
from app.modules.auth.models import SystemRole, User
from app.modules.rams.schemas import (
    RamsAcknowledgementResponse,
    RamsAcknowledgementsAddRequest,
    RamsAcknowledgeRequest,
    RamsAssessmentCreateRequest,
    RamsAssessmentDetailResponse,
    RamsAssessmentListItem,
    RamsAssessmentPatchRequest,
    RamsAttachmentResponse,
    RamsBulkAcknowledgementsRequest,
    RamsBulkAcknowledgementsResponse,
    RamsBulkPreviewResponse,
    RamsDeclineRequest,
    RamsFromPresetRequest,
    RamsHazardCreateRequest,
    RamsHazardPatchRequest,
    RamsHazardResponse,
    RamsManualSignRequest,
    RamsPresetsResponse,
)
from app.modules.rams.service import (
    RamsError,
    RamsNotFoundError,
    RamsPermissionError,
    RamsValidationError,
    acknowledge_assessment,
    add_acknowledgements,
    archive_assessment,
    bulk_add_acknowledgements,
    create_assessment,
    create_assessment_from_preset,
    create_assessment_from_uploaded_pdf,
    create_hazard,
    decline_assessment,
    delete_assessment_hard,
    delete_hazard,
    delete_rams_attachment_service,
    download_rams_attachment_file,
    download_uploaded_rams_pdf,
    export_assessment_pdf_bytes,
    export_csv_bytes,
    get_assessment_detail,
    get_presets,
    list_acknowledgements_admin,
    list_assessments_admin,
    list_hazards,
    list_me,
    list_rams_attachments_service,
    manual_sign_acknowledgement,
    patch_assessment,
    patch_hazard,
    preview_bulk_acknowledgements,
    publish_assessment,
    render_print_html,
    replace_draft_uploaded_pdf,
    review_assessment,
    upload_rams_attachment_service,
)

router = APIRouter(prefix="/api/rams", tags=["rams"])

NOT_FOUND = "Not found."


def _raise_http(exc: RamsError) -> NoReturn:
    if isinstance(exc, RamsNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from exc
    if isinstance(exc, RamsPermissionError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden.") from exc
    if isinstance(exc, RamsValidationError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unexpected error.") from exc


@router.get("/presets", response_model=RamsPresetsResponse)
def get_rams_presets(_current_user: User = Depends(get_current_user)) -> RamsPresetsResponse:
    return get_presets()


@router.get("/me", response_model=list[RamsAssessmentListItem])
def get_my_rams(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_roles(SystemRole.EMPLOYEE)),
) -> list[RamsAssessmentListItem]:
    try:
        return list_me(db_session, current_user)
    except RamsError as exc:
        _raise_http(exc)


@router.get("", response_model=list[RamsAssessmentListItem])
def list_rams_assessments(
    company_id: uuid.UUID | None = Query(default=None),
    assessment_status: str | None = Query(default=None, alias="status"),
    location_id: uuid.UUID | None = Query(default=None),
    risk_level: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[RamsAssessmentListItem]:
    try:
        return list_assessments_admin(
            db_session,
            current_user,
            company_id=company_id,
            status=assessment_status,
            location_id=location_id,
            risk_level=risk_level,
            date_from=date_from,
            date_to=date_to,
        )
    except RamsError as exc:
        _raise_http(exc)


@router.post("", response_model=RamsAssessmentDetailResponse, status_code=status.HTTP_201_CREATED)
def post_rams_assessment(
    body: RamsAssessmentCreateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> RamsAssessmentDetailResponse:
    try:
        return create_assessment(db_session, current_user, body)
    except RamsError as exc:
        _raise_http(exc)


@router.post("/from-preset", response_model=RamsAssessmentDetailResponse, status_code=status.HTTP_201_CREATED)
def post_rams_from_preset(
    body: RamsFromPresetRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> RamsAssessmentDetailResponse:
    try:
        return create_assessment_from_preset(db_session, current_user, body)
    except RamsError as exc:
        _raise_http(exc)


@router.post("/upload-pdf", response_model=RamsAssessmentDetailResponse, status_code=status.HTTP_201_CREATED)
async def post_rams_upload_pdf(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
    file: UploadFile = File(...),
    title: str = Form(...),
    company_id: uuid.UUID | None = Form(default=None),
    location_id: uuid.UUID | None = Form(default=None),
    description: str | None = Form(default=None),
    work_activity: str | None = Form(default=None),
    risk_level: str = Form(default="medium"),
    review_due_date: date | None = Form(default=None),
    produced_by_name: str | None = Form(default=None),
    notes: str | None = Form(default=None),
) -> RamsAssessmentDetailResponse:
    raw = await file.read()
    try:
        return create_assessment_from_uploaded_pdf(
            db_session,
            current_user,
            file_bytes=raw,
            filename=file.filename,
            content_type=file.content_type,
            title=title,
            company_id=company_id,
            location_id=location_id,
            description=description,
            work_activity=work_activity,
            risk_level=risk_level,
            review_due_date=review_due_date,
            produced_by_name=produced_by_name,
            notes=notes,
        )
    except RamsError as exc:
        _raise_http(exc)


@router.post("/{assessment_id}/uploaded-pdf", response_model=RamsAssessmentDetailResponse)
async def post_rams_replace_uploaded_pdf(
    assessment_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
    file: UploadFile = File(...),
) -> RamsAssessmentDetailResponse:
    raw = await file.read()
    try:
        return replace_draft_uploaded_pdf(
            db_session,
            current_user,
            assessment_id,
            file_bytes=raw,
            filename=file.filename,
            content_type=file.content_type,
        )
    except RamsError as exc:
        _raise_http(exc)


@router.get("/{assessment_id}/uploaded-pdf")
def get_rams_uploaded_pdf_download(
    assessment_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> Response:
    try:
        raw, filename = download_uploaded_rams_pdf(
            db_session,
            current_user,
            assessment_id,
            disposition="attachment",
        )
    except RamsError as exc:
        _raise_http(exc)
    return protected_file_response(body=raw, download_filename=filename, media_type="application/pdf")


@router.get("/{assessment_id}/uploaded-pdf/view")
def get_rams_uploaded_pdf_view(
    assessment_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> Response:
    try:
        raw, filename = download_uploaded_rams_pdf(
            db_session,
            current_user,
            assessment_id,
            disposition="inline",
        )
    except RamsError as exc:
        _raise_http(exc)
    headers = {
        "Content-Disposition": content_disposition_inline(filename),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
    }
    return Response(content=raw, media_type="application/pdf", headers=headers)


@router.get("/{assessment_id}/attachments", response_model=list[RamsAttachmentResponse])
def get_rams_attachments(
    assessment_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> list[RamsAttachmentResponse]:
    try:
        return list_rams_attachments_service(db_session, current_user, assessment_id)
    except RamsError as exc:
        _raise_http(exc)


@router.post("/{assessment_id}/attachments", response_model=RamsAssessmentDetailResponse)
async def post_rams_attachment(
    assessment_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
    file: UploadFile = File(...),
    section_key: str = Form(...),
    caption: str | None = Form(default=None),
    hazard_id: uuid.UUID | None = Form(default=None),
    method_step_key: str | None = Form(default=None),
) -> RamsAssessmentDetailResponse:
    raw = await file.read()
    try:
        return upload_rams_attachment_service(
            db_session,
            current_user,
            assessment_id,
            file_bytes=raw,
            original_filename=file.filename or "upload.jpg",
            section_key=section_key,
            caption=caption,
            hazard_id=hazard_id,
            method_step_key=method_step_key,
        )
    except RamsError as exc:
        _raise_http(exc)


@router.delete(
    "/{assessment_id}/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_rams_attachment_route(
    assessment_id: uuid.UUID,
    attachment_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    try:
        delete_rams_attachment_service(db_session, current_user, assessment_id, attachment_id)
    except RamsError as exc:
        _raise_http(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{assessment_id}/attachments/{attachment_id}/download")
def download_rams_attachment_route(
    assessment_id: uuid.UUID,
    attachment_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> Response:
    try:
        body, filename, media = download_rams_attachment_file(db_session, current_user, assessment_id, attachment_id)
    except RamsError as exc:
        _raise_http(exc)
    return protected_file_response(body=body, download_filename=filename, media_type=media)


@router.get("/{assessment_id}/hazards", response_model=list[RamsHazardResponse])
def get_rams_hazards(
    assessment_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> list[RamsHazardResponse]:
    try:
        return list_hazards(db_session, current_user, assessment_id)
    except RamsError as exc:
        _raise_http(exc)


@router.post("/{assessment_id}/hazards", response_model=RamsHazardResponse, status_code=status.HTTP_201_CREATED)
def post_rams_hazard(
    assessment_id: uuid.UUID,
    body: RamsHazardCreateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> RamsHazardResponse:
    try:
        return create_hazard(db_session, current_user, assessment_id, body)
    except RamsError as exc:
        _raise_http(exc)


@router.patch("/{assessment_id}/hazards/{hazard_id}", response_model=RamsHazardResponse)
def patch_rams_hazard(
    assessment_id: uuid.UUID,
    hazard_id: uuid.UUID,
    body: RamsHazardPatchRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> RamsHazardResponse:
    try:
        return patch_hazard(db_session, current_user, assessment_id, hazard_id, body)
    except RamsError as exc:
        _raise_http(exc)


@router.delete(
    "/{assessment_id}/hazards/{hazard_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_rams_hazard(
    assessment_id: uuid.UUID,
    hazard_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    try:
        delete_hazard(db_session, current_user, assessment_id, hazard_id)
    except RamsError as exc:
        _raise_http(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{assessment_id}/acknowledgements", response_model=list[RamsAcknowledgementResponse])
def get_rams_acknowledgements(
    assessment_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[RamsAcknowledgementResponse]:
    try:
        return list_acknowledgements_admin(db_session, current_user, assessment_id)
    except RamsError as exc:
        _raise_http(exc)


@router.post("/{assessment_id}/acknowledgements", response_model=RamsAssessmentDetailResponse)
def post_rams_acknowledgements(
    assessment_id: uuid.UUID,
    body: RamsAcknowledgementsAddRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> RamsAssessmentDetailResponse:
    try:
        return add_acknowledgements(db_session, current_user, assessment_id, body)
    except RamsError as exc:
        _raise_http(exc)


@router.get(
    "/{assessment_id}/acknowledgements/bulk-preview",
    response_model=RamsBulkPreviewResponse,
)
def get_rams_acknowledgements_bulk_preview(
    assessment_id: uuid.UUID,
    scope: str = Query(..., description='Either "company" or "site".'),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> RamsBulkPreviewResponse:
    try:
        return preview_bulk_acknowledgements(db_session, current_user, assessment_id, scope=scope)
    except RamsError as exc:
        _raise_http(exc)


@router.post(
    "/{assessment_id}/acknowledgements/bulk",
    response_model=RamsBulkAcknowledgementsResponse,
)
def post_rams_acknowledgements_bulk(
    assessment_id: uuid.UUID,
    body: RamsBulkAcknowledgementsRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> RamsBulkAcknowledgementsResponse:
    try:
        return bulk_add_acknowledgements(db_session, current_user, assessment_id, body)
    except RamsError as exc:
        _raise_http(exc)


@router.post("/{assessment_id}/acknowledge", response_model=RamsAssessmentDetailResponse)
def post_rams_acknowledge(
    assessment_id: uuid.UUID,
    body: RamsAcknowledgeRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_roles(SystemRole.EMPLOYEE)),
) -> RamsAssessmentDetailResponse:
    try:
        return acknowledge_assessment(db_session, current_user, assessment_id, body)
    except RamsError as exc:
        _raise_http(exc)


@router.post("/{assessment_id}/acknowledgements/{user_id}/manual-sign", response_model=RamsAssessmentDetailResponse)
def post_rams_manual_signature(
    assessment_id: uuid.UUID,
    user_id: uuid.UUID,
    body: RamsManualSignRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> RamsAssessmentDetailResponse:
    try:
        return manual_sign_acknowledgement(db_session, current_user, assessment_id, user_id, body)
    except RamsError as exc:
        _raise_http(exc)


@router.post("/{assessment_id}/decline", response_model=RamsAssessmentDetailResponse)
def post_rams_decline(
    assessment_id: uuid.UUID,
    body: RamsDeclineRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_roles(SystemRole.EMPLOYEE)),
) -> RamsAssessmentDetailResponse:
    try:
        return decline_assessment(db_session, current_user, assessment_id, body)
    except RamsError as exc:
        _raise_http(exc)


@router.post("/{assessment_id}/publish", response_model=RamsAssessmentDetailResponse)
def post_rams_publish(
    assessment_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> RamsAssessmentDetailResponse:
    try:
        return publish_assessment(db_session, current_user, assessment_id)
    except RamsError as exc:
        _raise_http(exc)


@router.post("/{assessment_id}/review", response_model=RamsAssessmentDetailResponse)
def post_rams_review(
    assessment_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> RamsAssessmentDetailResponse:
    try:
        return review_assessment(db_session, current_user, assessment_id)
    except RamsError as exc:
        _raise_http(exc)


@router.post("/{assessment_id}/archive", response_model=RamsAssessmentDetailResponse)
def post_rams_archive(
    assessment_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> RamsAssessmentDetailResponse:
    try:
        return archive_assessment(db_session, current_user, assessment_id)
    except RamsError as exc:
        _raise_http(exc)


@router.get("/{assessment_id}/print")
def get_rams_print(
    assessment_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> Response:
    try:
        html_out = render_print_html(db_session, current_user, assessment_id)
    except RamsError as exc:
        _raise_http(exc)
    return Response(content=html_out, media_type="text/html; charset=utf-8")


@router.get("/{assessment_id}/export.csv")
def get_rams_export_csv(
    assessment_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    try:
        raw, filename = export_csv_bytes(db_session, current_user, assessment_id)
    except RamsError as exc:
        _raise_http(exc)
    headers = {"Content-Disposition": content_disposition_attachment(filename)}
    return Response(content=raw, media_type="text/csv; charset=utf-8", headers=headers)


@router.get("/{assessment_id}/pdf")
def get_rams_pdf(
    assessment_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> Response:
    try:
        raw, filename = export_assessment_pdf_bytes(db_session, current_user, assessment_id)
    except RamsError as exc:
        _raise_http(exc)
    headers = {"Content-Disposition": content_disposition_attachment(filename)}
    return Response(content=raw, media_type="application/pdf", headers=headers)


@router.delete("/{assessment_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_rams_assessment_route(
    assessment_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    try:
        delete_assessment_hard(db_session, current_user, assessment_id)
    except RamsError as exc:
        _raise_http(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{assessment_id}", response_model=RamsAssessmentDetailResponse)
def get_rams_assessment(
    assessment_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> RamsAssessmentDetailResponse:
    try:
        return get_assessment_detail(db_session, current_user, assessment_id)
    except RamsError as exc:
        _raise_http(exc)


@router.patch("/{assessment_id}", response_model=RamsAssessmentDetailResponse)
def patch_rams_assessment(
    assessment_id: uuid.UUID,
    body: RamsAssessmentPatchRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> RamsAssessmentDetailResponse:
    try:
        return patch_assessment(db_session, current_user, assessment_id, body)
    except RamsError as exc:
        _raise_http(exc)
