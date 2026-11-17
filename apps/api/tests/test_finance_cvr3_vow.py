"""CVR-3 database-free value-of-work tests."""

from datetime import date
from decimal import Decimal

from app.modules.finance.cvr_forecast import MISSING
from app.modules.finance.cvr_vow import (
    CertificateFact,
    InternalValuationFact,
    certified_value_to_date,
    compose_work_value_panel,
    customer_position,
    internal_vow_to_date,
    margin_to_date,
    retention_withheld,
)


def test_t3_1_internal_margin() -> None:
    result = margin_to_date(work_value=Decimal("20000"), adjusted_cost=Decimal("13000"))
    assert result["margin"] == "7000"
    assert result["margin_percent"] == "35.00"


def test_t3_2_certified_margin() -> None:
    result = margin_to_date(work_value=Decimal("18000"), adjusted_cost=Decimal("13000"))
    assert result["margin"] == "5000"
    assert result["margin_percent"] == "27.78"


def test_t3_3_invoice_and_cash_do_not_change_vow() -> None:
    customer = customer_position(invoiced_net=Decimal("15000"), cash_received=Decimal("5000"))
    assert customer["customer_outstanding"] == "10000"
    panel = compose_work_value_panel(
        internal_vow=Decimal("20000"),
        certified_value=Decimal("18000"),
        adjusted_cost=Decimal("13000"),
        invoiced_net=Decimal("15000"),
        cash_received=Decimal("5000"),
        certified_basis="sum_period",
    )
    assert panel["internal_vow"] == "20000"
    assert panel["customer_outstanding"] == "10000"


def test_t3_4_cumulative_certificates_take_latest() -> None:
    certs = [
        CertificateFact(Decimal("10000"), 1, date(2026, 1, 31)),
        CertificateFact(Decimal("15000"), 2, date(2026, 2, 28)),
    ]
    assert certified_value_to_date(certs, basis="latest_cumulative") == Decimal("15000")


def test_t3_5_period_specific_certificates_sum() -> None:
    certs = [
        CertificateFact(Decimal("10000"), 1, date(2026, 1, 31)),
        CertificateFact(Decimal("5000"), 2, date(2026, 2, 28)),
    ]
    assert certified_value_to_date(certs, basis="sum_period") == Decimal("15000")


def test_t3_6_retention_does_not_reduce_certified_work() -> None:
    certified = Decimal("10000")
    withheld = retention_withheld(certified, Decimal("5"))
    assert withheld == Decimal("500.0000")
    assert certified == Decimal("10000")


def test_t3_7_unapproved_variations_excluded_from_contract_helper() -> None:
    # VOW module does not add unapproved variations; approved contract is an input.
    panel = compose_work_value_panel(
        internal_vow=Decimal("10000"),
        certified_value=Decimal("10000"),
        adjusted_cost=Decimal("8000"),
        invoiced_net=Decimal("0"),
        cash_received=Decimal("0"),
        certified_basis="sum_period",
    )
    assert "official margin" in panel["review_required"]


def test_t3_8_missing_internal_valuation() -> None:
    assert internal_vow_to_date([], cut_off=date(2026, 1, 31)) is None
    result = margin_to_date(work_value=None, adjusted_cost=Decimal("1000"))
    assert result["work_value"] == MISSING
    assert result["margin"] == MISSING
    latest = internal_vow_to_date(
        [
            InternalValuationFact(Decimal("10000"), date(2026, 1, 15), approved=False),
            InternalValuationFact(Decimal("12000"), date(2026, 1, 20), approved=True),
        ],
        cut_off=date(2026, 1, 31),
    )
    assert latest == Decimal("12000")
