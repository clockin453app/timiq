from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import require_admin_or_administrator
from app.modules.auth.models import User
from app.modules.paye_payroll.schemas import (
    CompanyPayeSettingsPatchRequest,
    CompanyPayeSettingsResponse,
    EmployeePayeSettingsPatchRequest,
    EmployeePayeSettingsResponse,
    PayeCapabilitiesResponse,
    MonthlyPayeRecalculateRequest,
    MonthlyPayeReportResponse,
    MonthlyPayeReportShellResponse,
)
from app.modules.paye_payroll.service import (
    PayePayrollNotFoundError,
    PayePayrollPermissionError,
    approve_monthly_paye_period,
    mark_monthly_paye_period_paid,
    monthly_paye_report,
    monthly_paye_report_shell,
    patch_company_paye_settings,
    patch_employee_paye_settings,
    read_paye_capabilities,
    read_company_paye_settings,
    read_employee_paye_settings,
    recalculate_monthly_paye,
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
