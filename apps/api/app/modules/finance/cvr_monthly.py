"""CVR-5 — Monthly CVR snapshot payload and close rules (database-free).

Immutable snapshot persistence requires a new table and an approved Alembic
parent. This module serializes a closed payload and enforces revision rules
only. Live mutable queries must not be substituted for a closed snapshot.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal

from app.modules.finance.cvr_forecast import MISSING


class MonthlyCvrError(ValueError):
    pass


@dataclass(frozen=True)
class MonthlyCvrInput:
    company_id: str
    project_id: str
    reporting_month: str  # YYYY-MM
    cut_off: date
    approved_contract: Decimal | None
    variations: Decimal
    approved_dayworks: Decimal
    internal_vow: Decimal | None
    certified_value: Decimal | None
    customer_invoiced: Decimal
    cash_received: Decimal
    actual_incurred: Decimal
    accrued_cost: Decimal
    open_commitments: Decimal
    additional_ctc: Decimal | None
    author_user_id: str
    previous_forecast_profit: Decimal | None = None


def _money_or_missing(value: Decimal | None) -> str:
    return MISSING if value is None else str(value)


def build_monthly_cvr_payload(data: MonthlyCvrInput, *, revision: int = 1, supersedes: int | None = None) -> dict[str, str]:
    if revision < 1:
        raise MonthlyCvrError("Revision must be at least 1.")
    adjusted = data.actual_incurred + data.accrued_cost
    customer_outstanding = data.customer_invoiced - data.cash_received

    forecast_final_cost = MISSING
    forecast_final_profit = MISSING
    forecast_margin_percent = MISSING
    if data.additional_ctc is None or data.approved_contract is None:
        validation = "unvalidated"
    else:
        forecast_final_cost_value = adjusted + data.open_commitments + data.additional_ctc
        forecast_final_cost = str(forecast_final_cost_value)
        if data.approved_contract <= 0:
            validation = "unvalidated"
            forecast_final_profit = MISSING
            forecast_margin_percent = MISSING
        else:
            profit = data.approved_contract - forecast_final_cost_value
            forecast_final_profit = str(profit)
            forecast_margin_percent = str((profit / data.approved_contract * Decimal("100")).quantize(Decimal("0.01")))
            validation = "validated" if data.internal_vow is not None else "unvalidated"

    internal_margin = MISSING
    certified_margin = MISSING
    if data.internal_vow is not None:
        internal_margin = str(data.internal_vow - adjusted)
    if data.certified_value is not None:
        certified_margin = str(data.certified_value - adjusted)

    movement = MISSING
    if data.previous_forecast_profit is not None and forecast_final_profit != MISSING:
        movement = str(Decimal(forecast_final_profit) - data.previous_forecast_profit)

    closed_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    return {
        "company_id": data.company_id,
        "project_id": data.project_id,
        "reporting_month": data.reporting_month,
        "cut_off": data.cut_off.isoformat(),
        "approved_contract": _money_or_missing(data.approved_contract),
        "variations": str(data.variations),
        "approved_dayworks": str(data.approved_dayworks),
        "internal_vow": _money_or_missing(data.internal_vow),
        "certified_value": _money_or_missing(data.certified_value),
        "customer_invoiced": str(data.customer_invoiced),
        "cash_received": str(data.cash_received),
        "customer_outstanding": str(customer_outstanding),
        "actual_incurred_cost": str(data.actual_incurred),
        "accrued_cost": str(data.accrued_cost),
        "adjusted_cost": str(adjusted),
        "open_commitments": str(data.open_commitments),
        "additional_ctc": _money_or_missing(data.additional_ctc),
        "forecast_final_cost": forecast_final_cost,
        "forecast_final_profit": forecast_final_profit,
        "forecast_final_margin_percent": forecast_margin_percent,
        "internal_margin_to_date": internal_margin,
        "certified_margin_to_date": certified_margin,
        "previous_month_forecast_profit_movement": movement,
        "validation_status": validation,
        "revision": str(revision),
        "supersedes_revision": MISSING if supersedes is None else str(supersedes),
        "author_user_id": data.author_user_id,
        "closed_at": closed_at,
        "immutable": "true",
        "note": "Closed snapshot values are frozen in this payload. Do not replace with live queries.",
    }


def assert_can_close(
    *,
    reporting_month: str,
    active_revisions: dict[str, int],
    allow_revision: bool,
) -> None:
    """Reject a second active close unless an explicit revision workflow is used."""
    if reporting_month in active_revisions and not allow_revision:
        raise MonthlyCvrError(
            "An active monthly CVR already exists for this reporting month. "
            "Use an approved revision workflow; do not create a conflicting active snapshot."
        )


def superseding_close(
    data: MonthlyCvrInput,
    *,
    previous_payload: dict[str, str],
) -> tuple[dict[str, str], dict[str, str]]:
    """Return (original_preserved, new_revision). Original is unchanged."""
    previous_revision = int(previous_payload["revision"])
    new_payload = build_monthly_cvr_payload(
        data,
        revision=previous_revision + 1,
        supersedes=previous_revision,
    )
    return previous_payload, new_payload
