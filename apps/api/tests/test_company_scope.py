"""Operational company scope for administrators and company admins."""

import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.core.company_scope import (
    COMPANY_ID_REQUIRED_MESSAGE,
    CompanyScopeError,
    resolve_operational_company_id,
)
from app.modules.auth.models import SystemRole, User
from app.modules.dashboard.service import DashboardError, build_management_summary


def _user(role: SystemRole, company_id: uuid.UUID | None) -> User:
    u = MagicMock(spec=User)
    u.system_role = role
    u.company_id = company_id
    return u


def test_administrator_requires_company_id() -> None:
    db = MagicMock()
    admin = _user(SystemRole.ADMINISTRATOR, None)
    with pytest.raises(CompanyScopeError, match="company_id is required"):
        resolve_operational_company_id(db, admin, None)


def test_administrator_with_company_id() -> None:
    db = MagicMock()
    cid = uuid.uuid4()
    admin = _user(SystemRole.ADMINISTRATOR, None)
    with patch("app.core.company_scope.get_company_by_id", return_value=MagicMock()):
        assert resolve_operational_company_id(db, admin, cid) == cid


def test_admin_forced_to_own_company() -> None:
    db = MagicMock()
    own = uuid.uuid4()
    admin = _user(SystemRole.ADMIN, own)
    assert resolve_operational_company_id(db, admin, None) == own


def test_admin_cannot_query_other_company() -> None:
    db = MagicMock()
    own = uuid.uuid4()
    other = uuid.uuid4()
    admin = _user(SystemRole.ADMIN, own)
    with pytest.raises(CompanyScopeError, match="another company"):
        resolve_operational_company_id(db, admin, other)


def test_dashboard_administrator_without_company_id_raises() -> None:
    db = MagicMock()
    admin = _user(SystemRole.ADMINISTRATOR, None)
    with patch(
        "app.modules.dashboard.service.assert_management_dashboard_actor",
    ):
        with pytest.raises(DashboardError, match="company_id is required"):
            build_management_summary(db, admin, company_id=None)


def test_dashboard_administrator_with_company_id_scoped() -> None:
    db = MagicMock()
    cid = uuid.uuid4()
    admin = _user(SystemRole.ADMINISTRATOR, None)
    with patch(
        "app.modules.dashboard.service.assert_management_dashboard_actor",
    ):
        with patch(
            "app.modules.dashboard.service._resolve_dashboard_company_id",
            return_value=cid,
        ):
            with patch(
                "app.modules.dashboard.service._live_block",
                return_value={
                    "live_open_shifts": 0,
                    "live_total_employees": 0,
                    "live_present_today": 0,
                    "live_attendance_rate": None,
                },
            ):
                with patch(
                    "app.modules.dashboard.service.dash_repo.count_active_employees_for_company",
                    return_value=1,
                ):
                    with patch(
                        "app.modules.dashboard.service.dash_repo.count_active_locations_for_company",
                        return_value=2,
                    ):
                        with patch(
                            "app.modules.dashboard.service.dash_repo.count_active_workplaces_for_company",
                            return_value=3,
                        ):
                            with patch(
                                "app.modules.dashboard.service._payroll_block_for_company",
                                return_value=("not_calculated", None, 0, None, None, None),
                            ):
                                summary = build_management_summary(db, admin, company_id=cid)
    assert summary.company_id == cid
    assert summary.aggregated_companies is False


def test_company_id_required_message_constant() -> None:
    assert "company_id is required" in COMPANY_ID_REQUIRED_MESSAGE
