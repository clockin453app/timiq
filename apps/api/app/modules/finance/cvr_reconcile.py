"""Pure CVR source-breakdown reconciliation helpers (no database)."""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Iterable, Sequence

MONEY_Q = Decimal("0.0001")
ZERO = Decimal("0.0000")

VERIFIED = "RECONCILED"
PARTIAL = "PARTIAL"
UNAVAILABLE = "SOURCE BREAKDOWN UNAVAILABLE — NOT VERIFIED"


def money_str(value: Decimal | int | str | None) -> str:
    if value is None:
        return "0.0000"
    return str(Decimal(str(value)).quantize(MONEY_Q))


def parse_money(value: object) -> Decimal | None:
    if value is None:
        return None
    text_value = str(value).strip()
    if not text_value or text_value.lower() == "missing":
        return None
    return Decimal(text_value).quantize(MONEY_Q)


def sum_amounts(amounts: Iterable[Decimal | None]) -> Decimal:
    total = ZERO
    for amount in amounts:
        if amount is None:
            continue
        total += Decimal(str(amount)).quantize(MONEY_Q)
    return total.quantize(MONEY_Q)


def reconcile_totals(
    *,
    displayed: Decimal | None,
    contributions: Sequence[Decimal],
    listable: bool = True,
    all_components_known: bool = True,
) -> dict[str, Any]:
    contribution_total = sum_amounts(contributions)
    if not listable:
        diff = ZERO if displayed is None else (displayed - contribution_total).quantize(MONEY_Q)
        return {
            "reconcilable": False,
            "verification": UNAVAILABLE,
            "source_total": money_str(contribution_total),
            "difference": money_str(diff),
        }
    if displayed is None or not all_components_known:
        difference = ZERO if displayed is None else (displayed - contribution_total).quantize(MONEY_Q)
        return {
            "reconcilable": False,
            "verification": PARTIAL,
            "source_total": money_str(contribution_total),
            "difference": money_str(difference),
        }
    difference = (displayed - contribution_total).quantize(MONEY_Q)
    if difference == ZERO:
        return {
            "reconcilable": True,
            "verification": VERIFIED,
            "source_total": money_str(contribution_total),
            "difference": money_str(ZERO),
        }
    return {
        "reconcilable": True,
        "verification": PARTIAL,
        "source_total": money_str(contribution_total),
        "difference": money_str(difference),
    }
