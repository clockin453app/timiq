"""Compose Project Control forecast fields without database access.

Separates actual incurred cost from open commitments. Preserves the legacy
``forecast_margin`` key as a GBP amount (approved contract minus forecast
final cost). Percentage margin is exposed separately.
"""

from __future__ import annotations

from decimal import Decimal

MISSING = "missing"
PERCENT = Decimal("0.01")


def compose_cvr_forecast(
    *,
    contract_known: bool,
    original_contract: Decimal,
    approved_variations: Decimal,
    approved_dayworks_in_contract: Decimal,
    approved_budget: Decimal,
    actual_eligible_cost: Decimal,
    cis_labour_gross: Decimal,
    open_commitment: Decimal,
    cost_to_complete: Decimal | None,
) -> dict[str, str]:
    """Build the CVR response dict from already-loaded Decimal components."""
    approved_contract = (
        original_contract + approved_variations + approved_dayworks_in_contract
    )
    actual_incurred = actual_eligible_cost + cis_labour_gross

    review: list[str] = []
    if not contract_known:
        review.append("No contract value is stored. It is not treated as zero.")

    if cost_to_complete is None:
        complete_text = MISSING
        final_cost = MISSING
        profit = MISSING
        percent = MISSING
        review.append(
            "Cost to complete has not been estimated. It is not treated as zero."
        )
    else:
        # Explicit zero CTC is valid and distinct from missing.
        complete = cost_to_complete
        final = actual_incurred + open_commitment + complete
        complete_text = str(complete)
        final_cost = str(final)
        if not contract_known:
            profit = MISSING
            percent = MISSING
        else:
            profit_amount = approved_contract - final
            profit = str(profit_amount)
            if approved_contract <= 0:
                percent = MISSING
            else:
                percent = str(
                    (profit_amount / approved_contract * Decimal("100")).quantize(PERCENT)
                )
        if open_commitment > 0:
            review.append(
                "Open commitments are not actual incurred cost. "
                "Cost to complete must not double-count remaining committed work; "
                "automatic overlap detection is not available from stored data."
            )

    review.append(
        "Employer NI, pension and PAYE on-costs are not included in this project forecast "
        "unless separately recorded as project cost."
    )
    review.append(
        "Accruals are not yet fully supported as a separate incurred layer in this forecast."
    )
    review.append(
        "Forecast final profit is indicative projected profit, not recognised accounting profit."
    )

    return {
        "original_contract_value": str(original_contract) if contract_known else MISSING,
        "approved_variations": str(approved_variations),
        "approved_dayworks_in_contract": str(approved_dayworks_in_contract),
        "approved_contract_value": str(approved_contract) if contract_known else MISSING,
        "approved_budget": str(approved_budget),
        "actual_eligible_cost": str(actual_eligible_cost),
        "cis_labour_gross": str(cis_labour_gross),
        "actual_incurred_cost": str(actual_incurred),
        "open_commitment": str(open_commitment),
        "open_commitments": str(open_commitment),
        "cost_to_complete": complete_text,
        "forecast_final_cost": final_cost,
        # Legacy GBP field: same meaning as forecast_final_profit.
        "forecast_margin": profit,
        "forecast_final_profit": profit,
        "forecast_final_margin_percent": percent,
        "review_required": " ".join(review),
    }
