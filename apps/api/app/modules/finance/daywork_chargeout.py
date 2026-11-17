"""CVR-6 — Daywork hours/days × historical charge-out rates (database-free).

Existing ``finance_dayworks`` stores amount-only labour/material/plant columns.
Hours, days and rate columns require a migration (blocked by dual Alembic heads).
These helpers compute charge-out lines and totals for drafts without mutating
payroll rates or repricing approved historical dayworks.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Literal

Unit = Literal["hours", "days"]


class DayworkChargeoutError(ValueError):
    pass


MONEY = Decimal("0.0001")


@dataclass(frozen=True)
class ChargeoutLine:
    unit: Unit
    quantity: Decimal
    rate: Decimal
    amount: Decimal


@dataclass(frozen=True)
class DayworkComposition:
    labour: Decimal
    materials: Decimal
    plant: Decimal
    other: Decimal
    total: Decimal
    labour_lines: tuple[ChargeoutLine, ...]
    historical_rate_frozen: bool


def _money(value: Decimal) -> Decimal:
    if not isinstance(value, Decimal):
        raise DayworkChargeoutError("Money values must be Decimal.")
    quantized = value.quantize(MONEY)
    if quantized != value:
        raise DayworkChargeoutError("Money values must fit NUMERIC(18,4).")
    return quantized


def labour_chargeout(*, quantity: Decimal, rate: Decimal, unit: Unit) -> ChargeoutLine:
    if unit not in {"hours", "days"}:
        raise DayworkChargeoutError("Unsupported daywork unit.")
    if quantity <= 0 or rate <= 0:
        raise DayworkChargeoutError("Quantity and rate must be greater than zero.")
    amount = _money(quantity * rate)
    return ChargeoutLine(unit=unit, quantity=quantity, rate=_money(rate), amount=amount)


def compose_daywork_total(
    *,
    labour_lines: list[ChargeoutLine],
    materials: Decimal = Decimal("0"),
    plant: Decimal = Decimal("0"),
    other: Decimal = Decimal("0"),
    historical_rate_frozen: bool = True,
) -> DayworkComposition:
    labour = sum((line.amount for line in labour_lines), Decimal("0"))
    materials_m = _money(materials)
    plant_m = _money(plant)
    other_m = _money(other)
    if materials_m < 0 or plant_m < 0 or other_m < 0:
        raise DayworkChargeoutError("Cost components must not be negative.")
    total = _money(labour + materials_m + plant_m + other_m)
    return DayworkComposition(
        labour=_money(labour),
        materials=materials_m,
        plant=plant_m,
        other=other_m,
        total=total,
        labour_lines=tuple(labour_lines),
        historical_rate_frozen=historical_rate_frozen,
    )


def approved_contract_impact(
    *,
    approval_status: str,
    counts_in_contract_value: bool,
    approved_value: Decimal,
    linked_variation_already_includes: bool,
) -> Decimal:
    """Return contract increase from a daywork. Drafts and linked variations add zero."""
    if approval_status != "approved" or not counts_in_contract_value:
        return Decimal("0")
    if linked_variation_already_includes:
        return Decimal("0")
    return _money(approved_value)


def historical_amount_unchanged(
    *,
    stored_labour_amount: Decimal,
    original_hours: Decimal,
    original_rate: Decimal,
    current_rate: Decimal,
) -> bool:
    """Approved historical labour stays at original hours×rate, not current rate."""
    original = labour_chargeout(quantity=original_hours, rate=original_rate, unit="hours")
    if current_rate == original_rate:
        return stored_labour_amount == original.amount
    repriced = labour_chargeout(quantity=original_hours, rate=current_rate, unit="hours")
    return stored_labour_amount == original.amount and stored_labour_amount != repriced.amount


def attendance_is_not_daywork(*, classified_as_daywork: bool) -> bool:
    """Ordinary site attendance hours are not billable dayworks unless classified."""
    return not classified_as_daywork


def validate_work_date(work_date: date) -> date:
    return work_date
