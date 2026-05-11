import uuid
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import Company, CompanyTimePolicy
from app.modules.companies.repository import (
    get_company_by_id,
    get_company_by_name,
    get_company_time_policy,
    save_company,
    save_company_time_policy,
    update_company,
)
from app.modules.companies.schemas import (
    CompanyCreateRequest,
    CompanyPayrollTaxPatchRequest,
    CompanyResponse,
    CompanyTimePolicyPatchRequest,
    CompanyTimePolicyResponse,
    CompanyUpdateRequest,
)


class CompanyError(ValueError):
    pass


class DuplicateCompanyError(CompanyError):
    pass


class CompanyNotFoundError(CompanyError):
    pass


class CompanyHasActiveUsersError(CompanyError):
    pass


class CompanyTimePolicyPermissionError(CompanyError):
    pass


def company_time_policy_to_response(policy: CompanyTimePolicy) -> CompanyTimePolicyResponse:
    return CompanyTimePolicyResponse(
        company_id=policy.company_id,
        standard_start_time=policy.standard_start_time,
        overtime_after_hours=policy.overtime_after_hours,
        overtime_multiplier=policy.overtime_multiplier,
        rounding_increment_minutes=policy.rounding_increment_minutes,
        rounding_mode=policy.rounding_mode,
        break_deduction_minutes=policy.break_deduction_minutes,
        break_deduction_after_minutes=policy.break_deduction_after_minutes,
        rule_effective_from=policy.rule_effective_from,
        rule_note=policy.rule_note,
        timezone=policy.timezone_name,
        created_at=policy.created_at,
        updated_at=policy.updated_at,
    )


def assert_can_manage_company_time_policy(actor: User, company_id: uuid.UUID) -> None:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return

    if actor.system_role == SystemRole.ADMIN and actor.company_id == company_id:
        return

    raise CompanyTimePolicyPermissionError("You cannot manage this company's time policy.")


def ensure_company_time_policy(
    db_session: Session,
    company_id: uuid.UUID,
) -> CompanyTimePolicy:
    existing = get_company_time_policy(db_session, company_id)
    if existing is not None:
        return existing

    now = datetime.now(timezone.utc)
    policy = CompanyTimePolicy(
        company_id=company_id,
        rule_effective_from=now,
        break_deduction_after_minutes=360,
    )
    return save_company_time_policy(db_session, policy)


def get_company_time_policy_for_actor(
    db_session: Session,
    actor: User,
    company_id: uuid.UUID,
) -> CompanyTimePolicyResponse:
    assert_can_manage_company_time_policy(actor, company_id)

    company = get_company_by_id(db_session, company_id)
    if company is None:
        raise CompanyNotFoundError("Company not found.")

    policy = ensure_company_time_policy(db_session, company_id)
    return company_time_policy_to_response(policy)


def patch_company_default_tax_rate(
    db_session: Session,
    actor: User,
    company_id: uuid.UUID,
    request: CompanyPayrollTaxPatchRequest,
) -> CompanyResponse:
    assert_can_manage_company_time_policy(actor, company_id)
    company = get_company_by_id(db_session, company_id)
    if company is None:
        raise CompanyNotFoundError("Company not found.")
    if request.default_tax_rate is not None:
        company.default_tax_rate = float(request.default_tax_rate)
    else:
        company.default_tax_rate = None
    updated = update_company(db_session, company)
    return CompanyResponse.model_validate(updated)


def patch_company_time_policy(
    db_session: Session,
    actor: User,
    company_id: uuid.UUID,
    request: CompanyTimePolicyPatchRequest,
) -> CompanyTimePolicyResponse:
    assert_can_manage_company_time_policy(actor, company_id)

    company = get_company_by_id(db_session, company_id)
    if company is None:
        raise CompanyNotFoundError("Company not found.")

    policy = ensure_company_time_policy(db_session, company_id)

    data = request.model_dump(exclude_unset=True)
    if "timezone" in data:
        policy.timezone_name = data.pop("timezone")

    for key, value in data.items():
        setattr(policy, key, value)

    policy.updated_at = datetime.now(timezone.utc)
    updated = save_company_time_policy(db_session, policy)
    return company_time_policy_to_response(updated)


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