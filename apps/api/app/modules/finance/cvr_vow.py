"""CVR-3 — Value of work completed measures (database-free).

Internal VOW, certified value, customer invoiced and cash received are separate
labels. Certificate semantics must be declared explicitly because
``finance_payment_certificates`` stores ``certified_net`` per application
without a cumulative/period flag.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Literal

from app.modules.finance.cvr_forecast import MISSING, PERCENT

CertificateBasis = Literal["sum_period", "latest_cumulative"]


@dataclass(frozen=True)
class CertificateFact:
    certified_net: Decimal
    sequence: int
    effective_date: date
    retention_rate: Decimal = Decimal("0")
    retention_withheld: Decimal | None = None


@dataclass(frozen=True)
class InternalValuationFact:
    amount: Decimal
    valuation_date: date
    approved: bool


def retention_withheld(certified_net: Decimal, retention_rate: Decimal) -> Decimal:
    if certified_net < 0 or retention_rate < 0 or retention_rate > Decimal("100"):
        raise ValueError("Invalid certified net or retention rate.")
    return (certified_net * retention_rate / Decimal("100")).quantize(Decimal("0.0001"))


def certified_value_to_date(
    certificates: list[CertificateFact],
    *,
    basis: CertificateBasis,
    cut_off: date | None = None,
) -> Decimal:
    """Return certified work value under an explicit certificate basis.

    ``sum_period``: sum each certificate's certified_net (period applications).
    ``latest_cumulative``: take the highest-sequence cumulative certified_net.
    """
    rows = certificates
    if cut_off is not None:
        rows = [row for row in rows if row.effective_date <= cut_off]
    if not rows:
        return Decimal("0")
    if basis == "sum_period":
        return sum((row.certified_net for row in rows), Decimal("0"))
    if basis == "latest_cumulative":
        latest = max(rows, key=lambda row: (row.sequence, row.effective_date))
        return latest.certified_net
    raise ValueError("Certificate basis must be sum_period or latest_cumulative.")


def internal_vow_to_date(
    valuations: list[InternalValuationFact],
    *,
    cut_off: date | None = None,
) -> Decimal | None:
    """Latest approved internal valuation on/before cut-off, or None if missing."""
    rows = [row for row in valuations if row.approved]
    if cut_off is not None:
        rows = [row for row in rows if row.valuation_date <= cut_off]
    if not rows:
        return None
    latest = max(rows, key=lambda row: row.valuation_date)
    return latest.amount


def margin_to_date(*, work_value: Decimal | None, adjusted_cost: Decimal) -> dict[str, str]:
    if work_value is None:
        return {
            "work_value": MISSING,
            "margin": MISSING,
            "margin_percent": MISSING,
        }
    profit = work_value - adjusted_cost
    percent = MISSING
    if work_value > 0:
        percent = str((profit / work_value * Decimal("100")).quantize(PERCENT))
    return {
        "work_value": str(work_value),
        "margin": str(profit),
        "margin_percent": percent,
    }


def customer_position(
    *,
    invoiced_net: Decimal,
    cash_received: Decimal,
    credits_applied: Decimal = Decimal("0"),
) -> dict[str, str]:
    outstanding = invoiced_net - cash_received - credits_applied
    return {
        "customer_invoiced_net": str(invoiced_net),
        "customer_receipts": str(cash_received),
        "credits_applied": str(credits_applied),
        "customer_outstanding": str(outstanding),
        "note": "Invoices and receipts are not Value of Work Completed.",
    }


def compose_work_value_panel(
    *,
    internal_vow: Decimal | None,
    certified_value: Decimal | None,
    adjusted_cost: Decimal,
    invoiced_net: Decimal,
    cash_received: Decimal,
    certified_basis: CertificateBasis | None,
) -> dict[str, str]:
    internal = margin_to_date(work_value=internal_vow, adjusted_cost=adjusted_cost)
    certified = margin_to_date(work_value=certified_value, adjusted_cost=adjusted_cost)
    customer = customer_position(invoiced_net=invoiced_net, cash_received=cash_received)
    basis_note = (
        MISSING
        if certified_basis is None and certified_value is not None
        else (certified_basis or MISSING)
    )
    return {
        "internal_vow": internal["work_value"],
        "internal_margin_to_date": internal["margin"],
        "internal_margin_percent": internal["margin_percent"],
        "certified_value": certified["work_value"],
        "certified_margin_to_date": certified["margin"],
        "certified_margin_percent": certified["margin_percent"],
        "certificate_basis": str(basis_note),
        "customer_invoiced_net": customer["customer_invoiced_net"],
        "customer_receipts": customer["customer_receipts"],
        "customer_outstanding": customer["customer_outstanding"],
        "review_required": (
            "Internal and certified margins are independent. "
            "Neither is designated the official margin without owner approval. "
            "Invoices and receipts are not proof of completed work."
        ),
    }
