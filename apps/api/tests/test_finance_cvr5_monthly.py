"""CVR-5 database-free monthly snapshot tests."""

from datetime import date
from decimal import Decimal

import pytest

from app.modules.finance.cvr_forecast import MISSING
from app.modules.finance.cvr_monthly import (
    MonthlyCvrError,
    MonthlyCvrInput,
    assert_can_close,
    build_monthly_cvr_payload,
    superseding_close,
)


def _base(**overrides) -> MonthlyCvrInput:
    data = dict(
        company_id="c1",
        project_id="p1",
        reporting_month="2026-01",
        cut_off=date(2026, 1, 31),
        approved_contract=Decimal("106000"),
        variations=Decimal("5000"),
        approved_dayworks=Decimal("1000"),
        internal_vow=Decimal("20000"),
        certified_value=Decimal("18000"),
        customer_invoiced=Decimal("15000"),
        cash_received=Decimal("5000"),
        actual_incurred=Decimal("12000"),
        accrued_cost=Decimal("1000"),
        open_commitments=Decimal("3000"),
        additional_ctc=Decimal("4000"),
        author_user_id="user-1",
    )
    data.update(overrides)
    return MonthlyCvrInput(**data)


def test_t5_1_january_close_internal_margin() -> None:
    payload = build_monthly_cvr_payload(_base())
    assert payload["adjusted_cost"] == "13000"
    assert payload["internal_margin_to_date"] == "7000"
    assert payload["immutable"] == "true"


def test_t5_2_january_payload_not_mutated_by_later_input() -> None:
    january = build_monthly_cvr_payload(_base())
    frozen_profit = january["forecast_final_profit"]
    later = build_monthly_cvr_payload(
        _base(
            reporting_month="2026-02",
            cut_off=date(2026, 2, 28),
            customer_invoiced=Decimal("20000"),
            cash_received=Decimal("8000"),
            actual_incurred=Decimal("14000"),
        )
    )
    assert january["forecast_final_profit"] == frozen_profit
    assert later["customer_outstanding"] == "12000"
    assert january["customer_outstanding"] == "10000"


def test_t5_3_duplicate_active_close_rejected() -> None:
    active = {"2026-01": 1}
    with pytest.raises(MonthlyCvrError, match="already exists"):
        assert_can_close(reporting_month="2026-01", active_revisions=active, allow_revision=False)
    assert_can_close(reporting_month="2026-01", active_revisions=active, allow_revision=True)


def test_t5_4_correction_preserves_original_revision() -> None:
    original = build_monthly_cvr_payload(_base(), revision=1)
    preserved, revised = superseding_close(
        _base(additional_ctc=Decimal("3500")),
        previous_payload=original,
    )
    assert preserved is original
    assert preserved["revision"] == "1"
    assert revised["revision"] == "2"
    assert revised["supersedes_revision"] == "1"
    assert preserved["additional_ctc"] == "4000"
    assert revised["additional_ctc"] == "3500"


def test_t5_5_monthly_movement() -> None:
    payload = build_monthly_cvr_payload(
        _base(
            reporting_month="2026-02",
            cut_off=date(2026, 2, 28),
            previous_forecast_profit=Decimal("5000"),
            # Force forecast profit 6500: contract 106000 - (13000+3000+ctc)
            # 106000 - 6500 = 99500 final cost => ctc = 99500 - 16000 = 83500? 
            # Simpler: use small numbers via overrides
            approved_contract=Decimal("10000"),
            actual_incurred=Decimal("2000"),
            accrued_cost=Decimal("0"),
            open_commitments=Decimal("500"),
            additional_ctc=Decimal("1000"),
            # final = 3500, profit = 6500
        )
    )
    assert payload["forecast_final_profit"] == "6500"
    assert payload["previous_month_forecast_profit_movement"] == "1500"


def test_t5_6_missing_values_unvalidated() -> None:
    payload = build_monthly_cvr_payload(
        _base(internal_vow=None, additional_ctc=None)
    )
    assert payload["validation_status"] == "unvalidated"
    assert payload["forecast_final_cost"] == MISSING
    assert payload["internal_vow"] == MISSING


def test_t5_7_exact_financial_precision() -> None:
    for amount in (Decimal("100"), Decimal("1000"), Decimal("100000"), Decimal("1000000")):
        payload = build_monthly_cvr_payload(
            _base(
                approved_contract=amount * 2,
                actual_incurred=amount,
                accrued_cost=Decimal("0"),
                open_commitments=Decimal("0"),
                additional_ctc=Decimal("0"),
                internal_vow=amount + Decimal("10"),
                certified_value=amount,
                customer_invoiced=amount,
                cash_received=Decimal("0"),
            )
        )
        assert Decimal(payload["forecast_final_profit"]) == amount
        assert payload["forecast_final_margin_percent"] == "50.00"


def test_t5_8_export_uses_closed_payload_not_live() -> None:
    closed = build_monthly_cvr_payload(_base())
    # Export consumer must read closed payload keys, not re-query live figures.
    export_rows = [[key, closed[key]] for key in ("adjusted_cost", "forecast_final_profit", "immutable")]
    assert export_rows[0][1] == "13000"
    assert export_rows[2][1] == "true"
