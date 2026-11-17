"""Database-free CVR-8 forecast composition tests."""

from decimal import Decimal

from app.modules.finance.cvr_forecast import MISSING, compose_cvr_forecast


def _compose(
    *,
    contract: Decimal | None,
    eligible: Decimal,
    labour: Decimal = Decimal("0"),
    open_commitment: Decimal = Decimal("0"),
    ctc: Decimal | None = None,
    variations: Decimal = Decimal("0"),
    dayworks: Decimal = Decimal("0"),
    budget: Decimal = Decimal("0"),
) -> dict[str, str]:
    contract_known = contract is not None
    return compose_cvr_forecast(
        contract_known=contract_known,
        original_contract=contract if contract_known else Decimal("0"),
        approved_variations=variations,
        approved_dayworks_in_contract=dayworks,
        approved_budget=budget,
        actual_eligible_cost=eligible,
        cis_labour_gross=labour,
        open_commitment=open_commitment,
        cost_to_complete=ctc,
    )


def test_normal_forecast() -> None:
    result = _compose(
        contract=Decimal("20000.0000"),
        eligible=Decimal("10000.0000"),
        labour=Decimal("1000.0000"),
        open_commitment=Decimal("3000.0000"),
        ctc=Decimal("500.0000"),
    )
    assert result["actual_incurred_cost"] == "11000.0000"
    assert result["open_commitments"] == "3000.0000"
    assert result["open_commitment"] == "3000.0000"
    assert result["forecast_final_cost"] == "14500.0000"
    assert result["forecast_final_profit"] == "5500.0000"
    assert result["forecast_margin"] == "5500.0000"
    assert result["forecast_final_margin_percent"] == "27.50"
    assert "Employer NI" in result["review_required"]
    assert "Accruals are not yet fully supported" in result["review_required"]
    assert "indicative projected profit" in result["review_required"]


def test_no_open_commitments() -> None:
    result = _compose(
        contract=Decimal("10000.0000"),
        eligible=Decimal("4000.0000"),
        open_commitment=Decimal("0"),
        ctc=Decimal("2000.0000"),
    )
    assert result["actual_incurred_cost"] == "4000.0000"
    assert result["forecast_final_cost"] == "6000.0000"
    assert result["forecast_final_profit"] == "4000.0000"
    assert result["forecast_final_margin_percent"] == "40.00"
    assert "automatic overlap detection" not in result["review_required"]


def test_missing_ctc_is_not_zero() -> None:
    result = _compose(
        contract=Decimal("20000.0000"),
        eligible=Decimal("10000.0000"),
        labour=Decimal("1000.0000"),
        open_commitment=Decimal("3000.0000"),
        ctc=None,
    )
    assert result["cost_to_complete"] == MISSING
    assert result["forecast_final_cost"] == MISSING
    assert result["forecast_final_profit"] == MISSING
    assert result["forecast_margin"] == MISSING
    assert result["forecast_final_margin_percent"] == MISSING
    assert "not treated as zero" in result["review_required"]


def test_missing_contract_blocks_profit() -> None:
    result = _compose(
        contract=None,
        eligible=Decimal("1000.0000"),
        open_commitment=Decimal("0"),
        ctc=Decimal("500.0000"),
    )
    assert result["approved_contract_value"] == MISSING
    assert result["forecast_final_cost"] == "1500.0000"
    assert result["forecast_final_profit"] == MISSING
    assert result["forecast_margin"] == MISSING
    assert result["forecast_final_margin_percent"] == MISSING
    assert "No contract value is stored" in result["review_required"]


def test_zero_contract_blocks_percent() -> None:
    result = _compose(
        contract=Decimal("0"),
        eligible=Decimal("100.0000"),
        open_commitment=Decimal("0"),
        ctc=Decimal("0"),
    )
    assert result["approved_contract_value"] == "0"
    assert result["forecast_final_cost"] == "100.0000"
    assert result["forecast_final_profit"] == "-100.0000"
    assert result["forecast_margin"] == "-100.0000"
    assert result["forecast_final_margin_percent"] == MISSING


def test_loss_making_project() -> None:
    result = _compose(
        contract=Decimal("10000.0000"),
        eligible=Decimal("9000.0000"),
        open_commitment=Decimal("3000.0000"),
        ctc=Decimal("1000.0000"),
    )
    assert result["forecast_final_cost"] == "13000.0000"
    assert result["forecast_final_profit"] == "-3000.0000"
    assert result["forecast_margin"] == "-3000.0000"
    assert result["forecast_final_margin_percent"] == "-30.00"


def test_explicit_zero_ctc_distinct_from_missing() -> None:
    missing = _compose(contract=Decimal("10000"), eligible=Decimal("4000"), ctc=None)
    zero = _compose(contract=Decimal("10000"), eligible=Decimal("4000"), ctc=Decimal("0"))
    assert missing["cost_to_complete"] == MISSING
    assert missing["forecast_final_cost"] == MISSING
    assert zero["cost_to_complete"] == "0"
    assert zero["forecast_final_cost"] == "4000"
    assert zero["forecast_final_profit"] == "6000"
    assert zero["forecast_final_margin_percent"] == "60.00"


def test_backward_compatible_legacy_fields() -> None:
    result = _compose(
        contract=Decimal("100000.0000"),
        eligible=Decimal("1000.0000"),
        open_commitment=Decimal("3000.0000"),
        ctc=Decimal("500.0000"),
        variations=Decimal("5000.0000"),
        dayworks=Decimal("1000.0000"),
        budget=Decimal("80000.0000"),
    )
    # Legacy consumers continue to read these keys with GBP meaning.
    assert "forecast_margin" in result
    assert "open_commitment" in result
    assert "actual_eligible_cost" in result
    assert Decimal(result["forecast_final_cost"]) == Decimal("4500.0000")
    assert Decimal(result["forecast_margin"]) == Decimal("101500.0000")
    assert result["forecast_final_profit"] == result["forecast_margin"]
    assert result["approved_contract_value"] == "106000.0000"
    assert result["approved_budget"] == "80000.0000"


def test_open_commitments_not_in_actual_incurred() -> None:
    result = _compose(
        contract=Decimal("20000"),
        eligible=Decimal("10000"),
        labour=Decimal("1000"),
        open_commitment=Decimal("3000"),
        ctc=Decimal("500"),
    )
    assert Decimal(result["actual_incurred_cost"]) == Decimal("11000")
    assert Decimal(result["actual_incurred_cost"]) != Decimal(result["forecast_final_cost"])
    assert Decimal(result["open_commitments"]) == Decimal("3000")
    # Final cost includes commitments; incurred does not.
    assert Decimal(result["forecast_final_cost"]) == (
        Decimal(result["actual_incurred_cost"])
        + Decimal(result["open_commitments"])
        + Decimal(result["cost_to_complete"])
    )
    assert "Open commitments are not actual incurred cost" in result["review_required"]


def test_decimal_precision_without_float_drift() -> None:
    result = _compose(
        contract=Decimal("10000.0000"),
        eligible=Decimal("3333.3333"),
        labour=Decimal("0.0001"),
        open_commitment=Decimal("0.0002"),
        ctc=Decimal("0.0003"),
    )
    assert result["actual_incurred_cost"] == "3333.3334"
    assert result["forecast_final_cost"] == "3333.3339"
    assert result["forecast_final_profit"] == "6666.6661"
    # Percent uses two-decimal money rounding, not binary float.
    assert result["forecast_final_margin_percent"] == "66.67"
    assert "." in result["forecast_final_margin_percent"]
    float(result["forecast_final_margin_percent"])  # parseable, but source was Decimal
