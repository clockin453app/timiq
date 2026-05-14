import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import require_admin_or_administrator
from app.modules.auth.models import User
from app.modules.payroll_policies.schemas import (
    SitePayrollPolicyEffectiveResponse,
    SitePayrollPolicyListResponse,
    SitePayrollPolicyUpsertRequest,
)
from app.modules.payroll_policies.service import (
    PayrollPolicyPermissionError,
    delete_site_policy,
    get_site_policy_effective,
    list_site_policies,
    put_site_policy,
)

router = APIRouter(prefix="/api/payroll-policies", tags=["payroll-policies"])


def _perm(exc: PayrollPolicyPermissionError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


@router.get("/sites", response_model=SitePayrollPolicyListResponse)
def read_site_policies(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
    company_id: uuid.UUID | None = Query(default=None, description="Required for global administrators."),
) -> SitePayrollPolicyListResponse:
    try:
        return list_site_policies(db_session, current_user, company_id=company_id)
    except PayrollPolicyPermissionError as exc:
        raise _perm(exc) from exc


@router.get("/sites/{location_id}", response_model=SitePayrollPolicyEffectiveResponse)
def read_site_policy(
    location_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
    company_id: uuid.UUID | None = Query(default=None, description="Required for global administrators."),
) -> SitePayrollPolicyEffectiveResponse:
    try:
        return get_site_policy_effective(
            db_session,
            current_user,
            company_id=company_id,
            location_id=location_id,
        )
    except PayrollPolicyPermissionError as exc:
        raise _perm(exc) from exc


@router.put("/sites/{location_id}", response_model=SitePayrollPolicyEffectiveResponse)
def put_site_policy_route(
    location_id: uuid.UUID,
    body: SitePayrollPolicyUpsertRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
    company_id: uuid.UUID | None = Query(default=None, description="Required for global administrators."),
) -> SitePayrollPolicyEffectiveResponse:
    try:
        return put_site_policy(
            db_session,
            current_user,
            company_id=company_id,
            location_id=location_id,
            body=body,
        )
    except PayrollPolicyPermissionError as exc:
        raise _perm(exc) from exc


@router.delete("/sites/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_site_policy_route(
    location_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
    company_id: uuid.UUID | None = Query(default=None, description="Required for global administrators."),
) -> Response:
    try:
        delete_site_policy(
            db_session,
            current_user,
            company_id=company_id,
            location_id=location_id,
        )
    except PayrollPolicyPermissionError as exc:
        raise _perm(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
