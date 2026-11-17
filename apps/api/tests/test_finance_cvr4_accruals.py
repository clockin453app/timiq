"""CVR-4 database-free accrual matching tests."""

from datetime import date
from decimal import Decimal

import pytest

from app.modules.finance.cvr_accrual_rules import (
    AccrualLedger,
    AccrualRuleError,
    adjusted_incurred_cost,
    cumulative_adjusted_with_matching,
)


def test_t4_1_full_matching() -> None:
    ledger = AccrualLedger()
    ledger.post_accrual(
        accrual_id="a1", amount=Decimal("1000"), project_id="p1", effective_date=date(2026, 1, 31)
    )
    jan_adjusted = adjusted_incurred_cost(
        non_accrual_actual=Decimal("0"),
        effective_accrual_balance=ledger.open_balance(cut_off=date(2026, 1, 31)),
    )
    assert jan_adjusted == Decimal("1000")
    ledger.match_invoice(
        accrual_id="a1",
        invoice_id="inv1",
        amount=Decimal("1000"),
        invoice_project_id="p1",
        effective_date=date(2026, 2, 15),
    )
    periods = [date(2026, 1, 31), date(2026, 2, 28)]
    non_accrual = {date(2026, 1, 31): Decimal("0"), date(2026, 2, 28): Decimal("1000")}
    cumulative = cumulative_adjusted_with_matching(
        non_accrual_by_period=non_accrual, ledger=ledger, periods=periods
    )
    assert cumulative[date(2026, 1, 31)] == Decimal("1000")
    assert cumulative[date(2026, 2, 28)] == Decimal("1000")
    assert ledger.open_balance(cut_off=date(2026, 2, 28)) == Decimal("0")


def test_t4_2_partial_matching() -> None:
    ledger = AccrualLedger()
    ledger.post_accrual(
        accrual_id="a1", amount=Decimal("1000"), project_id="p1", effective_date=date(2026, 1, 10)
    )
    ledger.match_invoice(
        accrual_id="a1",
        invoice_id="inv1",
        amount=Decimal("600"),
        invoice_project_id="p1",
        effective_date=date(2026, 2, 1),
    )
    assert ledger.open_balance() == Decimal("400")
    adjusted = adjusted_incurred_cost(
        non_accrual_actual=Decimal("600"),
        effective_accrual_balance=Decimal("400"),
    )
    assert adjusted == Decimal("1000")


def test_t4_3_final_matching() -> None:
    ledger = AccrualLedger()
    ledger.post_accrual(
        accrual_id="a1", amount=Decimal("1000"), project_id="p1", effective_date=date(2026, 1, 10)
    )
    ledger.match_invoice(
        accrual_id="a1", invoice_id="inv1", amount=Decimal("600"), invoice_project_id="p1",
        effective_date=date(2026, 2, 1),
    )
    ledger.match_invoice(
        accrual_id="a1", invoice_id="inv2", amount=Decimal("400"), invoice_project_id="p1",
        effective_date=date(2026, 2, 20),
    )
    assert ledger.open_balance() == Decimal("0")
    assert adjusted_incurred_cost(
        non_accrual_actual=Decimal("1000"),
        effective_accrual_balance=Decimal("0"),
    ) == Decimal("1000")


def test_t4_4_reversal_without_invoice() -> None:
    ledger = AccrualLedger()
    ledger.post_accrual(
        accrual_id="a1", amount=Decimal("1000"), project_id="p1", effective_date=date(2026, 1, 10)
    )
    ledger.reverse_accrual(accrual_id="a1", effective_date=date(2026, 1, 20))
    assert ledger.open_balance(cut_off=date(2026, 1, 31)) == Decimal("0")
    assert adjusted_incurred_cost(
        non_accrual_actual=Decimal("0"),
        effective_accrual_balance=Decimal("0"),
    ) == Decimal("0")


def test_t4_5_unrelated_invoice() -> None:
    assert adjusted_incurred_cost(
        non_accrual_actual=Decimal("500"),
        effective_accrual_balance=Decimal("1000"),
    ) == Decimal("1500")


def test_t4_6_overmatching_rejected() -> None:
    ledger = AccrualLedger()
    ledger.post_accrual(
        accrual_id="a1", amount=Decimal("400"), project_id="p1", effective_date=date(2026, 1, 1)
    )
    with pytest.raises(AccrualRuleError, match="exceeds remaining"):
        ledger.match_invoice(
            accrual_id="a1",
            invoice_id="inv1",
            amount=Decimal("500"),
            invoice_project_id="p1",
            effective_date=date(2026, 1, 2),
        )


def test_t4_7_duplicate_matching_rejected() -> None:
    ledger = AccrualLedger()
    ledger.post_accrual(
        accrual_id="a1", amount=Decimal("1000"), project_id="p1", effective_date=date(2026, 1, 1)
    )
    ledger.match_invoice(
        accrual_id="a1", invoice_id="inv1", amount=Decimal("400"), invoice_project_id="p1",
        effective_date=date(2026, 1, 2),
    )
    with pytest.raises(AccrualRuleError, match="Duplicate"):
        ledger.match_invoice(
            accrual_id="a1", invoice_id="inv1", amount=Decimal("400"), invoice_project_id="p1",
            effective_date=date(2026, 1, 3),
        )


def test_t4_8_january_as_of_unchanged_after_february_match() -> None:
    ledger = AccrualLedger()
    ledger.post_accrual(
        accrual_id="a1", amount=Decimal("1000"), project_id="p1", effective_date=date(2026, 1, 15)
    )
    jan = ledger.open_balance(cut_off=date(2026, 1, 31))
    ledger.match_invoice(
        accrual_id="a1", invoice_id="inv1", amount=Decimal("1000"), invoice_project_id="p1",
        effective_date=date(2026, 2, 10),
    )
    assert ledger.open_balance(cut_off=date(2026, 1, 31)) == jan == Decimal("1000")
    assert ledger.open_balance(cut_off=date(2026, 2, 28)) == Decimal("0")


def test_t4_9_project_isolation() -> None:
    ledger = AccrualLedger()
    ledger.post_accrual(
        accrual_id="a1", amount=Decimal("1000"), project_id="A", effective_date=date(2026, 1, 1)
    )
    with pytest.raises(AccrualRuleError, match="Cross-project"):
        ledger.match_invoice(
            accrual_id="a1",
            invoice_id="inv1",
            amount=Decimal("1000"),
            invoice_project_id="B",
            effective_date=date(2026, 1, 2),
        )


def test_t4_10_concurrency_not_run_here() -> None:
    pytest.skip(
        "T4.10 concurrent accrual matching requires an authorised disposable PostgreSQL database; NOT RUN."
    )
