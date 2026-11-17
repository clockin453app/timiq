"""Cross-module Riverside CVR fixture — Core composers only (fictional mathematics)."""

from datetime import date
from decimal import Decimal

from app.modules.finance.cvr_as_of import compose_as_of_cvr
from app.modules.finance.cvr_forecast import compose_cvr_forecast
from app.modules.finance.supplier_payment_rules import (
    DUPLICATE_EFFECTIVE_ALLOCATION,
    EffectiveAllocation,
    effective_pair_conflict,
)


def test_riverside_cross_module_fixture() -> None:
    original = Decimal("100000")
    variation = Decimal("5000")
    # Core dayworks contribute an amount total only (no experimental chargeout engine).
    daywork_contract = Decimal("1000.0000")
    approved_contract = original + variation + daywork_contract
    assert approved_contract == Decimal("106000.0000")

    non_accrual = Decimal("10000")
    cis_gross = Decimal("2000")
    accrual = Decimal("1000")
    adjusted = non_accrual + cis_gross + accrual
    assert adjusted == Decimal("13000")

    open_commitments = Decimal("3000")
    ctc = Decimal("4000")
    as_of = compose_as_of_cvr(
        cut_off=date(2026, 1, 31),
        contract_known=True,
        original_contract=original,
        approved_variations=variation,
        approved_dayworks_in_contract=daywork_contract,
        non_accrual_eligible_cost=non_accrual,
        cis_labour_gross=cis_gross,
        effective_accrual_balance=accrual,
        open_commitment=open_commitments,
        cost_to_complete=ctc,
        internal_vow=Decimal("20000"),
        certified_value=Decimal("18000"),
        customer_invoiced_net=Decimal("15000"),
        customer_receipts=Decimal("5000"),
    )
    assert Decimal(as_of["actual_incurred_cost"]) == Decimal("12000")
    assert Decimal(as_of["adjusted_incurred_cost"]) == Decimal("13000")
    assert Decimal(as_of["open_commitments"]) == Decimal("3000")
    assert Decimal(as_of["forecast_final_cost"]) == Decimal("20000")
    assert Decimal(as_of["forecast_final_profit"]) == Decimal("86000")
    assert as_of["forecast_final_margin_percent"] == "81.13"
    assert Decimal(as_of["internal_margin_to_date"]) == Decimal("7000")
    assert Decimal(as_of["certified_margin_to_date"]) == Decimal("5000")
    assert Decimal(as_of["customer_outstanding"]) == Decimal("10000")
    # Open commitments excluded from actual incurred.
    assert Decimal(as_of["actual_incurred_cost"]) + Decimal(as_of["effective_accrual_balance"]) == Decimal(
        as_of["adjusted_incurred_cost"]
    )

    forecast = compose_cvr_forecast(
        contract_known=True,
        original_contract=original,
        approved_variations=variation,
        approved_dayworks_in_contract=daywork_contract,
        approved_budget=Decimal("0"),
        actual_eligible_cost=adjusted,
        cis_labour_gross=Decimal("0"),
        open_commitment=open_commitments,
        cost_to_complete=ctc,
    )
    assert Decimal(forecast["forecast_final_cost"]) == Decimal("20000")
    assert Decimal(forecast["forecast_margin"]) == Decimal("86000")

    # CVR-1 guard still rejects duplicate effective payment/invoice pairs.
    payment = "pay-1"
    invoice = "inv-1"
    assert (
        effective_pair_conflict(
            payment_id=payment,
            cost_document_id=invoice,
            existing_effective=[
                EffectiveAllocation(payment_id=payment, cost_document_id=invoice, amount=Decimal("100"))
            ],
        )
        == DUPLICATE_EFFECTIVE_ALLOCATION
    )
