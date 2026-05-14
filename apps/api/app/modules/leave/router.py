import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import get_current_user, require_admin_or_administrator
from app.modules.auth.models import User
from app.modules.leave.schemas import (
    LeaveAdminSummaryResponse,
    LeaveBalanceAdjustmentCreate,
    LeaveBalanceAdjustmentResponse,
    LeaveMeSummaryResponse,
    LeavePolicyPatchRequest,
    LeavePolicyResponse,
    LeaveRequestCreate,
    LeaveRequestRejectBody,
    LeaveRequestResponse,
)
from app.modules.leave.service import (
    LeaveError,
    LeavePermissionError,
    admin_cancel_leave_request,
    approve_leave_request,
    cancel_my_leave,
    create_balance_adjustment,
    create_leave_request_for_user,
    get_leave_policy,
    get_leave_request,
    leave_admin_summary,
    leave_me_summary,
    list_balance_adjustments_view,
    list_company_leave_requests,
    list_my_leave,
    patch_leave_policy,
    reject_leave_request,
)

router = APIRouter(prefix="/api/leave", tags=["leave"])


def _http_leave(exc: Exception) -> HTTPException:
    if isinstance(exc, LeavePermissionError):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    if isinstance(exc, LeaveError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Leave error.")


@router.get("/policy", response_model=LeavePolicyResponse)
def read_leave_policy(
    company_id: uuid.UUID = Query(...),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> LeavePolicyResponse:
    try:
        return get_leave_policy(db_session, current_user, company_id=company_id)
    except (LeaveError, LeavePermissionError) as exc:
        raise _http_leave(exc) from exc


@router.patch("/policy", response_model=LeavePolicyResponse)
def update_leave_policy(
    company_id: uuid.UUID = Query(...),
    body: LeavePolicyPatchRequest = ...,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> LeavePolicyResponse:
    try:
        return patch_leave_policy(db_session, current_user, company_id=company_id, body=body)
    except (LeaveError, LeavePermissionError) as exc:
        raise _http_leave(exc) from exc


@router.get("/me", response_model=list[LeaveRequestResponse])
def list_my_leave_requests(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> list[LeaveRequestResponse]:
    return list_my_leave(db_session, current_user)


@router.get("/me/summary", response_model=LeaveMeSummaryResponse)
def read_my_leave_summary(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> LeaveMeSummaryResponse:
    try:
        return leave_me_summary(db_session, current_user)
    except (LeaveError, LeavePermissionError) as exc:
        raise _http_leave(exc) from exc


@router.post("/me", response_model=LeaveRequestResponse)
def create_my_leave_request(
    body: LeaveRequestCreate,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> LeaveRequestResponse:
    if current_user.company_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No company assigned.")
    try:
        return create_leave_request_for_user(
            db_session,
            current_user,
            company_id=current_user.company_id,
            body=body,
        )
    except (LeaveError, LeavePermissionError) as exc:
        raise _http_leave(exc) from exc


@router.post("/me/{request_id}/cancel", response_model=LeaveRequestResponse)
def cancel_my_leave_request(
    request_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> LeaveRequestResponse:
    try:
        return cancel_my_leave(db_session, current_user, request_id)
    except (LeaveError, LeavePermissionError) as exc:
        raise _http_leave(exc) from exc


@router.get("/admin/summary", response_model=LeaveAdminSummaryResponse)
def read_leave_admin_summary(
    company_id: uuid.UUID = Query(...),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> LeaveAdminSummaryResponse:
    try:
        return leave_admin_summary(db_session, current_user, company_id=company_id)
    except (LeaveError, LeavePermissionError) as exc:
        raise _http_leave(exc) from exc


@router.get("/requests", response_model=list[LeaveRequestResponse])
def list_leave_requests(
    company_id: uuid.UUID = Query(...),
    status: str | None = Query(default=None),
    user_id: uuid.UUID | None = Query(default=None),
    leave_type: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[LeaveRequestResponse]:
    try:
        return list_company_leave_requests(
            db_session,
            current_user,
            company_id=company_id,
            status=status,
            user_id=user_id,
            leave_type=leave_type,
            date_from=date_from,
            date_to=date_to,
        )
    except (LeaveError, LeavePermissionError) as exc:
        raise _http_leave(exc) from exc


@router.post("/requests", response_model=LeaveRequestResponse)
def admin_create_leave_request(
    company_id: uuid.UUID = Query(...),
    body: LeaveRequestCreate = ...,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> LeaveRequestResponse:
    try:
        return create_leave_request_for_user(
            db_session,
            current_user,
            company_id=company_id,
            body=body,
        )
    except (LeaveError, LeavePermissionError) as exc:
        raise _http_leave(exc) from exc


@router.get("/requests/{request_id}", response_model=LeaveRequestResponse)
def read_leave_request(
    request_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> LeaveRequestResponse:
    try:
        return get_leave_request(db_session, current_user, request_id)
    except (LeaveError, LeavePermissionError) as exc:
        raise _http_leave(exc) from exc


@router.post("/requests/{request_id}/approve", response_model=LeaveRequestResponse)
def approve_leave_request_route(
    request_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> LeaveRequestResponse:
    try:
        return approve_leave_request(db_session, current_user, request_id)
    except (LeaveError, LeavePermissionError) as exc:
        raise _http_leave(exc) from exc


@router.post("/requests/{request_id}/reject", response_model=LeaveRequestResponse)
def reject_leave_request_route(
    request_id: uuid.UUID,
    body: LeaveRequestRejectBody = ...,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> LeaveRequestResponse:
    try:
        return reject_leave_request(db_session, current_user, request_id, body)
    except (LeaveError, LeavePermissionError) as exc:
        raise _http_leave(exc) from exc


@router.post("/requests/{request_id}/cancel", response_model=LeaveRequestResponse)
def admin_cancel_leave_request_route(
    request_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> LeaveRequestResponse:
    try:
        return admin_cancel_leave_request(db_session, current_user, request_id)
    except (LeaveError, LeavePermissionError) as exc:
        raise _http_leave(exc) from exc


@router.get("/balances", response_model=list[LeaveBalanceAdjustmentResponse])
def list_leave_balances_adjustments(
    company_id: uuid.UUID = Query(...),
    user_id: uuid.UUID | None = Query(default=None),
    leave_year: str | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[LeaveBalanceAdjustmentResponse]:
    try:
        return list_balance_adjustments_view(
            db_session,
            current_user,
            company_id=company_id,
            user_id=user_id,
            leave_year=leave_year,
        )
    except (LeaveError, LeavePermissionError) as exc:
        raise _http_leave(exc) from exc


@router.post("/balance-adjustments", response_model=LeaveBalanceAdjustmentResponse)
def post_leave_balance_adjustment(
    company_id: uuid.UUID = Query(...),
    body: LeaveBalanceAdjustmentCreate = ...,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> LeaveBalanceAdjustmentResponse:
    try:
        return create_balance_adjustment(db_session, current_user, company_id=company_id, body=body)
    except (LeaveError, LeavePermissionError) as exc:
        raise _http_leave(exc) from exc
