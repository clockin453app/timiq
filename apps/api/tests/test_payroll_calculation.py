"""Tests for payroll.calculation and payroll.service money helpers (no DB)."""

from decimal import Decimal
from types import SimpleNamespace

from app.modules.payroll.calculation import (
    compute_money_bundle,
    normalize_payroll_payment_mode,
    split_regular_overtime,
)
from app.modules.payroll.service import _effective_net_amount_for_item, _effective_tax_amount_for_item


def test_normalize_payroll_payment_mode_defaults() -> None:
    assert normalize_payroll_payment_mode(None) == "net_payment"
    assert normalize_payroll_payment_mode("") == "net_payment"
    assert normalize_payroll_payment_mode("  NET  ") == "net_payment"
    assert normalize_payroll_payment_mode("net") == "net_payment"
    assert normalize_payroll_payment_mode("gross") == "gross_payment"
    assert normalize_payroll_payment_mode("unknown_mode") == "net_payment"


def test_compute_money_bundle_net_payment_applies_cis() -> None:
    out = compute_money_bundle(
        regular_seconds=3600,
        overtime_seconds=0,
        hourly_rate=Decimal("10.00"),
        overtime_multiplier=Decimal("1.5"),
        tax_rate_percent=Decimal("20"),
        other_deductions=Decimal("0"),
        payment_mode="net_payment",
    )
    assert out["rate_missing"] is False
    assert out["gross_amount"] == Decimal("10.0000")
    assert out["tax_amount"] == Decimal("2.00")
    assert out["net_amount"] == Decimal("8.00")


def test_compute_money_bundle_gross_payment_zero_cis() -> None:
    out = compute_money_bundle(
        regular_seconds=3600,
        overtime_seconds=0,
        hourly_rate=Decimal("10.00"),
        overtime_multiplier=Decimal("1.5"),
        tax_rate_percent=Decimal("20"),
        other_deductions=Decimal("1.00"),
        payment_mode="gross_payment",
    )
    assert out["tax_amount"] == Decimal("0")
    assert out["net_amount"] == Decimal("9.00")


def test_split_regular_overtime() -> None:
    reg, ot = split_regular_overtime(10 * 3600, overtime_after_hours=8.5)
    assert reg == int(8.5 * 3600)
    assert ot == 10 * 3600 - reg


def test_effective_tax_amount_gross_payment_is_zero() -> None:
    item = SimpleNamespace(
        payment_mode="gross_payment",
        rate_missing=False,
        gross_amount=100,
        tax_amount=20,
        display_tax_amount=None,
    )
    assert _effective_tax_amount_for_item(item) == Decimal(0)


def test_effective_tax_amount_net_payment_uses_display_then_calculated() -> None:
    item = SimpleNamespace(
        payment_mode="net_payment",
        rate_missing=False,
        gross_amount=100,
        tax_amount=15,
        display_tax_amount=12,
    )
    assert _effective_tax_amount_for_item(item) == Decimal(12)


def test_effective_net_prefers_display() -> None:
    item = SimpleNamespace(display_net_amount=50, net_amount=48)
    assert _effective_net_amount_for_item(item) == Decimal(50)
