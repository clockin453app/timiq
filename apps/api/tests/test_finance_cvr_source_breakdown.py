"""Database-free CVR source-breakdown reconciliation helpers."""

from decimal import Decimal

from app.modules.finance.cvr_reconcile import (
    PARTIAL,
    UNAVAILABLE,
    VERIFIED,
    money_str,
    parse_money,
    reconcile_totals,
    sum_amounts,
)


def test_money_str_four_decimals() -> None:
    assert money_str(Decimal("123.45")) == "123.4500"
    assert money_str(None) == "0.0000"
    assert money_str("10") == "10.0000"


def test_parse_money_missing() -> None:
    assert parse_money("missing") is None
    assert parse_money("") is None
    assert parse_money("12.5000") == Decimal("12.5000")


def test_sum_amounts_ignores_none() -> None:
    assert sum_amounts([Decimal("1.0000"), None, Decimal("2.2500")]) == Decimal("3.2500")


def test_reconcile_exact_match() -> None:
    result = reconcile_totals(
        displayed=Decimal("100.0000"),
        contributions=[Decimal("40.0000"), Decimal("60.0000")],
    )
    assert result["verification"] == VERIFIED
    assert result["reconcilable"] is True
    assert result["difference"] == "0.0000"
    assert result["source_total"] == "100.0000"


def test_reconcile_mismatch_is_partial() -> None:
    result = reconcile_totals(
        displayed=Decimal("100.0000"),
        contributions=[Decimal("40.0000"), Decimal("50.0000")],
    )
    assert result["verification"] == PARTIAL
    assert result["difference"] == "10.0000"


def test_reconcile_unavailable_when_not_listable() -> None:
    result = reconcile_totals(
        displayed=Decimal("50.0000"),
        contributions=[],
        listable=False,
    )
    assert result["verification"] == UNAVAILABLE
    assert result["reconcilable"] is False


def test_reconcile_missing_displayed_partial() -> None:
    result = reconcile_totals(
        displayed=None,
        contributions=[Decimal("10.0000")],
        all_components_known=False,
    )
    assert result["verification"] == PARTIAL
    assert result["reconcilable"] is False


def test_incomplete_sources_stay_partial_even_when_diff_is_zero() -> None:
    result = reconcile_totals(
        displayed=Decimal("602500.0000"),
        contributions=[Decimal("580000.0000"), Decimal("22500.0000")],
        all_components_known=False,
    )
    assert result["difference"] == "0.0000"
    assert result["verification"] == PARTIAL
    assert result["reconcilable"] is False


def test_cost_to_date_includes_cis_once_not_twice() -> None:
    """Eligible + CIS once reconciles to incurred; payments are never a second CIS add."""
    eligible = Decimal("580000.0000")
    cis = Decimal("22500.0000")
    incurred = Decimal("602500.0000")
    once = reconcile_totals(
        displayed=incurred,
        contributions=[eligible, cis],
        all_components_known=False,
    )
    assert once["source_total"] == "602500.0000"
    assert once["difference"] == "0.0000"
    assert once["verification"] == PARTIAL

    doubled = reconcile_totals(
        displayed=incurred,
        contributions=[eligible, cis, cis],
        all_components_known=False,
    )
    assert doubled["difference"] == "-22500.0000"
    assert doubled["verification"] == PARTIAL


def test_commitments_and_invoices_are_not_the_same_contribution() -> None:
    """Open commitment remaining must not be summed again as eligible invoice cost."""
    eligible_invoices = Decimal("100.0000")
    open_commitments = Decimal("40.0000")
    incurred_only = reconcile_totals(
        displayed=Decimal("100.0000"),
        contributions=[eligible_invoices],
    )
    assert incurred_only["verification"] == VERIFIED
    wrong_double = reconcile_totals(
        displayed=Decimal("100.0000"),
        contributions=[eligible_invoices, open_commitments],
    )
    assert wrong_double["verification"] == PARTIAL
    assert wrong_double["difference"] == "-40.0000"


def test_credit_note_negative_contribution() -> None:
    result = reconcile_totals(
        displayed=Decimal("90.0000"),
        contributions=[Decimal("100.0000"), Decimal("-10.0000")],
    )
    assert result["verification"] == VERIFIED
    assert result["source_total"] == "90.0000"



def test_cost_to_date_global_partial_when_cis_unverified() -> None:
    """Eligible may reconcile while global Cost to Date stays PARTIAL."""
    eligible = Decimal("580000.0000")
    cis = Decimal("22500.0000")
    incurred = Decimal("602500.0000")
    eligible_only = reconcile_totals(displayed=eligible, contributions=[eligible])
    assert eligible_only["verification"] == VERIFIED
    global_kpi = reconcile_totals(
        displayed=incurred,
        contributions=[eligible, cis],
        all_components_known=False,
    )
    assert global_kpi["difference"] == "0.0000"
    assert global_kpi["verification"] == PARTIAL
    assert global_kpi["reconcilable"] is False
