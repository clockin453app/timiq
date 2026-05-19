"""PAYE tax-year rule loading safety: insert-only seeding, no silent overwrite."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.modules.auth.models import SystemRole, User
from app.modules.paye_payroll.calculation import tax_month_bounds
from app.modules.paye_payroll.models import MonthlyPayeItem, MonthlyPayePeriod, PayeTaxYearRule
from app.modules.paye_payroll.rules import (
    INCOMPLETE_TAX_YEAR_RULES_MESSAGE,
    SOURCE_NOTE,
    paye_rules_2026_2027,
    tax_year_rules_json_is_complete,
)
from app.modules.paye_payroll.service import (
    PayePayrollPermissionError,
    _ensure_tax_year_rule,
    recalculate_monthly_paye,
)


def _user(role: SystemRole, *, company_id: uuid.UUID | None = None) -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        company_id=company_id,
        email=f"{role.value}-{uuid.uuid4()}@example.com",
        password_hash="hashed",
        system_role=role,
        is_active=True,
        created_at=now,
        updated_at=now,
    )


def _period(company_id: uuid.UUID, *, status: str = "pending") -> MonthlyPayePeriod:
    now = datetime.now(timezone.utc)
    return MonthlyPayePeriod(
        id=uuid.uuid4(),
        company_id=company_id,
        tax_year="2026-2027",
        tax_month=1,
        period_start=tax_month_bounds("2026-2027", 1)[0],
        period_end=tax_month_bounds("2026-2027", 1)[1],
        pay_date=tax_month_bounds("2026-2027", 1)[1],
        status=status,
        created_at=now,
        updated_at=now,
    )


def _complete_rules_json() -> dict:
    return paye_rules_2026_2027()


def test_tax_year_rules_json_is_complete_requires_income_tax_and_ni() -> None:
    assert tax_year_rules_json_is_complete(_complete_rules_json()) is True
    assert tax_year_rules_json_is_complete({}) is False
    assert tax_year_rules_json_is_complete(None) is False
    assert tax_year_rules_json_is_complete({"income_tax": {}}) is False


def test_missing_2026_2027_row_inserts_builtin_rules_once() -> None:
    db = MagicMock()
    saved: list[PayeTaxYearRule] = []

    def _save(_db: MagicMock, row: PayeTaxYearRule) -> PayeTaxYearRule:
        saved.append(row)
        return row

    with patch("app.modules.paye_payroll.service.paye_repo.get_tax_year_rule", return_value=None):
        with patch("app.modules.paye_payroll.service.paye_repo.save_tax_year_rule", side_effect=_save):
            row = _ensure_tax_year_rule(db, "2026-2027")
    assert len(saved) == 1
    assert row.tax_year == "2026-2027"
    assert tax_year_rules_json_is_complete(row.rules_json)
    assert row.rules_json["tax_year"] == "2026-2027"
    assert row.rules_json["income_tax"]["personal_allowance_annual"] == "12570.00"
    assert row.source_note == SOURCE_NOTE


def test_existing_nonempty_rules_json_returned_unchanged() -> None:
    db = MagicMock()
    custom_rules = {
        "tax_year": "2026-2027",
        "income_tax": {"region": "custom"},
        "national_insurance": {"category": "A"},
    }
    existing = PayeTaxYearRule(
        tax_year="2026-2027",
        rules_json=custom_rules,
        source_note="Custom source note",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    with patch("app.modules.paye_payroll.service.paye_repo.get_tax_year_rule", return_value=existing):
        with patch("app.modules.paye_payroll.service.paye_repo.save_tax_year_rule") as mock_save:
            row = _ensure_tax_year_rule(db, "2026-2027")
    mock_save.assert_not_called()
    assert row is existing
    assert row.rules_json == custom_rules


def test_existing_source_note_is_not_overwritten() -> None:
    db = MagicMock()
    existing = PayeTaxYearRule(
        tax_year="2026-2027",
        rules_json=_complete_rules_json(),
        source_note="Imported from payroll admin 2026-03-01",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    with patch("app.modules.paye_payroll.service.paye_repo.get_tax_year_rule", return_value=existing):
        with patch("app.modules.paye_payroll.service.paye_repo.save_tax_year_rule") as mock_save:
            row = _ensure_tax_year_rule(db, "2026-2027")
    mock_save.assert_not_called()
    assert row.source_note == "Imported from payroll admin 2026-03-01"


def test_existing_empty_rules_json_raises_incomplete_rules_error() -> None:
    db = MagicMock()
    existing = PayeTaxYearRule(
        tax_year="2026-2027",
        rules_json={},
        source_note="Draft row",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    with patch("app.modules.paye_payroll.service.paye_repo.get_tax_year_rule", return_value=existing):
        with patch("app.modules.paye_payroll.service.paye_repo.save_tax_year_rule") as mock_save:
            with pytest.raises(PayePayrollPermissionError, match=INCOMPLETE_TAX_YEAR_RULES_MESSAGE):
                _ensure_tax_year_rule(db, "2026-2027")
    mock_save.assert_not_called()


def test_existing_incomplete_rules_json_raises_incomplete_rules_error() -> None:
    db = MagicMock()
    existing = PayeTaxYearRule(
        tax_year="2026-2027",
        rules_json={"income_tax": {"region": "draft"}},
        source_note="Draft row",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    with patch("app.modules.paye_payroll.service.paye_repo.get_tax_year_rule", return_value=existing):
        with patch("app.modules.paye_payroll.service.paye_repo.save_tax_year_rule") as mock_save:
            with pytest.raises(PayePayrollPermissionError, match=INCOMPLETE_TAX_YEAR_RULES_MESSAGE):
                _ensure_tax_year_rule(db, "2026-2027")
    mock_save.assert_not_called()


def test_unsupported_tax_year_raises_and_does_not_insert() -> None:
    db = MagicMock()
    with patch("app.modules.paye_payroll.service.paye_repo.get_tax_year_rule") as mock_get:
        with patch("app.modules.paye_payroll.service.paye_repo.save_tax_year_rule") as mock_save:
            with pytest.raises(PayePayrollPermissionError, match="2026-2027"):
                _ensure_tax_year_rule(db, "2025-2026")
    mock_get.assert_not_called()
    mock_save.assert_not_called()


def test_recalculate_errors_before_delete_pending_when_rules_incomplete() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    period = _period(company_id)
    incomplete = PayeTaxYearRule(
        tax_year="2026-2027",
        rules_json={},
        source_note=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db = MagicMock()
    with (
        patch("app.modules.paye_payroll.service.paye_repo.get_tax_year_rule", return_value=incomplete),
        patch("app.modules.paye_payroll.service.paye_repo.save_tax_year_rule") as mock_save,
        patch("app.modules.paye_payroll.service.paye_repo.delete_pending_items_for_period") as mock_delete,
        patch("app.modules.paye_payroll.service.paye_repo.clear_component_item_links_for_period") as mock_clear,
        patch("app.modules.paye_payroll.service._get_or_create_company_settings", return_value=SimpleNamespace()),
        patch("app.modules.paye_payroll.service.paye_repo.get_monthly_period", return_value=period),
    ):
        with pytest.raises(PayePayrollPermissionError, match=INCOMPLETE_TAX_YEAR_RULES_MESSAGE):
            recalculate_monthly_paye(
                db,
                actor,
                company_id=company_id,
                tax_year="2026-2027",
                tax_month=1,
            )
    mock_save.assert_not_called()
    mock_delete.assert_not_called()
    mock_clear.assert_not_called()


def test_recalculate_does_not_create_items_when_rules_incomplete() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    incomplete = PayeTaxYearRule(
        tax_year="2026-2027",
        rules_json={},
        source_note=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db = MagicMock()
    with (
        patch("app.modules.paye_payroll.service.paye_repo.get_tax_year_rule", return_value=incomplete),
        patch("app.modules.paye_payroll.service.paye_repo.get_monthly_period", return_value=None),
        patch("app.modules.paye_payroll.service._get_or_create_company_settings", return_value=SimpleNamespace()),
    ):
        with pytest.raises(PayePayrollPermissionError, match=INCOMPLETE_TAX_YEAR_RULES_MESSAGE):
            recalculate_monthly_paye(
                db,
                actor,
                company_id=company_id,
                tax_year="2026-2027",
                tax_month=1,
            )
    added_items = [call.args[0] for call in db.add.call_args_list if isinstance(call.args[0], MonthlyPayeItem)]
    assert added_items == []
