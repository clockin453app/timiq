"""HTTP routes for RAMS / digital risk assessments."""

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
from app.modules.rams.schemas import (
    RamsAcknowledgementResponse,
    RamsAcknowledgementsAddRequest,
    RamsAcknowledgeRequest,
    RamsAssessmentCreateRequest,
    RamsAssessmentDetailResponse,
    RamsAssessmentListItem,
    RamsAssessmentPatchRequest,
    RamsDeclineRequest,
    RamsHazardCreateRequest,
    RamsHazardPatchRequest,
    RamsHazardResponse,
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
    create_assessment,
    create_hazard,
    decline_assessment,
    delete_hazard,
    export_csv_bytes,
    get_assessment_detail,
    get_presets,
    list_acknowledgements_admin,
    list_assessments_admin,
    list_hazards,
    list_me,
    patch_assessment,
    patch_hazard,
    publish_assessment,
    render_print_html,
    review_assessment,
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
