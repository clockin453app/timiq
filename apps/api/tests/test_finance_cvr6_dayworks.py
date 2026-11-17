"""CVR-6 database-free daywork charge-out tests."""

from decimal import Decimal

import pytest

from app.modules.finance.daywork_chargeout import (
    DayworkChargeoutError,
    approved_contract_impact,
    attendance_is_not_daywork,
    compose_daywork_total,
    historical_amount_unchanged,
    labour_chargeout,
)


def test_t6_1_hourly_line() -> None:
    line = labour_chargeout(quantity=Decimal("8"), rate=Decimal("65"), unit="hours")
    assert line.amount == Decimal("520.0000")


def test_t6_2_daily_line() -> None:
    line = labour_chargeout(quantity=Decimal("2"), rate=Decimal("250"), unit="days")
    assert line.amount == Decimal("500.0000")


def test_t6_3_combined_total() -> None:
    composition = compose_daywork_total(
        labour_lines=[
            labour_chargeout(quantity=Decimal("8"), rate=Decimal("65"), unit="hours"),
            labour_chargeout(quantity=Decimal("2"), rate=Decimal("250"), unit="days"),
        ],
        materials=Decimal("180"),
        plant=Decimal("100"),
    )
    assert composition.labour == Decimal("1020.0000")
    assert composition.total == Decimal("1300.0000")


def test_t6_4_historical_rate_frozen() -> None:
    assert historical_amount_unchanged(
        stored_labour_amount=Decimal("480.0000"),
        original_hours=Decimal("8"),
        original_rate=Decimal("60"),
        current_rate=Decimal("70"),
    )


def test_t6_5_draft_does_not_increase_contract() -> None:
    assert approved_contract_impact(
        approval_status="draft",
        counts_in_contract_value=True,
        approved_value=Decimal("1000"),
        linked_variation_already_includes=False,
    ) == Decimal("0")


def test_t6_6_approved_counts_in_contract() -> None:
    assert approved_contract_impact(
        approval_status="approved",
        counts_in_contract_value=True,
        approved_value=Decimal("1000"),
        linked_variation_already_includes=False,
    ) == Decimal("1000.0000")


def test_t6_7_linked_variation_no_duplicate() -> None:
    assert approved_contract_impact(
        approval_status="approved",
        counts_in_contract_value=True,
        approved_value=Decimal("1000"),
        linked_variation_already_includes=True,
    ) == Decimal("0")


def test_t6_8_labour_cost_separation() -> None:
    chargeout = labour_chargeout(quantity=Decimal("1"), rate=Decimal("500"), unit="days")
    worker_gross_payroll_cost = Decimal("300")
    assert chargeout.amount == Decimal("500.0000")
    assert chargeout.amount != worker_gross_payroll_cost


def test_t6_9_attendance_not_daywork() -> None:
    assert attendance_is_not_daywork(classified_as_daywork=False) is True
    assert attendance_is_not_daywork(classified_as_daywork=True) is False


def test_t6_10_invalid_inputs_rejected() -> None:
    with pytest.raises(DayworkChargeoutError):
        labour_chargeout(quantity=Decimal("-1"), rate=Decimal("65"), unit="hours")
    with pytest.raises(DayworkChargeoutError):
        labour_chargeout(quantity=Decimal("8"), rate=Decimal("65"), unit="weeks")  # type: ignore[arg-type]
    with pytest.raises(DayworkChargeoutError):
        labour_chargeout(quantity=Decimal("8"), rate=Decimal("0"), unit="hours")
