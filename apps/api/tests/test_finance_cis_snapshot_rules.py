"""Database-free checks for CIS snapshot effective amounts."""

from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
import uuid

from app.modules.finance.ledger_service import cis_snapshot_from_source


def _item(**overrides):
    base = dict(
        id=uuid.uuid4(),
        company_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        period_id=uuid.uuid4(),
        status="approved",
        rate_missing=False,
        gross_amount=Decimal("1000.0000"),
        tax_amount=Decimal("200.00"),
        net_amount=Decimal("800.00"),
        display_tax_amount=Decimal("200.00"),
        display_net_amount=Decimal("800.00"),
        other_deductions_amount=Decimal("0"),
        payment_mode="net_payment",
        approved_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
        paid_at=None,
        updated_at=datetime(2026, 10, 2, tzinfo=timezone.utc),
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _period(item):
    return SimpleNamespace(
        id=item.period_id,
        company_id=item.company_id,
        week_start=date(2026, 10, 5),
        timezone_name="Europe/London",
    )


def test_net_mode_uses_display_net_and_nonzero_display_tax() -> None:
    item = _item(display_tax_amount=Decimal("150.00"), display_net_amount=Decimal("850.00"))
    snapshot = cis_snapshot_from_source(item, _period(item))
    assert snapshot["effective_cis_deduction"] == Decimal("150.0000")
    assert snapshot["effective_payable_amount"] == Decimal("850.0000")
    assert snapshot["amounts_do_not_reconcile"] is False
    assert snapshot["source_paid_at"] is None


def test_zero_display_tax_falls_back_to_calculated_tax() -> None:
    item = _item(display_tax_amount=Decimal("0"), display_net_amount=None, net_amount=Decimal("800.00"))
    snapshot = cis_snapshot_from_source(item, _period(item))
    assert snapshot["effective_cis_deduction"] == Decimal("200.0000")
    assert snapshot["effective_payable_amount"] == Decimal("800.0000")


def test_gross_mode_stores_zero_cis_deduction() -> None:
    item = _item(
        payment_mode="gross_payment",
        tax_amount=Decimal("0"),
        net_amount=Decimal("1000.00"),
        display_tax_amount=Decimal("200.00"),
        display_net_amount=Decimal("1000.00"),
    )
    snapshot = cis_snapshot_from_source(item, _period(item))
    assert snapshot["effective_cis_deduction"] == Decimal("0.0000")
    assert snapshot["effective_payable_amount"] == Decimal("1000.0000")
    assert snapshot["amounts_do_not_reconcile"] is False
