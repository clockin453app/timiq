import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import get_current_user, require_admin_or_administrator
from app.modules.auth.models import User
from app.modules.payroll.schemas import (
    PayHistoryEntry,
    PayrollApproveAllRequest,
    PayrollItemPatchRequest,
    PayrollItemResponse,
    PayrollMonthSummaryResponse,
    PayrollRecalculateRequest,
    PayrollReportResponse,
)
from app.modules.payroll.service import (
    PayrollApprovedBlockingError,
    PayrollError,
    PayrollItemStateError,
    PayrollPaidBlockingError,
    PayrollPermissionError,
    approve_all_pending,
    approve_item,
    export_csv_report,
    export_print_html,
    get_payroll_month_summary,
    get_payroll_report,
    list_my_pay_history,
    mark_paid_item,
    patch_payroll_item,
    recalculate_payroll,
    unlock_item,
)

router = APIRouter(prefix="/api/payroll", tags=["payroll"])


def _handle_payroll_exc(exc: Exception) -> HTTPException:
    if isinstance(exc, (PayrollPaidBlockingError, PayrollApprovedBlockingError)):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if isinstance(exc, PayrollItemStateError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    if isinstance(exc, PayrollPermissionError):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    if isinstance(exc, PayrollError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Payroll error.")


@router.get("/report", response_model=PayrollReportResponse)
def payroll_report(
    company_id: uuid.UUID = Query(...),
    week_start: date = Query(...),
    user_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> PayrollReportResponse:
    try:
        return get_payroll_report(
            db_session,
            current_user,
            company_id=company_id,
            week_start=week_start,
            user_id=user_id,
        )
    except PayrollPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except PayrollError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.get("/month-summary", response_model=PayrollMonthSummaryResponse)
def payroll_month_summary(
    company_id: uuid.UUID = Query(...),
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> PayrollMonthSummaryResponse:
    try:
        return get_payroll_month_summary(
            db_session,
            current_user,
            company_id=company_id,
            year=year,
            month=month,
        )
    except PayrollPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except PayrollError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.post("/recalculate", response_model=PayrollReportResponse)
def payroll_recalculate(
    request: PayrollRecalculateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> PayrollReportResponse:
    try:
        return recalculate_payroll(
            db_session,
            current_user,
            company_id=request.company_id,
            week_start=request.week_start,
        )
    except (
        PayrollApprovedBlockingError,
        PayrollPaidBlockingError,
        PayrollPermissionError,
        PayrollError,
    ) as exc:
        raise _handle_payroll_exc(exc) from exc


@router.patch("/items/{item_id}", response_model=PayrollItemResponse)
def payroll_patch_item(
    item_id: uuid.UUID,
    request: PayrollItemPatchRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> PayrollItemResponse:
    try:
        return patch_payroll_item(db_session, current_user, item_id, request)
    except (PayrollPermissionError, PayrollError) as exc:
        raise _handle_payroll_exc(exc) from exc


@router.post("/items/{item_id}/approve", response_model=PayrollItemResponse)
def payroll_approve_item(
    item_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> PayrollItemResponse:
    try:
        return approve_item(db_session, current_user, item_id)
    except (PayrollPermissionError, PayrollItemStateError, PayrollError) as exc:
        raise _handle_payroll_exc(exc) from exc


@router.post("/items/{item_id}/unlock", response_model=PayrollItemResponse)
def payroll_unlock_item(
    item_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> PayrollItemResponse:
    try:
        return unlock_item(db_session, current_user, item_id)
    except (PayrollPermissionError, PayrollItemStateError, PayrollError) as exc:
        raise _handle_payroll_exc(exc) from exc


@router.post("/items/{item_id}/mark-paid", response_model=PayrollItemResponse)
def payroll_mark_paid(
    item_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> PayrollItemResponse:
    try:
        return mark_paid_item(db_session, current_user, item_id)
    except (PayrollPermissionError, PayrollItemStateError, PayrollError) as exc:
        raise _handle_payroll_exc(exc) from exc


@router.post("/approve-all", response_model=PayrollReportResponse)
def payroll_approve_all(
    request: PayrollApproveAllRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> PayrollReportResponse:
    try:
        return approve_all_pending(
            db_session,
            current_user,
            company_id=request.company_id,
            week_start=request.week_start,
        )
    except (PayrollPermissionError, PayrollError) as exc:
        raise _handle_payroll_exc(exc) from exc


@router.get("/pay-history/me", response_model=list[PayHistoryEntry])
def payroll_pay_history_me(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> list[PayHistoryEntry]:
    return list_my_pay_history(db_session, current_user)


@router.get("/export.csv")
def payroll_export_csv(
    company_id: uuid.UUID = Query(...),
    week_start: date = Query(...),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    try:
        body = export_csv_report(
            db_session,
            current_user,
            company_id=company_id,
            week_start=week_start,
        )
    except PayrollPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    filename = f"payroll-{company_id}-{week_start}.csv"
    return Response(
        content=body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export.pdf")
def payroll_export_pdf(
    company_id: uuid.UUID = Query(...),
    week_start: date = Query(...),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    """Print-ready HTML; use browser Print to PDF."""
    try:
        html = export_print_html(
            db_session,
            current_user,
            company_id=company_id,
            week_start=week_start,
        )
    except PayrollPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    return Response(
        content=html,
        media_type="text/html; charset=utf-8",
        headers={
            "Content-Disposition": f'inline; filename="payroll-{company_id}-{week_start}.html"',
        },
    )
