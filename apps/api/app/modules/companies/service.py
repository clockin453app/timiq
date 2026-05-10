import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.auth.models import User
from app.modules.companies.models import Company
from app.modules.companies.repository import (
    get_company_by_id,
    get_company_by_name,
    save_company,
    update_company,
)
from app.modules.companies.schemas import CompanyCreateRequest, CompanyUpdateRequest


class CompanyError(ValueError):
    pass


class DuplicateCompanyError(CompanyError):
    pass


class CompanyNotFoundError(CompanyError):
    pass


class CompanyHasActiveUsersError(CompanyError):
    pass


def create_company(
    db_session: Session,
    request: CompanyCreateRequest,
) -> Company:
    existing_company = get_company_by_name(db_session, request.name)

    if existing_company is not None:
        raise DuplicateCompanyError("A company with this name already exists.")

    company = Company(
        name=request.name,
        is_active=request.is_active,
    )

    return save_company(db_session, company)


def update_company_details(
    db_session: Session,
    company_id: uuid.UUID,
    request: CompanyUpdateRequest,
) -> Company:
    company = get_company_by_id(db_session, company_id)

    if company is None:
        raise CompanyNotFoundError("Company not found.")

    existing_company = get_company_by_name(db_session, request.name)

    if existing_company is not None and existing_company.id != company.id:
        raise DuplicateCompanyError("A company with this name already exists.")

    company.name = request.name

    return update_company(db_session, company)


def company_has_active_users(db_session: Session, company_id: uuid.UUID) -> bool:
    statement = (
        select(User.id)
        .where(User.company_id == company_id)
        .where(User.is_active.is_(True))
        .limit(1)
    )

    return db_session.scalar(statement) is not None


def update_company_status(
    db_session: Session,
    company_id: uuid.UUID,
    is_active: bool,
) -> Company:
    company = get_company_by_id(db_session, company_id)

    if company is None:
        raise CompanyNotFoundError("Company not found.")

    if not is_active and company_has_active_users(db_session, company.id):
        raise CompanyHasActiveUsersError(
            "Deactivate all users in this company before deactivating the company."
        )

    company.is_active = is_active

    return update_company(db_session, company)