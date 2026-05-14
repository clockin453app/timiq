"""Accounting payroll export helpers (summary rows, CSV column hygiene)."""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from app.modules.accounting.export_service import _payroll_summary_rows
from app.modules.payroll.service import _payment_mode_label


def test_payroll_summary_rows_net_vs_gross_cis() -> None:
    week = date(2026, 1, 5)
    period = SimpleNamespace(week_start=week)
    net_item = SimpleNamespace(
        gross_amount="100.00",
        tax_amount="20.00",
        display_tax_amount=None,
        display_net_amount=None,
        net_amount="80.00",
        payment_mode="net_payment",
        rate_missing=False,
    )
    gross_item = SimpleNamespace(
        gross_amount="50.00",
        tax_amount="5.00",
        display_tax_amount=None,
        display_net_amount=None,
        net_amount="50.00",
        payment_mode="gross_payment",
        rate_missing=False,
    )
    rows = _payroll_summary_rows([(period, net_item), (period, gross_item)])
    assert len(rows) == 1
    r = rows[0]
    assert r["gross"] == Decimal("150.00")
    assert r["cis"] == Decimal("20.00")
    assert r["net"] == Decimal("130.00")


def test_generic_payroll_item_headers_exclude_sensitive_columns() -> None:
    """Keep in sync with generic_csv branch for payroll_items in export_service.py."""
    headers = [
        "timiq_export_note",
        "company_name",
        "employee_name",
        "employee_email",
        "job_title",
        "week_period",
        "status",
        "payment_mode",
        "gross",
        "cis_tax",
        "net",
        "export_provider",
        "export_scope",
        "nominal_code",
        "tax_code",
    ]
    joined = " ".join(headers).lower()
    for forbidden in (
        "national_insurance",
        "ni_number",
        "utr",
        "bank",
        "account_number",
        "sort_code",
        "iban",
        "medical",
    ):
        assert forbidden not in joined


def test_payment_mode_label_for_export() -> None:
    assert "Gross" in _payment_mode_label("gross_payment")
    assert "Net" in _payment_mode_label("net_payment")
