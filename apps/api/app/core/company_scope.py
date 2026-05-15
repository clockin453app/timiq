"""Operational company scope for management views (single company at a time)."""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.companies.repository import get_company_by_id

COMPANY_ID_REQUIRED_MESSAGE = "company_id is required for this view."


class CompanyScopeError(ValueError):
    pass


def resolve_operational_company_id(
    db_session: Session,
    actor: User,
    company_id: uuid.UUID | None,
) -> uuid.UUID:
    """
  Resolve the company for company-scoped operational data.

  - Company admin: always their own company; rejects other company_id values.
  - Administrator: company_id is required; must reference an existing company.
  """
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            raise CompanyScopeError("Admin user is not assigned to a company.")
        if company_id is not None and company_id != actor.company_id:
            raise CompanyScopeError("You cannot access another company's data.")
        return actor.company_id

    if actor.system_role == SystemRole.ADMINISTRATOR:
        if company_id is None:
            raise CompanyScopeError(COMPANY_ID_REQUIRED_MESSAGE)
        if get_company_by_id(db_session, company_id) is None:
            raise CompanyScopeError("Company not found.")
        return company_id

    raise CompanyScopeError("You do not have permission for this view.")
