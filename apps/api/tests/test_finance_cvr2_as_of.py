"""CVR-2 database-free as-of reporting tests."""

from datetime import date
from decimal import Decimal

from app.modules.finance.cvr_as_of import DatedMoney, compose_as_of_cvr, sum_as_of
from app.modules.finance.cvr_forecast import MISSING


def test_t2_1_monthly_cut_off() -> None:
    company = "c1"
    project = "p1"
    facts = [
        DatedMoney(Decimal("1000.0000"), date(2026, 1, 15), company, project),
        DatedMoney(Decimal("500.0000"), date(2026, 2, 10), company, project),
    ]
    jan = sum_as_of(facts, cut_off=date(2026, 1, 31), company_id=company, project_id=project)
    feb = sum_as_of(facts, cut_off=date(2026, 2, 28), company_id=company, project_id=project)
    assert jan == Decimal("1000.0000")
    assert feb == Decimal("1500.0000")


def test_t2_2_future_invoice_excluded() -> None:
    facts = [
        DatedMoney(Decimal("2000.0000"), date(2026, 3, 5), "c1", "p1"),
    ]
    assert sum_as_of(facts, cut_off=date(2026, 2, 28), company_id="c1", project_id="p1") == Decimal("0")


def test_t2_3_commitments_not_duplicated_in_incurred() -> None:
    report = compose_as_of_cvr(
        cut_off=date(2026, 2, 28),
        contract_known=True,
        original_contract=Decimal("10000"),
        approved_variations=Decimal("0"),
        approved_dayworks_in_contract=Decimal("0"),
        non_accrual_eligible_cost=Decimal("1000"),  # draw already in eligible once
        cis_labour_gross=Decimal("0"),
        open_commitment=Decimal("3000"),
        cost_to_complete=Decimal("0"),
    )
    assert report["actual_incurred_cost"] == "1000"
    assert report["open_commitments"] == "3000"
    assert report["forecast_final_cost"] == "4000"
    assert Decimal(report["actual_incurred_cost"]) != Decimal(report["forecast_final_cost"])


def test_t2_4_missing_ctc() -> None:
    report = compose_as_of_cvr(
        cut_off=date(2026, 1, 31),
        contract_known=True,
        original_contract=Decimal("10000"),
        approved_variations=Decimal("0"),
        approved_dayworks_in_contract=Decimal("0"),
        non_accrual_eligible_cost=Decimal("1000"),
        cis_labour_gross=Decimal("0"),
        open_commitment=Decimal("0"),
        cost_to_complete=None,
    )
    assert report["forecast_final_cost"] == MISSING
    assert report["forecast_final_profit"] == MISSING
    assert report["cost_to_complete"] == MISSING


def test_t2_5_explicit_zero_ctc() -> None:
    report = compose_as_of_cvr(
        cut_off=date(2026, 1, 31),
        contract_known=True,
        original_contract=Decimal("10000"),
        approved_variations=Decimal("0"),
        approved_dayworks_in_contract=Decimal("0"),
        non_accrual_eligible_cost=Decimal("4000"),
        cis_labour_gross=Decimal("0"),
        open_commitment=Decimal("0"),
        cost_to_complete=Decimal("0"),
    )
    assert report["cost_to_complete"] == "0"
    assert report["forecast_final_cost"] == "4000"
    assert report["forecast_final_profit"] == "6000"


def test_t2_6_later_cost_does_not_change_earlier_as_of() -> None:
    facts = [
        DatedMoney(Decimal("1000"), date(2026, 1, 10), "c1", "p1"),
        DatedMoney(Decimal("500"), date(2026, 2, 5), "c1", "p1"),  # later correction/cost
    ]
    closed_jan = sum_as_of(facts, cut_off=date(2026, 1, 31), company_id="c1", project_id="p1")
    live_feb = sum_as_of(facts, cut_off=date(2026, 2, 28), company_id="c1", project_id="p1")
    assert closed_jan == Decimal("1000")
    assert live_feb == Decimal("1500")


def test_t2_sum_as_of_requires_company_and_project_scope() -> None:
    import pytest

    facts = [DatedMoney(Decimal("1000"), date(2026, 1, 10), "c1", "p1")]
    with pytest.raises(ValueError, match="required"):
        sum_as_of(facts, cut_off=date(2026, 1, 31), company_id=None, project_id="p1")
    # Facts without ids are excluded, not cross-aggregated.
    orphan = [DatedMoney(Decimal("9999"), date(2026, 1, 10), None, None)]
    assert sum_as_of(orphan, cut_off=date(2026, 1, 31), company_id="c1", project_id="p1") == Decimal("0")


def test_t2_7_company_project_isolation() -> None:
    facts = [
        DatedMoney(Decimal("1000"), date(2026, 1, 10), "c1", "p1"),
        DatedMoney(Decimal("9999"), date(2026, 1, 10), "c2", "p1"),
        DatedMoney(Decimal("8888"), date(2026, 1, 10), "c1", "p2"),
    ]
    assert sum_as_of(facts, cut_off=date(2026, 1, 31), company_id="c1", project_id="p1") == Decimal("1000")
