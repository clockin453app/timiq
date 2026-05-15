"""Company default CIS rate and permission checks."""

import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.modules.companies.schemas import CompanyPayrollTaxPatchRequest
from app.modules.companies.service import (
    CompanyNotFoundError,
    CompanyTimePolicyPermissionError,
    patch_company_default_tax_rate,
)
from app.modules.auth.models import SystemRole


def _user(role: SystemRole, company_id: uuid.UUID | None = None) -> MagicMock:
    u = MagicMock()
    u.system_role = role
    u.company_id = company_id
    u.id = uuid.uuid4()
    return u


def test_patch_company_default_tax_rate_admin_own_company() -> None:
    cid = uuid.uuid4()
    actor = _user(SystemRole.ADMIN, cid)
    company = MagicMock()
    company.default_tax_rate = None
    session = MagicMock()

    with (
        patch("app.modules.companies.service.assert_can_manage_company_time_policy"),
        patch("app.modules.companies.service.get_company_by_id", return_value=company),
        patch("app.modules.companies.service.update_company", return_value=company),
        patch("app.modules.companies.service.CompanyResponse.model_validate", return_value=MagicMock()),
    ):
        patch_company_default_tax_rate(
            session,
            actor,
            cid,
            CompanyPayrollTaxPatchRequest(default_tax_rate=20),
        )
    assert company.default_tax_rate == 20.0


def test_patch_company_default_tax_rate_admin_other_company_denied() -> None:
    cid = uuid.uuid4()
    actor = _user(SystemRole.ADMIN, uuid.uuid4())
    session = MagicMock()

    with patch(
        "app.modules.companies.service.assert_can_manage_company_time_policy",
        side_effect=CompanyTimePolicyPermissionError("denied"),
    ):
        with pytest.raises(CompanyTimePolicyPermissionError):
            patch_company_default_tax_rate(
                session,
                actor,
                cid,
                CompanyPayrollTaxPatchRequest(default_tax_rate=15),
            )


def test_patch_company_default_tax_rate_company_not_found() -> None:
    cid = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    session = MagicMock()

    with (
        patch("app.modules.companies.service.assert_can_manage_company_time_policy"),
        patch("app.modules.companies.service.get_company_by_id", return_value=None),
    ):
        with pytest.raises(CompanyNotFoundError):
            patch_company_default_tax_rate(
                session,
                actor,
                cid,
                CompanyPayrollTaxPatchRequest(default_tax_rate=10),
            )
