import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import (
    require_admin_or_administrator,
    require_administrator,
)
from app.modules.auth.models import SystemRole, User
from app.modules.companies.repository import get_company_by_id, list_companies
from app.modules.companies.schemas import (
    CompanyCreateRequest,
    CompanyResponse,
    CompanyStatusUpdateRequest,
    CompanyUpdateRequest,
)
from app.modules.companies.service import (
    CompanyHasActiveUsersError,
    CompanyNotFoundError,
    DuplicateCompanyError,
    create_company,
    update_company_details,
    update_company_status,
)

router = APIRouter(prefix="/api/companies", tags=["companies"])


@router.get("", response_model=list[CompanyResponse])
def get_companies(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[CompanyResponse]:
    if current_user.system_role == SystemRole.ADMINISTRATOR:
        companies = list_companies(db_session)
        return [CompanyResponse.model_validate(company) for company in companies]

    if current_user.company_id is None:
        return []

    company = get_company_by_id(db_session, current_user.company_id)

    if company is None:
        return []

    return [CompanyResponse.model_validate(company)]


@router.post(
    "",
    response_model=CompanyResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_managed_company(
    request: CompanyCreateRequest,
    db_session: Session = Depends(get_db_session),
    _current_user: User = Depends(require_administrator),
) -> CompanyResponse:
    try:
        company = create_company(db_session, request)
    except DuplicateCompanyError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A company with this name already exists.",
        ) from exc

    return CompanyResponse.model_validate(company)


@router.patch("/{company_id}", response_model=CompanyResponse)
def update_managed_company(
    company_id: uuid.UUID,
    request: CompanyUpdateRequest,
    db_session: Session = Depends(get_db_session),
    _current_user: User = Depends(require_administrator),
) -> CompanyResponse:
    try:
        company = update_company_details(
            db_session=db_session,
            company_id=company_id,
            request=request,
        )
    except CompanyNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found.",
        ) from exc
    except DuplicateCompanyError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A company with this name already exists.",
        ) from exc

    return CompanyResponse.model_validate(company)


@router.patch("/{company_id}/status", response_model=CompanyResponse)
def update_managed_company_status(
    company_id: uuid.UUID,
    request: CompanyStatusUpdateRequest,
    db_session: Session = Depends(get_db_session),
    _current_user: User = Depends(require_administrator),
) -> CompanyResponse:
    try:
        company = update_company_status(
            db_session=db_session,
            company_id=company_id,
            is_active=request.is_active,
        )
    except CompanyNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found.",
        ) from exc
    except CompanyHasActiveUsersError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc

    return CompanyResponse.model_validate(company)