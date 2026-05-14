import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.storage.file_response import protected_file_response
from app.db.session import get_db_session
from app.modules.accounting.export_service import run_budget_export, run_payroll_export
from app.modules.accounting.repository import get_export_mapping
from app.modules.accounting.schemas import (
    AccountingBudgetExportRequest,
    AccountingExportMappingPatchRequest,
    AccountingExportMappingResponse,
    AccountingExportRunListResponse,
    AccountingPayrollExportRequest,
    AccountingProvidersResponse,
    AccountingProviderExportType,
    AccountingProviderManifest,
    AccountingSettingsResponse,
    AccountingSettingsUpsertRequest,
)
from app.modules.accounting.service import (
    AccountingPermissionError,
    get_accounting_export_mapping,
    get_accounting_settings,
    list_accounting_export_runs,
    patch_accounting_export_mapping,
    resolve_accounting_company_for_export,
    save_accounting_settings,
)
from app.modules.auth.dependencies import require_admin_or_administrator
from app.modules.auth.models import SystemRole, User
from app.modules.budgets.repository import get_budget_project
from app.modules.payroll.permissions import PayrollPermissionError

router = APIRouter(prefix="/api/accounting", tags=["accounting"])


def _perm_http(exc: AccountingPermissionError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


def _payroll_perm_http(exc: PayrollPermissionError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


def _providers_response() -> AccountingProvidersResponse:
    et_pay_items = AccountingProviderExportType(id="payroll_items", label="Payroll line items")
    et_pay_sum = AccountingProviderExportType(id="payroll_summary", label="Payroll week summary")
    et_budget = AccountingProviderExportType(id="budget_costs", label="Budget costs (saved expenses)")
    return AccountingProvidersResponse(
        providers=[
            AccountingProviderManifest(
                id="generic_csv",
                label="Generic CSV (TimIQ columns)",
                export_types=[et_pay_items, et_pay_sum, et_budget],
            ),
            AccountingProviderManifest(
                id="xero",
                label="Xero-style CSV (export-ready)",
                export_types=[et_pay_items, et_pay_sum, et_budget],
            ),
            AccountingProviderManifest(
                id="quickbooks",
                label="QuickBooks-style CSV (export-ready)",
                export_types=[et_pay_items, et_pay_sum, et_budget],
            ),
            AccountingProviderManifest(
                id="sage",
                label="Sage-style CSV (export-ready)",
                export_types=[et_pay_items, et_pay_sum, et_budget],
            ),
        ],
    )


@router.get("/providers", response_model=AccountingProvidersResponse)
def read_providers(
    current_user: User = Depends(require_admin_or_administrator),
) -> AccountingProvidersResponse:
    _ = current_user
    return _providers_response()


@router.get("/export-runs", response_model=AccountingExportRunListResponse)
def read_export_runs(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
    company_id: uuid.UUID | None = Query(default=None, description="Required for global administrators."),
    limit: int = Query(default=50, ge=1, le=200),
) -> AccountingExportRunListResponse:
    try:
        return list_accounting_export_runs(db_session, current_user, company_id=company_id, limit=limit)
    except AccountingPermissionError as exc:
        raise _perm_http(exc) from exc


@router.get("/settings", response_model=AccountingSettingsResponse)
def read_settings(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
    company_id: uuid.UUID | None = Query(default=None, description="Required for global administrators."),
) -> AccountingSettingsResponse:
    try:
        return get_accounting_settings(db_session, current_user, company_id)
    except AccountingPermissionError as exc:
        raise _perm_http(exc) from exc


@router.put("/settings", response_model=AccountingSettingsResponse)
def put_settings(
    body: AccountingSettingsUpsertRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> AccountingSettingsResponse:
    try:
        return save_accounting_settings(db_session, current_user, body)
    except AccountingPermissionError as exc:
        raise _perm_http(exc) from exc


@router.get("/export-settings", response_model=AccountingExportMappingResponse)
def read_export_mapping(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
    company_id: uuid.UUID | None = Query(default=None, description="Required for global administrators."),
    provider: str = Query(..., description="xero | quickbooks | sage | generic_csv"),
) -> AccountingExportMappingResponse:
    try:
        return get_accounting_export_mapping(db_session, current_user, company_id=company_id, provider=provider)
    except AccountingPermissionError as exc:
        raise _perm_http(exc) from exc


@router.patch("/export-settings", response_model=AccountingExportMappingResponse)
def patch_export_mapping(
    body: AccountingExportMappingPatchRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> AccountingExportMappingResponse:
    try:
        return patch_accounting_export_mapping(db_session, current_user, body)
    except AccountingPermissionError as exc:
        raise _perm_http(exc) from exc


@router.post("/payroll/export.csv")
def post_payroll_export_csv(
    body: AccountingPayrollExportRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
):
    try:
        cid = resolve_accounting_company_for_export(
            current_user,
            body.company_id if current_user.system_role == SystemRole.ADMINISTRATOR else None,
        )
        mapping = get_export_mapping(db_session, cid, body.provider)
        csv_bytes, file_name = run_payroll_export(
            db_session,
            current_user,
            company_id=cid,
            body=body,
            mapping=mapping,
        )
    except AccountingPermissionError as exc:
        raise _perm_http(exc) from exc
    except PayrollPermissionError as exc:
        raise _payroll_perm_http(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return protected_file_response(
        body=csv_bytes,
        download_filename=file_name,
        media_type="text/csv; charset=utf-8",
    )


@router.post("/budgets/{budget_id}/export.csv")
def post_budget_export_csv(
    budget_id: uuid.UUID,
    body: AccountingBudgetExportRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
):
    try:
        proj = get_budget_project(db_session, budget_id)
        if proj is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found.")
        if current_user.system_role == SystemRole.ADMIN:
            if current_user.company_id is None or current_user.company_id != proj.company_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You cannot export another company's budget.",
                )
        mapping_row = get_export_mapping(db_session, proj.company_id, body.provider)
        csv_bytes, file_name = run_budget_export(
            db_session,
            current_user,
            budget_id=budget_id,
            body=body,
            mapping=mapping_row,
        )
    except HTTPException:
        raise
    except AccountingPermissionError as exc:
        raise _perm_http(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return protected_file_response(
        body=csv_bytes,
        download_filename=file_name,
        media_type="text/csv; charset=utf-8",
    )
