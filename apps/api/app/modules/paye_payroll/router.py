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
    MonthlyPayeReportShellResponse,
)
from app.modules.paye_payroll.service import (
    PayePayrollNotFoundError,
    PayePayrollPermissionError,
    monthly_paye_report_shell,
    patch_company_paye_settings,
    patch_employee_paye_settings,
    read_company_paye_settings,
    read_employee_paye_settings,
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


@router.get("/monthly-report", response_model=MonthlyPayeReportShellResponse)
def get_monthly_report_shell(
    company_id: uuid.UUID | None = Query(default=None),
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    employee_user_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> MonthlyPayeReportShellResponse:
    try:
        return monthly_paye_report_shell(
            db_session,
            current_user,
            company_id=company_id,
            year=year,
            month=month,
            employee_user_id=employee_user_id,
        )
    except (PayePayrollPermissionError, PayePayrollNotFoundError) as exc:
        raise _handle_error(exc) from exc
