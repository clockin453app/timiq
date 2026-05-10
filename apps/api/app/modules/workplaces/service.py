import uuid

from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.companies.repository import get_company_by_id
from app.modules.workplaces.models import Workplace
from app.modules.workplaces.repository import (
    get_workplace_by_company_and_name,
    get_workplace_by_id,
    list_workplaces,
    list_workplaces_by_company,
    save_workplace,
    update_workplace,
)


class WorkplaceError(ValueError):
    pass


class WorkplaceNotFoundError(WorkplaceError):
    pass


class WorkplaceDuplicateError(WorkplaceError):
    pass


class WorkplacePermissionError(WorkplaceError):
    pass


class WorkplaceCompanyNotFoundError(WorkplaceError):
    pass


def list_workplaces_visible_to_user(db_session: Session, actor: User) -> list[Workplace]:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return list_workplaces(db_session)

    if actor.company_id is None:
        return []

    return list_workplaces_by_company(db_session, actor.company_id)


def resolve_workplace_company_id(
    db_session: Session,
    actor: User,
    requested_company_id: uuid.UUID | None,
) -> uuid.UUID:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        if requested_company_id is None:
            raise WorkplacePermissionError("Select a company for this workplace.")
        company = get_company_by_id(db_session, requested_company_id)
        if company is None or not company.is_active:
            raise WorkplaceCompanyNotFoundError("Company not found.")
        return requested_company_id

    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            raise WorkplacePermissionError("Your admin account is not assigned to a company.")
        return actor.company_id

    raise WorkplacePermissionError("You cannot manage workplaces.")


def create_workplace(
    db_session: Session,
    actor: User,
    company_id: uuid.UUID | None,
    name: str,
    code: str | None,
    address: str | None,
    is_active: bool,
) -> Workplace:
    resolved_company_id = resolve_workplace_company_id(db_session, actor, company_id)
    existing = get_workplace_by_company_and_name(db_session, resolved_company_id, name)
    if existing is not None:
        raise WorkplaceDuplicateError("A workplace with this name already exists.")

    workplace = Workplace(
        company_id=resolved_company_id,
        name=name,
        code=code,
        address=address,
        is_active=is_active,
    )
    return save_workplace(db_session, workplace)


def update_workplace_status(
    db_session: Session,
    actor: User,
    workplace_id: uuid.UUID,
    is_active: bool,
) -> Workplace:
    workplace = get_workplace_by_id(db_session, workplace_id)
    if workplace is None:
        raise WorkplaceNotFoundError("Workplace not found.")

    if actor.system_role == SystemRole.ADMINISTRATOR:
        workplace.is_active = is_active
        return update_workplace(db_session, workplace)

    if actor.system_role != SystemRole.ADMIN or actor.company_id != workplace.company_id:
        raise WorkplacePermissionError("You cannot update this workplace.")

    workplace.is_active = is_active
    return update_workplace(db_session, workplace)
