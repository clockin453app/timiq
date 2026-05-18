from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.storage.file_response import protected_file_response
from app.db.session import get_db_session
from app.modules.auth.dependencies import require_admin_or_administrator, require_authenticated_employee_self_service
from app.modules.auth.models import User
from app.modules.paye_payroll.schemas import (
    CompanyPayeSettingsPatchRequest,
    CompanyPayeSettingsResponse,
    EmployeePayePayHistoryEntry,
    EmployeePayeSettingsPatchRequest,
    EmployeePayeSettingsResponse,
    PayePayComponentCreateRequest,
    PayePayComponentPatchRequest,
    PayePayComponentResponse,
    PayeCapabilitiesResponse,
    MonthlyPayeRecalculateRequest,
    MonthlyPayeReportResponse,
    MonthlyPayeReportShellResponse,
)
from app.modules.paye_payroll.service import (
    PayePayrollNotFoundError,
    PayePayrollPermissionError,
    approve_monthly_paye_period,
    create_pay_component,
    delete_pay_component,
    list_pay_components,
    list_my_paye_pay_history,
    mark_monthly_paye_period_paid,
    monthly_paye_report,
    monthly_paye_report_shell,
    patch_company_paye_settings,
    patch_employee_paye_settings,
    patch_pay_component,
    read_paye_capabilities,
    read_company_paye_settings,
    read_employee_paye_settings,
    recalculate_monthly_paye,
    render_monthly_paye_payslip_html,
    render_monthly_paye_payslip_pdf,
    render_own_monthly_paye_payslip_html,
    render_own_monthly_paye_payslip_pdf,
    undo_paid_monthly_paye_period,
)

router = APIRouter(prefix="/api/paye-payroll", tags=["paye-payroll"])


