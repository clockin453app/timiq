"""CVR-2 — Historical as-of report composition (database-free).

Callers supply components already filtered to cut-off date D using a documented
effective-date policy. This module does not invent missing timestamps or query
PostgreSQL. Persistence of as-of queries remains blocked while dual Alembic
heads prevent a defensible migration lineage.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.modules.finance.cvr_forecast import MISSING, PERCENT, compose_cvr_forecast


@dataclass(frozen=True)
class DatedMoney:
    """A money fact with the date used for cut-off inclusion."""

    amount: Decimal
    effective_date: date
    company_id: object | None = None
    project_id: object | None = None


def on_or_before(event_date: date, cut_off: date) -> bool:
    return event_date <= cut_off


def sum_as_of(facts: list[DatedMoney], *, cut_off: date, company_id, project_id) -> Decimal:
    """Sum dated money facts for one company and project on/before cut-off.

    ``company_id`` and ``project_id`` are required. Facts missing either id are
    excluded rather than aggregated across tenants.
    """
    if company_id is None or project_id is None:
        raise ValueError("company_id and project_id are required for as-of aggregation.")
    total = Decimal("0")
    for fact in facts:
        if fact.company_id is None or fact.project_id is None:
            continue
        if fact.company_id != company_id or fact.project_id != project_id:
            continue
        if on_or_before(fact.effective_date, cut_off):
            total += fact.amount
    return total


def compose_as_of_cvr(
    *,
    cut_off: date,
    contract_known: bool,
    original_contract: Decimal,
    approved_variations: Decimal,
    approved_dayworks_in_contract: Decimal,
    approved_budget: Decimal = Decimal("0"),
    non_accrual_eligible_cost: Decimal,
    cis_labour_gross: Decimal,
    effective_accrual_balance: Decimal = Decimal("0"),
    open_commitment: Decimal,
    cost_to_complete: Decimal | None,
    internal_vow: Decimal | None = None,
    certified_value: Decimal | None = None,
    customer_invoiced_net: Decimal = Decimal("0"),
    customer_receipts: Decimal = Decimal("0"),
) -> dict[str, str]:
    """Compose an as-of CVR position from already cut-off-filtered Decimals.

    Actual incurred excludes open commitments and excludes accrual documents.
    Adjusted incurred adds the separate effective accrual balance.
    Forecast uses adjusted incurred (not raw actual) when accruals are supplied.
    """
    if non_accrual_eligible_cost < 0 or cis_labour_gross < 0 or effective_accrual_balance < 0:
        raise ValueError("As-of cost components must not be negative.")
    if open_commitment < 0:
        raise ValueError("Open commitments must not be negative.")

    actual_incurred = non_accrual_eligible_cost + cis_labour_gross
    adjusted_incurred = actual_incurred + effective_accrual_balance

    # Forecast composer treats the first cost argument as actual_eligible and
    # second as CIS labour. Pass adjusted incurred as eligible and zero CIS so
    # forecast_final_cost = adjusted + open + CTC without double-counting CIS.
    forecast = compose_cvr_forecast(
        contract_known=contract_known,
        original_contract=original_contract,
        approved_variations=approved_variations,
        approved_dayworks_in_contract=approved_dayworks_in_contract,
        approved_budget=approved_budget,
        actual_eligible_cost=adjusted_incurred,
        cis_labour_gross=Decimal("0"),
        open_commitment=open_commitment,
        cost_to_complete=cost_to_complete,
    )

    customer_outstanding = customer_invoiced_net - customer_receipts
    if customer_outstanding < 0:
        customer_outstanding = Decimal("0")

    internal_margin = MISSING
    internal_margin_percent = MISSING
    if internal_vow is None:
        internal_vow_text = MISSING
    else:
        internal_vow_text = str(internal_vow)
        profit = internal_vow - adjusted_incurred
        internal_margin = str(profit)
        if internal_vow > 0:
            internal_margin_percent = str((profit / internal_vow * Decimal("100")).quantize(PERCENT))

    certified_margin = MISSING
    certified_margin_percent = MISSING
    if certified_value is None:
        certified_text = MISSING
    else:
        certified_text = str(certified_value)
        profit = certified_value - adjusted_incurred
        certified_margin = str(profit)
        if certified_value > 0:
            certified_margin_percent = str((profit / certified_value * Decimal("100")).quantize(PERCENT))

    return {
        "cut_off": cut_off.isoformat(),
        "non_accrual_eligible_cost": str(non_accrual_eligible_cost),
        "cis_labour_gross": str(cis_labour_gross),
        "actual_incurred_cost": str(actual_incurred),
        "effective_accrual_balance": str(effective_accrual_balance),
        "adjusted_incurred_cost": str(adjusted_incurred),
        "open_commitments": str(open_commitment),
        "open_commitment": str(open_commitment),
        "cost_to_complete": forecast["cost_to_complete"],
        "approved_contract_value": forecast["approved_contract_value"],
        "approved_variations": forecast["approved_variations"],
        "approved_dayworks_in_contract": forecast["approved_dayworks_in_contract"],
        "forecast_final_cost": forecast["forecast_final_cost"],
        "forecast_final_profit": forecast["forecast_final_profit"],
        "forecast_margin": forecast["forecast_margin"],
        "forecast_final_margin_percent": forecast["forecast_final_margin_percent"],
        "internal_vow": internal_vow_text,
        "certified_value": certified_text,
        "customer_invoiced_net": str(customer_invoiced_net),
        "customer_receipts": str(customer_receipts),
        "customer_outstanding": str(customer_outstanding),
        "internal_margin_to_date": internal_margin,
        "internal_margin_percent": internal_margin_percent,
        "certified_margin_to_date": certified_margin,
        "certified_margin_percent": certified_margin_percent,
        "review_required": forecast["review_required"],
    }
