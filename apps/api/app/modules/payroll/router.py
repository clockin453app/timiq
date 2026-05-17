import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.export_csv import safe_export_filename
from app.core.storage.file_response import content_disposition_attachment, protected_file_response

from app.db.session import get_db_session
from app.modules.auth.dependencies import (
    get_current_user,
    require_admin_or_administrator,
    require_authenticated_employee_self_service,
)
from app.modules.auth.models import User
from app.modules.payroll.schemas import (
    PayHistoryEntry,
    PayrollApproveAllRequest,
    PayrollItemPatchRequest,
    PayrollItemResponse,
    PayrollItemSummaryResponse,
    PayrollLateAdjustmentRequest,
    PayrollMonthSummaryResponse,
    PayrollPaymentHistoryRow,
    PayrollRecalculateRequest,
    PayrollReportResponse,
    PayrollUndoPaidRequest,
)
from app.modules.payroll.service import (
    PayrollApprovedBlockingError,
    PayrollError,
    PayrollItemNotFoundError,
    PayrollItemStateError,
    PayrollPaidBlockingError,
    PayrollPermissionError,
    approve_all_pending,
    approve_item,
    create_late_shift_adjustment_from_paid_item,
    export_csv_report,
    export_pdf_report,
    export_print_html,
    get_payroll_item_summary,
    get_payroll_month_summary,
    get_payroll_report,
    list_payroll_payment_history,
    list_my_pay_history,
    mark_paid_item,
    patch_payroll_item,
    recalculate_payroll,
    render_payroll_item_payslip_html,
    undo_paid_item,
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


@router.get("/payment-history", response_model=list[PayrollPaymentHistoryRow])
def payroll_payment_history(
    company_id: uuid.UUID = Query(...),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    employee_user_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[PayrollPaymentHistoryRow]:
    try:
        return list_payroll_payment_history(
            db_session,
            current_user,
            company_id=company_id,
            date_from=date_from,
            date_to=date_to,
            employee_user_id=employee_user_id,
        )
    except PayrollPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except PayrollError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


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


@router.post("/items/{item_id}/undo-paid", response_model=PayrollItemResponse)
def payroll_undo_paid(
    item_id: uuid.UUID,
    request: PayrollUndoPaidRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> PayrollItemResponse:
    try:
        return undo_paid_item(db_session, current_user, item_id, request)
    except (PayrollPermissionError, PayrollItemStateError, PayrollError) as exc:
        raise _handle_payroll_exc(exc) from exc


@router.post("/items/{item_id}/adjustment-for-late-shifts", response_model=PayrollItemResponse)
def payroll_adjustment_for_late_shifts(
    item_id: uuid.UUID,
    request: PayrollLateAdjustmentRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> PayrollItemResponse:
    try:
        return create_late_shift_adjustment_from_paid_item(db_session, current_user, item_id, request)
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
    current_user: User = Depends(require_authenticated_employee_self_service),
) -> list[PayHistoryEntry]:
    return list_my_pay_history(db_session, current_user)


@router.get("/items/{item_id}/summary", response_model=PayrollItemSummaryResponse)
def payroll_item_summary(
    item_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee_self_service),
) -> PayrollItemSummaryResponse:
    try:
        return get_payroll_item_summary(db_session, current_user, item_id)
    except PayrollItemNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except PayrollPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc


@router.get("/items/{item_id}/payslip")
def payroll_item_payslip(
    item_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee_self_service),
) -> Response:
    try:
        body = render_payroll_item_payslip_html(db_session, current_user, item_id)
    except PayrollItemNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except PayrollPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    return Response(
        content=body,
        media_type="text/html; charset=utf-8",
        headers={
            "Content-Disposition": f'inline; filename="payslip-{item_id}.html"',
        },
    )


@router.get("/export.csv")
def payroll_export_csv(
    company_id: uuid.UUID = Query(...),
    week_start: date | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    employee_user_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    if date_from is None and date_to is None and week_start is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="week_start or date range required.")
    if (date_from is None) != (date_to is None):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="date_from and date_to are required together.")
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="date_from must be before or equal to date_to.")
    try:
        body = export_csv_report(
            db_session,
            current_user,
            company_id=company_id,
            week_start=week_start,
            date_from=date_from,
            date_to=date_to,
            employee_user_id=employee_user_id,
        )
    except PayrollPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except PayrollError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    filename_date = f"{date_from}_to_{date_to}" if date_from and date_to else str(week_start)
    filename = safe_export_filename("payroll", str(company_id), filename_date) + ".csv"
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": content_disposition_attachment(filename)},
    )


@router.get("/export.print")
def payroll_export_print(
    company_id: uuid.UUID = Query(...),
    week_start: date = Query(...),
    user_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    """Print-ready HTML; use browser Print to save as PDF."""
    try:
        html = export_print_html(
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
    return Response(
        content=html,
        media_type="text/html; charset=utf-8",
        headers={
            "Content-Disposition": f'inline; filename="payroll-{company_id}-{week_start}.html"',
        },
    )


@router.get("/export.pdf")
def payroll_export_pdf(
    company_id: uuid.UUID = Query(...),
    week_start: date | None = Query(default=None),
    user_id: uuid.UUID | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    employee_user_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    if date_from is None and date_to is None and week_start is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="week_start or date range required.")
    if (date_from is None) != (date_to is None):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="date_from and date_to are required together.")
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="date_from must be before or equal to date_to.")
    try:
        body = export_pdf_report(
            db_session,
            current_user,
            company_id=company_id,
            week_start=week_start,
            user_id=user_id,
            date_from=date_from,
            date_to=date_to,
            employee_user_id=employee_user_id,
        )
    except PayrollPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except PayrollError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    filename_date = f"{date_from.isoformat()}-to-{date_to.isoformat()}" if date_from and date_to else week_start.isoformat()
    filename = f"timiq-payroll-report-{filename_date}.pdf"
    return protected_file_response(
        body=body,
        download_filename=filename,
        media_type="application/pdf",
    )
