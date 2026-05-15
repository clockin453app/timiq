"""Budget labour filtering by operational site (location_id)."""

import uuid
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.modules.budgets.models import BudgetProject
from app.modules.budgets.saved_budgets import (
    _compute_labour_and_expenses,
    _validate_fk_scope,
    build_budget_labour_warnings,
)
from app.modules.auth.models import SystemRole, User


def _budget(
    *,
    location_id: uuid.UUID | None = None,
    workplace_id: uuid.UUID | None = None,
) -> BudgetProject:
    return BudgetProject(
        id=uuid.uuid4(),
        company_id=uuid.uuid4(),
        name="Test budget",
        description=None,
        workplace_id=workplace_id,
        location_id=location_id,
        client_name=None,
        reference_code=None,
        status="active",
        start_date=None,
        end_date=None,
        planned_budget_amount=1000.0,
        notes=None,
        created_by_user_id=None,
    )


def test_warnings_empty_when_operational_site_set() -> None:
    project = _budget(location_id=uuid.uuid4())
    assert build_budget_labour_warnings(project) == []


def test_warnings_workplace_only_requires_operational_site() -> None:
    project = _budget(workplace_id=uuid.uuid4())
    warnings = build_budget_labour_warnings(project)
    assert len(warnings) == 1
    assert "Operational site required" in warnings[0]


def test_warnings_no_site_selected() -> None:
    project = _budget()
    warnings = build_budget_labour_warnings(project)
    assert len(warnings) == 1
    assert "No operational site selected" in warnings[0]


def test_compute_labour_skips_shifts_without_location() -> None:
    project = _budget(workplace_id=uuid.uuid4())
    actor = MagicMock(spec=User)
    actor.system_role = SystemRole.ADMINISTRATOR
    db = MagicMock()

    with patch("app.modules.budgets.saved_budgets.ensure_company_time_policy") as policy_mock:
        policy = MagicMock()
        policy.timezone_name = "Europe/London"
        policy_mock.return_value = policy
        with patch("app.modules.budgets.saved_budgets.list_company_shifts_clock_in_window") as list_mock:
            totals, breakdown, _, _ = _compute_labour_and_expenses(db, actor, project)
            list_mock.assert_not_called()

    assert totals.total_labour_cost == Decimal("0.00")
    assert totals.finalized_labour_cost == Decimal("0.00")
    assert totals.estimated_labour_cost == Decimal("0.00")
    assert breakdown == []
    assert any("Operational site required" in w for w in totals.warnings)


def test_compute_labour_filters_by_location_id() -> None:
    site_id = uuid.uuid4()
    project = _budget(location_id=site_id)
    actor = MagicMock(spec=User)
    actor.system_role = SystemRole.ADMINISTRATOR
    db = MagicMock()

    with patch("app.modules.budgets.saved_budgets.ensure_company_time_policy") as policy_mock:
        policy = MagicMock()
        policy.timezone_name = "Europe/London"
        policy_mock.return_value = policy
        with patch("app.modules.budgets.saved_budgets.list_company_shifts_clock_in_window") as list_mock:
            list_mock.return_value = []
            totals, _, _, _ = _compute_labour_and_expenses(db, actor, project)
            list_mock.assert_called_once()
            assert list_mock.call_args.kwargs["location_id"] == site_id

    assert totals.warnings == []


def test_validate_fk_rejects_other_company_location() -> None:
    db = MagicMock()
    company_id = uuid.uuid4()
    other_company = uuid.uuid4()
    loc_id = uuid.uuid4()
    loc = MagicMock()
    loc.company_id = other_company
    db.get.return_value = loc

    with pytest.raises(HTTPException) as exc:
        _validate_fk_scope(db, company_id=company_id, location_id=loc_id, workplace_id=None)
    assert exc.value.status_code == 404


def test_validate_fk_rejects_other_company_workplace() -> None:
    db = MagicMock()
    company_id = uuid.uuid4()
    wp_id = uuid.uuid4()
    wp = MagicMock()
    wp.company_id = uuid.uuid4()
    with patch("app.modules.budgets.saved_budgets.get_workplace_by_id", return_value=wp):
        with pytest.raises(HTTPException) as exc:
            _validate_fk_scope(db, company_id=company_id, location_id=None, workplace_id=wp_id)
    assert exc.value.status_code == 404
