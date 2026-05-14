import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import get_current_user, require_admin_or_administrator
from app.modules.auth.models import User

from .schemas import (
    PrivacyAckRequest,
    PrivacyAckResponse,
    PrivacyAdminRequestDetailResponse,
    PrivacyAdminRequestListItem,
    PrivacyAdminRequestPatchRequest,
    PrivacyInventoryResponse,
    PrivacyMeRequestCancelRequest,
    PrivacyMeRequestCreateRequest,
    PrivacyMeRequestResponse,
    PrivacyMeSummaryResponse,
)
from .service import (
    CURRENT_POLICY_VERSION,
    PrivacyNotFoundError,
    PrivacyPermissionError,
    build_inventory,
    build_me_summary,
    close_management_request,
    get_management_request_detail,
    get_me_request,
    latest_ack,
    list_management_requests,
    list_me_requests,
    patch_management_request,
    patch_me_request_cancel,
    record_acknowledgement,
    submit_me_request,
)

router = APIRouter(prefix="/api/privacy", tags=["privacy"])


def _perm(exc: PrivacyPermissionError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


def _nf() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found.")


@router.get("/inventory", response_model=PrivacyInventoryResponse)
def read_privacy_inventory(
    current_user: User = Depends(get_current_user),
) -> PrivacyInventoryResponse:
    _ = current_user
    return build_inventory()


@router.get("/my-ack", response_model=PrivacyAckResponse | None)
def read_my_ack(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> PrivacyAckResponse | None:
    return latest_ack(db_session, current_user)


@router.post("/ack", response_model=PrivacyAckResponse)
def post_ack(
    body: PrivacyAckRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> PrivacyAckResponse:
    if body.policy_version.strip() != CURRENT_POLICY_VERSION:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unknown policy version. Refresh the page and try again.",
        )
    return record_acknowledgement(db_session, current_user, body.policy_version)


@router.get("/me/summary", response_model=PrivacyMeSummaryResponse)
def read_me_summary(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> PrivacyMeSummaryResponse:
    return build_me_summary(db_session, current_user)


@router.get("/me/requests", response_model=list[PrivacyMeRequestResponse])
def read_me_requests(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> list[PrivacyMeRequestResponse]:
    return list_me_requests(db_session, current_user, limit=limit, offset=offset)


@router.post("/me/requests", response_model=PrivacyMeRequestResponse)
def post_me_request(
    body: PrivacyMeRequestCreateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> PrivacyMeRequestResponse:
    try:
        return submit_me_request(db_session, current_user, body)
    except PrivacyPermissionError as exc:
        raise _perm(exc) from exc


@router.get("/me/requests/{request_id}", response_model=PrivacyMeRequestResponse)
def read_me_request(
    request_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> PrivacyMeRequestResponse:
    try:
        return get_me_request(db_session, current_user, request_id)
    except PrivacyNotFoundError as exc:
        raise _nf() from exc


@router.patch("/me/requests/{request_id}", response_model=PrivacyMeRequestResponse)
def patch_me_request(
    request_id: uuid.UUID,
    body: PrivacyMeRequestCancelRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> PrivacyMeRequestResponse:
    try:
        return patch_me_request_cancel(db_session, current_user, request_id, body)
    except PrivacyNotFoundError as exc:
        raise _nf() from exc
    except PrivacyPermissionError as exc:
        raise _perm(exc) from exc


@router.get("/requests", response_model=list[PrivacyAdminRequestListItem])
def read_management_requests(
    company_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[PrivacyAdminRequestListItem]:
    try:
        return list_management_requests(
            db_session,
            current_user,
            company_id=company_id,
            limit=limit,
            offset=offset,
        )
    except PrivacyPermissionError as exc:
        raise _perm(exc) from exc


@router.get("/requests/{request_id}", response_model=PrivacyAdminRequestDetailResponse)
def read_management_request(
    request_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> PrivacyAdminRequestDetailResponse:
    try:
        return get_management_request_detail(db_session, current_user, request_id)
    except PrivacyNotFoundError as exc:
        raise _nf() from exc


@router.patch("/requests/{request_id}", response_model=PrivacyAdminRequestDetailResponse)
def patch_management_request_route(
    request_id: uuid.UUID,
    body: PrivacyAdminRequestPatchRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> PrivacyAdminRequestDetailResponse:
    try:
        return patch_management_request(db_session, current_user, request_id, body)
    except PrivacyNotFoundError as exc:
        raise _nf() from exc
    except PrivacyPermissionError as exc:
        raise _perm(exc) from exc


@router.post("/requests/{request_id}/close", response_model=PrivacyAdminRequestDetailResponse)
def post_management_request_close(
    request_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> PrivacyAdminRequestDetailResponse:
    try:
        return close_management_request(db_session, current_user, request_id)
    except PrivacyNotFoundError as exc:
        raise _nf() from exc
    except PrivacyPermissionError as exc:
        raise _perm(exc) from exc
