"""CVR-4 — Accrual balance and invoice matching (database-free).

Accrual documents remain unpostable in the live cost register
(``UNPOSTABLE_TYPES``). This module implements the anti-double-count arithmetic
and match validation only. Activating accrual posting requires an approved
schema/workflow and must not simply remove the unpostable guard.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal


class AccrualRuleError(ValueError):
    pass


@dataclass
class AccrualLedger:
    """In-memory accrual positions for one company/project scope."""

    open_by_id: dict[object, Decimal] = field(default_factory=dict)
    match_keys: set[tuple[object, object]] = field(default_factory=set)
    project_by_id: dict[object, object] = field(default_factory=dict)
    posted_on: dict[object, date] = field(default_factory=dict)
    events: list[tuple[str, object, Decimal, date]] = field(default_factory=list)

    def post_accrual(
        self,
        *,
        accrual_id: object,
        amount: Decimal,
        project_id: object,
        effective_date: date,
    ) -> None:
        if amount <= 0:
            raise AccrualRuleError("Accrual amount must be greater than zero.")
        if accrual_id in self.open_by_id:
            raise AccrualRuleError("Accrual id already exists.")
        self.open_by_id[accrual_id] = amount
        self.project_by_id[accrual_id] = project_id
        self.posted_on[accrual_id] = effective_date
        self.events.append(("posted", accrual_id, amount, effective_date))

    def match_invoice(
        self,
        *,
        accrual_id: object,
        invoice_id: object,
        amount: Decimal,
        invoice_project_id: object,
        effective_date: date,
    ) -> None:
        if amount <= 0:
            raise AccrualRuleError("Match amount must be greater than zero.")
        key = (accrual_id, invoice_id)
        if key in self.match_keys:
            raise AccrualRuleError("Duplicate accrual match is not allowed.")
        if accrual_id not in self.open_by_id:
            raise AccrualRuleError("Accrual was not found or is fully released.")
        if self.project_by_id[accrual_id] != invoice_project_id:
            raise AccrualRuleError("Cross-project accrual matching is not allowed.")
        remaining = self.open_by_id[accrual_id]
        if amount > remaining:
            raise AccrualRuleError("Match exceeds remaining accrual balance.")
        self.open_by_id[accrual_id] = remaining - amount
        self.match_keys.add(key)
        self.events.append(("matched", accrual_id, amount, effective_date))
        if self.open_by_id[accrual_id] == 0:
            # Keep zero until reversed/cleared for audit; balance helpers ignore zero.
            pass

    def reverse_accrual(
        self,
        *,
        accrual_id: object,
        amount: Decimal | None = None,
        effective_date: date,
    ) -> None:
        if accrual_id not in self.open_by_id:
            raise AccrualRuleError("Accrual was not found or is fully released.")
        remaining = self.open_by_id[accrual_id]
        release = remaining if amount is None else amount
        if release <= 0 or release > remaining:
            raise AccrualRuleError("Accrual reversal amount is invalid.")
        self.open_by_id[accrual_id] = remaining - release
        self.events.append(("reversed", accrual_id, release, effective_date))

    def open_balance(self, *, cut_off: date | None = None) -> Decimal:
        if cut_off is None:
            return sum((value for value in self.open_by_id.values() if value > 0), Decimal("0"))
        # Rebuild open balance as-of cut_off from events (posted/matched/reversed).
        running: dict[object, Decimal] = {}
        for kind, accrual_id, amount, event_date in self.events:
            if event_date > cut_off:
                continue
            if kind == "posted":
                running[accrual_id] = running.get(accrual_id, Decimal("0")) + amount
            else:
                running[accrual_id] = running.get(accrual_id, Decimal("0")) - amount
        return sum((value for value in running.values() if value > 0), Decimal("0"))


def adjusted_incurred_cost(
    *,
    non_accrual_actual: Decimal,
    effective_accrual_balance: Decimal,
) -> Decimal:
    if non_accrual_actual < 0 or effective_accrual_balance < 0:
        raise AccrualRuleError("Cost components must not be negative.")
    return non_accrual_actual + effective_accrual_balance


def cumulative_adjusted_with_matching(
    *,
    non_accrual_by_period: dict[date, Decimal],
    ledger: AccrualLedger,
    periods: list[date],
) -> dict[date, Decimal]:
    """Cumulative adjusted cost through each period end (as-of that date)."""
    output: dict[date, Decimal] = {}
    running_non_accrual = Decimal("0")
    for period in periods:
        running_non_accrual += non_accrual_by_period.get(period, Decimal("0"))
        accrual = ledger.open_balance(cut_off=period)
        # When invoice matches release accrual, non-accrual invoice cost must be
        # included in non_accrual_by_period by the caller for that period.
        output[period] = adjusted_incurred_cost(
            non_accrual_actual=running_non_accrual,
            effective_accrual_balance=accrual,
        )
    return output
