"""CVR-2 service isolation and composition.

Pure Decimal cases run on any interpreter. Service/router cases require a
SQLAlchemy version compatible with Finance models (Python 3.12 + project deps).
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest

from app.modules.finance.cvr_as_of import DatedMoney, compose_as_of_cvr, sum_as_of
from app.modules.finance.cvr_forecast import MISSING


def test_sum_as_of_never_crosses_companies_with_same_project_name_ids() -> None:
    company_a = uuid.uuid4()
    company_b = uuid.uuid4()
    project_a = uuid.uuid4()
    project_b = uuid.uuid4()
    facts = [
        DatedMoney(Decimal("100"), date(2026, 1, 10), company_a, project_a),
        DatedMoney(Decimal("1000"), date(2026, 1, 10), company_a, project_b),
        DatedMoney(Decimal("9999"), date(2026, 1, 10), company_b, project_a),
    ]
    assert sum_as_of(facts, cut_off=date(2026, 1, 31), company_id=company_a, project_id=project_a) == Decimal("100")
    assert sum_as_of(facts, cut_off=date(2026, 1, 31), company_id=company_a, project_id=project_b) == Decimal("1000")
    assert sum_as_of(facts, cut_off=date(2026, 1, 31), company_id=company_b, project_id=project_a) == Decimal("9999")


def test_compose_as_of_riverside_supported_path() -> None:
    report = compose_as_of_cvr(
        cut_off=date(2026, 1, 31),
        contract_known=True,
        original_contract=Decimal("100000"),
        approved_variations=Decimal("5000"),
        approved_dayworks_in_contract=Decimal("1000"),
        non_accrual_eligible_cost=Decimal("10000"),
        cis_labour_gross=Decimal("2000"),
        effective_accrual_balance=Decimal("0"),
        open_commitment=Decimal("3000"),
        cost_to_complete=Decimal("4000"),
        internal_vow=None,
        certified_value=Decimal("0"),
        customer_invoiced_net=Decimal("0"),
        customer_receipts=Decimal("0"),
    )
    assert report["approved_contract_value"] == "106000"
    assert report["actual_incurred_cost"] == "12000"
    assert report["forecast_final_cost"] == "19000"
    assert report["forecast_final_profit"] == "87000"
    assert Decimal(report["forecast_final_margin_percent"]) == Decimal("82.08")
    assert report["internal_vow"] == MISSING


def test_compose_as_of_accrual_pure_calculation_only() -> None:
    """PURE CALCULATION ONLY — not live PostgreSQL evidence."""
    report = compose_as_of_cvr(
        cut_off=date(2026, 1, 31),
        contract_known=True,
        original_contract=Decimal("100000"),
        approved_variations=Decimal("5000"),
        approved_dayworks_in_contract=Decimal("1000"),
        non_accrual_eligible_cost=Decimal("10000"),
        cis_labour_gross=Decimal("2000"),
        effective_accrual_balance=Decimal("1000"),
        open_commitment=Decimal("3000"),
        cost_to_complete=Decimal("4000"),
        internal_vow=None,
        certified_value=None,
        customer_invoiced_net=Decimal("0"),
        customer_receipts=Decimal("0"),
    )
    assert report["adjusted_incurred_cost"] == "13000"
    assert report["forecast_final_cost"] == "20000"
    assert report["forecast_final_profit"] == "86000"
    assert Decimal(report["forecast_final_margin_percent"]) == Decimal("81.13")


def _finance_models_importable() -> bool:
    try:
        import app.modules.finance.models  # noqa: F401
        return True
    except TypeError:
        return False


@pytest.mark.skipif(not _finance_models_importable(), reason="Finance models incompatible with this SQLAlchemy/Python")
def test_project_cvr_as_of_rejects_unowned_project() -> None:
    from app.modules.finance.commercial_service import project_cvr_as_of
    from app.modules.finance.ledger_service import FinanceLedgerError

    class _FakeResult:
        def __init__(self, value):
            self._value = value

        def scalar(self):
            return self._value

        def scalar_one(self):
            return self._value

    class _FakeSession:
        def __init__(self):
            self.calls: list[dict] = []

        def execute(self, statement, params=None):  # noqa: ANN001
            self.calls.append({"sql": str(statement), "params": dict(params or {})})
            return _FakeResult(None)

    company_id = uuid.uuid4()
    project_id = uuid.uuid4()
    session = _FakeSession()
    with pytest.raises(FinanceLedgerError) as exc:
        project_cvr_as_of(
            session,
            company_id=company_id,
            project_id=project_id,
            cut_off=date(2026, 1, 31),
        )
    assert exc.value.code == "NOT_FOUND"
    assert session.calls[0]["params"]["company_id"] == company_id
    assert session.calls[0]["params"]["project_id"] == project_id


@pytest.mark.skipif(not _finance_models_importable(), reason="Finance models incompatible with this SQLAlchemy/Python")
def test_project_cvr_as_of_marks_unavailable_layers() -> None:
    from app.modules.finance.commercial_service import project_cvr_as_of

    class _FakeResult:
        def __init__(self, value):
            self._value = value

        def scalar(self):
            return self._value

        def scalar_one(self):
            return self._value

    class _FakeSession:
        def __init__(self):
            self.calls: list[dict] = []

        def execute(self, statement, params=None):  # noqa: ANN001
            sql = str(statement)
            self.calls.append({"sql": sql, "params": dict(params or {})})
            if "FROM finance_projects" in sql:
                return _FakeResult(1)
            if "FROM finance_contract_values" in sql or "FROM finance_cost_to_complete" in sql:
                return _FakeResult(None)
            return _FakeResult(Decimal("0"))

    company_id = uuid.uuid4()
    project_id = uuid.uuid4()
    session = _FakeSession()
    report = project_cvr_as_of(
        session,
        company_id=company_id,
        project_id=project_id,
        cut_off=date(2026, 1, 31),
    )
    assert report["cut_off"] == "2026-01-31"
    assert report["accrued_cost"] == MISSING
    assert report["effective_accrual_balance"] == MISSING
    assert report["internal_vow"] == MISSING
    assert report["location_reporting"].startswith("not_supported")
    assert "unvalidated" in report["certified_status"]
    assert report["actual_incurred_cost"] == "0"
    for call in session.calls[1:]:
        assert call["params"]["company_id"] == company_id
        assert call["params"]["project_id"] == project_id
        assert call["params"]["cut_off"] == date(2026, 1, 31)


@pytest.mark.skipif(not _finance_models_importable(), reason="Finance models incompatible with this SQLAlchemy/Python")
def test_router_registers_as_of_endpoint() -> None:
    from app.modules.finance.commercial_router import router

    paths = {route.path for route in router.routes}
    assert "/api/finance/cvr" in paths
    assert "/api/finance/cvr/as-of" in paths