def _handle_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PayePayrollPermissionError):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    if isinstance(exc, PayePayrollNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.get("/employee-settings/{user_id}", response_model=EmployeePayeSettingsResponse)
def get_employee_settings(
    user_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> EmployeePayeSettingsResponse:
    try:
        return read_employee_paye_settings(db_session, current_user, user_id)
    except (PayePayrollPermissionError, PayePayrollNotFoundError) as exc:
        raise _handle_error(exc) from exc


@router.get("/capabilities", response_model=PayeCapabilitiesResponse)
def get_capabilities(
    current_user: User = Depends(require_admin_or_administrator),
) -> PayeCapabilitiesResponse:
    try:
        return read_paye_capabilities(current_user)
    except PayePayrollPermissionError as exc:
        raise _handle_error(exc) from exc


@router.patch("/employee-settings/{user_id}", response_model=EmployeePayeSettingsResponse)
def patch_employee_settings(
    user_id: uuid.UUID,
    request: EmployeePayeSettingsPatchRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> EmployeePayeSettingsResponse:
    try:
        return patch_employee_paye_settings(db_session, current_user, user_id, request)
    except (PayePayrollPermissionError, PayePayrollNotFoundError) as exc:
        raise _handle_error(exc) from exc


@router.get("/company-settings", response_model=CompanyPayeSettingsResponse)
def get_company_settings(
    company_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> CompanyPayeSettingsResponse:
    try:
        return read_company_paye_settings(db_session, current_user, company_id)
    except (PayePayrollPermissionError, PayePayrollNotFoundError) as exc:
        raise _handle_error(exc) from exc


@router.get("/pay-components", response_model=list[PayePayComponentResponse])
def get_pay_components(
    company_id: uuid.UUID | None = Query(default=None),
    tax_year: str = Query(..., min_length=9, max_length=9),
    tax_month: int = Query(..., ge=1, le=12),
    user_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[PayePayComponentResponse]:
    try:
        return list_pay_components(
            db_session,
            current_user,
            company_id=company_id,
            tax_year=tax_year,
            tax_month=tax_month,
            user_id=user_id,
        )
    except (PayePayrollPermissionError, PayePayrollNotFoundError) as exc:
        raise _handle_error(exc) from exc


@router.post("/pay-components", response_model=PayePayComponentResponse)
def post_pay_component(
    request: PayePayComponentCreateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> PayePayComponentResponse:
    try:
        return create_pay_component(db_session, current_user, request)
    except (PayePayrollPermissionError, PayePayrollNotFoundError) as exc:
        raise _handle_error(exc) from exc


@router.patch("/pay-components/{component_id}", response_model=PayePayComponentResponse)
def patch_pay_component_endpoint(
    component_id: uuid.UUID,
    request: PayePayComponentPatchRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> PayePayComponentResponse:
    try:
        return patch_pay_component(db_session, current_user, component_id, request)
    except (PayePayrollPermissionError, PayePayrollNotFoundError) as exc:
        raise _handle_error(exc) from exc


@router.delete("/pay-components/{component_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pay_component_endpoint(
    component_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    try:
        delete_pay_component(db_session, current_user, component_id)
    except (PayePayrollPermissionError, PayePayrollNotFoundError) as exc:
        raise _handle_error(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/company-settings", response_model=CompanyPayeSettingsResponse)
def patch_company_settings(
    request: CompanyPayeSettingsPatchRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> CompanyPayeSettingsResponse:
    try:
        return patch_company_paye_settings(db_session, current_user, request)
    except (PayePayrollPermissionError, PayePayrollNotFoundError) as exc:
        raise _handle_error(exc) from exc


@router.get("/monthly-report", response_model=MonthlyPayeReportResponse)
def get_monthly_report(
    company_id: uuid.UUID | None = Query(default=None),
    tax_year: str | None = Query(default=None),
    tax_month: int | None = Query(default=None, ge=1, le=12),
    employee_id: uuid.UUID | None = Query(default=None),
    year: int | None = Query(default=None, ge=2000, le=2100),
    month: int | None = Query(default=None, ge=1, le=12),
    employee_user_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> MonthlyPayeReportResponse:
    try:
        resolved_tax_year = tax_year or "2026-2027"
        resolved_tax_month = tax_month or month
        if resolved_tax_month is None:
            raise PayePayrollPermissionError("Select a PAYE tax month.")
        return monthly_paye_report(
            db_session,
            current_user,
            company_id=company_id,
            tax_year=resolved_tax_year,
            tax_month=resolved_tax_month,
            employee_id=employee_id or employee_user_id,
        )
    except (PayePayrollPermissionError, PayePayrollNotFoundError) as exc:
        raise _handle_error(exc) from exc


@router.get("/me/pay-history", response_model=list[EmployeePayePayHistoryEntry])
def get_my_paye_pay_history(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee_self_service),
) -> list[EmployeePayePayHistoryEntry]:
    return list_my_paye_pay_history(db_session, current_user)


@router.get("/me/items/{item_id}/payslip")
def get_my_monthly_paye_payslip(
    item_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee_self_service),
) -> Response:
    try:
        body = render_own_monthly_paye_payslip_html(db_session, current_user, item_id)
    except (PayePayrollPermissionError, PayePayrollNotFoundError) as exc:
        raise _handle_error(exc) from exc
    return Response(
        content=body,
        media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": f'inline; filename="paye-payslip-{item_id}.html"'},
    )


@router.get("/me/items/{item_id}/payslip.pdf")
def get_my_monthly_paye_payslip_pdf(
    item_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee_self_service),
) -> Response:
    try:
        body, filename = render_own_monthly_paye_payslip_pdf(db_session, current_user, item_id)
    except (PayePayrollPermissionError, PayePayrollNotFoundError) as exc:
        raise _handle_error(exc) from exc
    return protected_file_response(body=body, download_filename=filename, media_type="application/pdf")


@router.get("/items/{item_id}/payslip")
def get_monthly_paye_payslip(
    item_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    try:
        body = render_monthly_paye_payslip_html(db_session, current_user, item_id)
    except (PayePayrollPermissionError, PayePayrollNotFoundError) as exc:
        raise _handle_error(exc) from exc
    return Response(
        content=body,
        media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": f'inline; filename="paye-payslip-{item_id}.html"'},
    )


@router.get("/items/{item_id}/payslip.pdf")
def get_monthly_paye_payslip_pdf(
    item_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    try:
        body, filename = render_monthly_paye_payslip_pdf(db_session, current_user, item_id)
    except (PayePayrollPermissionError, PayePayrollNotFoundError) as exc:
        raise _handle_error(exc) from exc
    return protected_file_response(body=body, download_filename=filename, media_type="application/pdf")


@router.post("/monthly-report/recalculate", response_model=MonthlyPayeReportResponse)
def recalculate_monthly_report(
    request: MonthlyPayeRecalculateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> MonthlyPayeReportResponse:
    try:
        return recalculate_monthly_paye(
            db_session,
            current_user,
            company_id=request.company_id,
            tax_year=request.tax_year,
            tax_month=request.tax_month,
        )
    except (PayePayrollPermissionError, PayePayrollNotFoundError) as exc:
        raise _handle_error(exc) from exc


@router.post("/periods/{period_id}/approve", response_model=MonthlyPayeReportResponse)
def approve_period(
    period_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> MonthlyPayeReportResponse:
    try:
        return approve_monthly_paye_period(db_session, current_user, period_id)
    except (PayePayrollPermissionError, PayePayrollNotFoundError) as exc:
        raise _handle_error(exc) from exc


@router.post("/periods/{period_id}/mark-paid", response_model=MonthlyPayeReportResponse)
def mark_period_paid(
    period_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> MonthlyPayeReportResponse:
    try:
        return mark_monthly_paye_period_paid(db_session, current_user, period_id)
    except (PayePayrollPermissionError, PayePayrollNotFoundError) as exc:
        raise _handle_error(exc) from exc


@router.post("/periods/{period_id}/undo-paid", response_model=MonthlyPayeReportResponse)
def undo_period_paid(
    period_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> MonthlyPayeReportResponse:
    try:
        return undo_paid_monthly_paye_period(db_session, current_user, period_id)
    except (PayePayrollPermissionError, PayePayrollNotFoundError) as exc:
        raise _handle_error(exc) from exc
