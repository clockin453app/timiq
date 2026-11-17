"""Pure company-ownership checks for later Finance services.

These helpers compare company ids only. They do not query the database,
authenticate users, or replace company-safe foreign keys.
"""

from __future__ import annotations

import uuid


class FinanceCompanyIsolationError(ValueError):
    pass


def assert_same_company(
    parent_company_id: uuid.UUID,
    child_company_id: uuid.UUID,
    *,
    child_name: str,
) -> None:
    """Reject a child row whose company differs from its parent."""
    if child_company_id != parent_company_id:
        raise FinanceCompanyIsolationError(
            f"{child_name} belongs to a different company."
        )


def shared_company_id(*company_ids: uuid.UUID) -> uuid.UUID:
    """Return the company id when every value is the same."""
    if not company_ids:
        raise FinanceCompanyIsolationError("A company id is required.")
    first = company_ids[0]
    for company_id in company_ids[1:]:
        if company_id != first:
            raise FinanceCompanyIsolationError("Company ids do not match.")
    return first
