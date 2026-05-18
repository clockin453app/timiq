"""Company time policy access rules."""

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.modules.auth.models import SystemRole
from app.modules.companies.schemas import CompanyTimePolicyPatchRequest
from app.modules.companies.service import (
    CompanyTimePolicyPermissionError,
    assert_can_manage_company_time_policy,
    get_company_time_policy_for_actor,
    patch_company_time_policy,
)


def _user(role: SystemRole, company_id: uuid.UUID | None = None) -> MagicMock:
    user = MagicMock()
    user.system_role = role
    user.company_id = company_id
    user.id = uuid.uuid4()
    return user


def _policy(company_id: uuid.UUID) -> MagicMock:
    policy = MagicMock()
    policy.company_id = company_id
    policy.standard_start_time = "08:00"
    policy.overtime_after_hours = 8.5
    policy.overtime_multiplier = 1.5
    policy.rounding_increment_minutes = 30
    policy.rounding_mode = "nearest"
    policy.break_deduction_minutes = 30
    policy.break_deduction_after_minutes = 360
    policy.rule_effective_from = datetime(2026, 1, 1, tzinfo=timezone.utc)
    policy.rule_note = ""
    policy.timezone_name = "Europe/London"
    policy.created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    policy.updated_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return policy


def test_administrator_can_manage_any_company_time_policy() -> None:
    assert_can_manage_company_time_policy(_user(SystemRole.ADMINISTRATOR), uuid.uuid4())


def test_company_admin_can_manage_own_company_time_policy() -> None:
    company_id = uuid.uuid4()
    assert_can_manage_company_time_policy(_user(SystemRole.ADMIN, company_id), company_id)


def test_company_admin_cannot_manage_other_company_time_policy() -> None:
    with pytest.raises(CompanyTimePolicyPermissionError):
        assert_can_manage_company_time_policy(_user(SystemRole.ADMIN, uuid.uuid4()), uuid.uuid4())


def test_employee_cannot_manage_company_time_policy() -> None:
    with pytest.raises(CompanyTimePolicyPermissionError):
        assert_can_manage_company_time_policy(_user(SystemRole.EMPLOYEE, uuid.uuid4()), uuid.uuid4())


def test_company_admin_can_read_own_company_time_policy() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMIN, company_id)
    company = MagicMock()
    policy = _policy(company_id)
    with (
        patch("app.modules.companies.service.get_company_by_id", return_value=company),
        patch("app.modules.companies.service.ensure_company_time_policy", return_value=policy),
    ):
        response = get_company_time_policy_for_actor(MagicMock(), actor, company_id)
    assert response.company_id == company_id


def test_company_admin_can_patch_own_company_time_policy() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMIN, company_id)
    company = MagicMock()
    policy = _policy(company_id)
    with (
        patch("app.modules.companies.service.get_company_by_id", return_value=company),
        patch("app.modules.companies.service.ensure_company_time_policy", return_value=policy),
        patch("app.modules.companies.service.save_company_time_policy", return_value=policy),
    ):
        patch_company_time_policy(
            MagicMock(),
            actor,
            company_id,
            CompanyTimePolicyPatchRequest(standard_start_time="07:30"),
        )
    assert policy.standard_start_time == "07:30"


def test_company_admin_cannot_read_other_company_time_policy() -> None:
    with pytest.raises(CompanyTimePolicyPermissionError):
        get_company_time_policy_for_actor(
            MagicMock(),
            _user(SystemRole.ADMIN, uuid.uuid4()),
            uuid.uuid4(),
        )


def test_company_admin_cannot_patch_other_company_time_policy() -> None:
    with pytest.raises(CompanyTimePolicyPermissionError):
        patch_company_time_policy(
            MagicMock(),
            _user(SystemRole.ADMIN, uuid.uuid4()),
            uuid.uuid4(),
            CompanyTimePolicyPatchRequest(standard_start_time="07:30"),
        )


def test_employee_cannot_read_or_patch_company_time_policy() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.EMPLOYEE, company_id)
    with pytest.raises(CompanyTimePolicyPermissionError):
        get_company_time_policy_for_actor(MagicMock(), actor, company_id)
    with pytest.raises(CompanyTimePolicyPermissionError):
        patch_company_time_policy(
            MagicMock(),
            actor,
            company_id,
            CompanyTimePolicyPatchRequest(standard_start_time="07:30"),
        )
