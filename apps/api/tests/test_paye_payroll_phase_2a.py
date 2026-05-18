from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.modules.auth.dependencies import get_authenticated_user
from app.modules.auth.models import SystemRole, User
from app.modules.payroll.calculation import compute_money_bundle
from app.modules.paye_payroll.calculation import (
    calculate_employee_ni_category_a,
    calculate_employer_ni_category_a,
    calculate_fixed_monthly_salary,
    tax_month_bounds,
)
from app.modules.paye_payroll.models import MonthlyPayeItem, MonthlyPayePayComponent, MonthlyPayePeriod
from app.modules.paye_payroll.schemas import PayePayComponentCreateRequest, PayePayComponentPatchRequest
from app.modules.paye_payroll.service import (
    PayePayrollPermissionError,
    _assign_ytd,
    _calculated_item,
    _calculated_hourly_item,
    _summary,
    approve_monthly_paye_period,
    create_pay_component,
    mark_monthly_paye_period_paid,
    patch_pay_component,
    recalculate_monthly_paye,
    undo_paid_monthly_paye_period,
    unlock_approved_monthly_paye_period,
)


def _user(role: SystemRole, *, company_id: uuid.UUID | None = None) -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        company_id=company_id,
        email=f"{role.value}-{uuid.uuid4()}@example.com",
        password_hash="hashed",
        system_role=role,
        is_active=True,
        created_at=now,
        updated_at=now,
    )


def _period(company_id: uuid.UUID, *, status: str = "pending") -> MonthlyPayePeriod:
    now = datetime.now(timezone.utc)
    return MonthlyPayePeriod(
        id=uuid.uuid4(),
        company_id=company_id,
        tax_year="2026-2027",
        tax_month=1,
        period_start=tax_month_bounds("2026-2027", 1)[0],
        period_end=tax_month_bounds("2026-2027", 1)[1],
        pay_date=tax_month_bounds("2026-2027", 1)[1],
        status=status,
        created_at=now,
        updated_at=now,
    )


def _item(company_id: uuid.UUID, user_id: uuid.UUID, *, unsupported_reason: str | None = None) -> MonthlyPayeItem:
    now = datetime.now(timezone.utc)
    return MonthlyPayeItem(
        id=uuid.uuid4(),
        period_id=uuid.uuid4(),
        company_id=company_id,
        user_id=user_id,
        payroll_type="paye_employee",
        pay_frequency="monthly",
        salary_type="fixed_monthly_salary",
        monthly_salary=Decimal("3000"),
        tax_code="1257L",
        tax_basis="cumulative",
        ni_category="A",
        student_loan_plan="none",
        postgraduate_loan=False,
        pension_enrolment_status="not_eligible",
        employee_pension_percent=Decimal("0"),
        employer_pension_percent=Decimal("0"),
        pension_scheme_basis="qualifying_earnings",
        pension_relief_method="relief_at_source",
        gross_pay=Decimal("3000"),
        taxable_pay=Decimal("3000"),
        niable_pay=Decimal("3000"),
        pensionable_pay=Decimal("0"),
        paye_tax=Decimal("390.50"),
        employee_ni=Decimal("156.16"),
        employer_ni=Decimal("387.45"),
        employee_pension=Decimal("0"),
        employer_pension=Decimal("0"),
        student_loan=Decimal("0"),
        postgraduate_loan_deduction=Decimal("0"),
        other_deductions=Decimal("0"),
        additions=Decimal("0"),
        total_deductions=Decimal("546.66"),
        net_pay=Decimal("2453.34"),
        status="pending",
        calculation_snapshot={},
        unsupported_reason=unsupported_reason,
        created_at=now,
        updated_at=now,
    )


def _component(
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    component_type: str = "bonus",
    amount: Decimal = Decimal("100.00"),
    taxable: bool = True,
    niable: bool = True,
    pensionable: bool = True,
) -> MonthlyPayePayComponent:
    now = datetime.now(timezone.utc)
    return MonthlyPayePayComponent(
        id=uuid.uuid4(),
        company_id=company_id,
        user_id=user_id,
        tax_year="2026-2027",
        tax_month=1,
        component_type=component_type,
        description=component_type,
        amount=amount,
        taxable=taxable,
        niable=niable,
        pensionable=pensionable,
        created_by_user_id=uuid.uuid4(),
        created_at=now,
        updated_at=now,
    )


def test_paye_tax_month_date_boundaries() -> None:
    assert tax_month_bounds("2026-2027", 1) == (__import__("datetime").date(2026, 4, 6), __import__("datetime").date(2026, 5, 5))
    assert tax_month_bounds("2026-2027", 9) == (__import__("datetime").date(2026, 12, 6), __import__("datetime").date(2027, 1, 5))
    assert tax_month_bounds("2026-2027", 12) == (__import__("datetime").date(2027, 3, 6), __import__("datetime").date(2027, 4, 5))


def test_fixed_salary_1257l_cumulative_and_month1_tax() -> None:
    cumulative = calculate_fixed_monthly_salary(
        monthly_salary=Decimal("3000"),
        tax_code="1257L",
        tax_basis="cumulative",
        tax_month=1,
        ni_category="A",
        pension_enrolment_status="not_eligible",
        employee_pension_percent=Decimal("0"),
        employer_pension_percent=Decimal("0"),
        pension_scheme_basis="qualifying_earnings",
        pension_relief_method="relief_at_source",
        student_loan_plan="none",
        postgraduate_loan=False,
    )
    month1 = {**cumulative}
    month1 = calculate_fixed_monthly_salary(
        monthly_salary=Decimal("3000"),
        tax_code="1257L",
        tax_basis="month1",
        tax_month=7,
        ni_category="A",
        pension_enrolment_status="not_eligible",
        employee_pension_percent=Decimal("0"),
        employer_pension_percent=Decimal("0"),
        pension_scheme_basis="qualifying_earnings",
        pension_relief_method="relief_at_source",
        student_loan_plan="none",
        postgraduate_loan=False,
    )
    assert cumulative["gross_pay"] == Decimal("3000.00")
    assert cumulative["paye_tax"] == Decimal("390.50")
    assert month1["paye_tax"] == Decimal("390.50")


def test_ni_category_a_employee_and_employer_ni_net_effect() -> None:
    out = calculate_fixed_monthly_salary(
        monthly_salary=Decimal("3000"),
        tax_code="1257L",
        tax_basis="month1",
        tax_month=1,
        ni_category="A",
        pension_enrolment_status="not_eligible",
        employee_pension_percent=Decimal("0"),
        employer_pension_percent=Decimal("0"),
        pension_scheme_basis="qualifying_earnings",
        pension_relief_method="relief_at_source",
        student_loan_plan="none",
        postgraduate_loan=False,
    )
    assert calculate_employee_ni_category_a(Decimal("3000")) == Decimal("156.16")
    assert calculate_employer_ni_category_a(Decimal("3000")) == Decimal("387.45")
    assert out["employee_ni"] == Decimal("156.16")
    assert out["employer_ni"] == Decimal("387.45")
    assert out["net_pay"] == Decimal("2453.34")


def test_bonus_and_commission_components_feed_gross_tax_ni_and_pension() -> None:
    out = calculate_fixed_monthly_salary(
        monthly_salary=Decimal("3000"),
        tax_code="1257L",
        tax_basis="month1",
        tax_month=1,
        ni_category="A",
        pension_enrolment_status="enrolled",
        employee_pension_percent=Decimal("5"),
        employer_pension_percent=Decimal("3"),
        pension_scheme_basis="qualifying_earnings",
        pension_relief_method="net_pay_arrangement",
        student_loan_plan="none",
        postgraduate_loan=False,
        taxable_additions=Decimal("300"),
        niable_additions=Decimal("300"),
        pensionable_additions=Decimal("300"),
        gross_additions=Decimal("300"),
    )
    assert out["gross_pay"] == Decimal("3300.00")
    assert out["taxable_pay"] == Decimal("3161.00")
    assert out["niable_pay"] == Decimal("3300.00")
    assert out["pensionable_pay"] == Decimal("2780.00")


def test_non_pensionable_component_does_not_increase_pensionable_pay() -> None:
    out = calculate_fixed_monthly_salary(
        monthly_salary=Decimal("3000"),
        tax_code="1257L",
        tax_basis="month1",
        tax_month=1,
        ni_category="A",
        pension_enrolment_status="enrolled",
        employee_pension_percent=Decimal("5"),
        employer_pension_percent=Decimal("3"),
        pension_scheme_basis="qualifying_earnings",
        pension_relief_method="net_pay_arrangement",
        student_loan_plan="none",
        postgraduate_loan=False,
        taxable_additions=Decimal("100"),
        niable_additions=Decimal("100"),
        pensionable_additions=Decimal("0"),
        gross_additions=Decimal("100"),
    )
    assert out["gross_pay"] == Decimal("3100.00")
    assert out["pensionable_pay"] == Decimal("2480.00")


def test_pension_employee_deducts_and_employer_does_not_reduce_net() -> None:
    out = calculate_fixed_monthly_salary(
        monthly_salary=Decimal("3000"),
        tax_code="1257L",
        tax_basis="month1",
        tax_month=1,
        ni_category="A",
        pension_enrolment_status="enrolled",
        employee_pension_percent=Decimal("5"),
        employer_pension_percent=Decimal("3"),
        pension_scheme_basis="qualifying_earnings",
        pension_relief_method="net_pay_arrangement",
        student_loan_plan="none",
        postgraduate_loan=False,
    )
    assert out["pensionable_pay"] == Decimal("2480.00")
    assert out["employee_pension"] == Decimal("124.00")
    assert out["employer_pension"] == Decimal("74.40")
    assert out["taxable_pay"] == Decimal("2876.00")
    assert out["net_pay"] == Decimal("2354.14")


def test_student_and_postgraduate_loans_below_and_above_thresholds() -> None:
    below = calculate_fixed_monthly_salary(
        monthly_salary=Decimal("2000"),
        tax_code="1257L",
        tax_basis="month1",
        tax_month=1,
        ni_category="A",
        pension_enrolment_status="not_eligible",
        employee_pension_percent=Decimal("0"),
        employer_pension_percent=Decimal("0"),
        pension_scheme_basis="qualifying_earnings",
        pension_relief_method="relief_at_source",
        student_loan_plan="plan_2",
        postgraduate_loan=False,
    )
    above = calculate_fixed_monthly_salary(
        monthly_salary=Decimal("3000"),
        tax_code="1257L",
        tax_basis="month1",
        tax_month=1,
        ni_category="A",
        pension_enrolment_status="not_eligible",
        employee_pension_percent=Decimal("0"),
        employer_pension_percent=Decimal("0"),
        pension_scheme_basis="qualifying_earnings",
        pension_relief_method="relief_at_source",
        student_loan_plan="plan_2",
        postgraduate_loan=True,
    )
    assert below["student_loan"] == Decimal("0")
    assert above["student_loan"] == Decimal("49")
    assert above["postgraduate_loan_deduction"] == Decimal("75")


def test_unsupported_tax_code_and_ni_category_fail_safely() -> None:
    unsupported_tax = calculate_fixed_monthly_salary(
        monthly_salary=Decimal("3000"),
        tax_code="S1257L",
        tax_basis="month1",
        tax_month=1,
        ni_category="A",
        pension_enrolment_status="not_eligible",
        employee_pension_percent=Decimal("0"),
        employer_pension_percent=Decimal("0"),
        pension_scheme_basis="qualifying_earnings",
        pension_relief_method="relief_at_source",
        student_loan_plan="none",
        postgraduate_loan=False,
    )
    unsupported_ni = calculate_fixed_monthly_salary(
        monthly_salary=Decimal("3000"),
        tax_code="1257L",
        tax_basis="month1",
        tax_month=1,
        ni_category="B",
        pension_enrolment_status="not_eligible",
        employee_pension_percent=Decimal("0"),
        employer_pension_percent=Decimal("0"),
        pension_scheme_basis="qualifying_earnings",
        pension_relief_method="relief_at_source",
        student_loan_plan="none",
        postgraduate_loan=False,
    )
    assert unsupported_tax["unsupported_reason"]
    assert unsupported_tax["gross_pay"] is None
    assert unsupported_ni["unsupported_reason"] == "NI category must be A for Phase 2A."


def test_unsupported_rows_are_excluded_from_totals_and_block_approval() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    period = _period(company_id)
    supported = _item(company_id, uuid.uuid4())
    unsupported = _item(company_id, uuid.uuid4(), unsupported_reason="Tax code BR is not supported.")
    summary = _summary([supported, unsupported])
    assert summary.employees == 1
    assert summary.total_gross == Decimal("3000.00")
    db = MagicMock()
    with (
        patch("app.modules.paye_payroll.repository.get_monthly_period_by_id", return_value=period),
        patch("app.modules.paye_payroll.repository.list_items_for_period", return_value=[supported, unsupported]),
    ):
        try:
            approve_monthly_paye_period(db, actor, period.id)
            raise AssertionError("Expected unsupported row approval block")
        except PayePayrollPermissionError:
            pass


def test_ytd_uses_paye_items_only_and_cis_calculation_unchanged() -> None:
    company_id = uuid.uuid4()
    current = _item(company_id, uuid.uuid4())
    prior = _item(company_id, current.user_id)
    prior.gross_pay = Decimal("1000")
    prior.taxable_pay = Decimal("1000")
    prior.paye_tax = Decimal("100")
    _assign_ytd(current, [prior])
    assert current.ytd_gross_pay == Decimal("4000.00")
    assert current.ytd_paye_tax == Decimal("490.50")
    cis = compute_money_bundle(
        regular_seconds=3600,
        overtime_seconds=0,
        hourly_rate=Decimal("10.00"),
        overtime_multiplier=Decimal("1.5"),
        tax_rate_percent=Decimal("20"),
        other_deductions=Decimal("0"),
        payment_mode="net_payment",
    )
    assert cis["gross_amount"] == Decimal("10.0000")
    assert cis["tax_amount"] == Decimal("2.00")
    assert cis["net_amount"] == Decimal("8.00")


def test_calculated_item_snapshots_and_links_bonus_commission_components() -> None:
    company_id = uuid.uuid4()
    user = _user(SystemRole.EMPLOYEE, company_id=company_id)
    period = _period(company_id)
    settings = SimpleNamespace(
        pay_frequency="monthly",
        salary_type="fixed_monthly_salary",
        monthly_salary=Decimal("3000"),
        tax_code="1257L",
        tax_basis="month1",
        ni_category="A",
        student_loan_plan="none",
        postgraduate_loan=False,
        pension_enrolment_status="not_eligible",
        employee_pension_percent=Decimal("0"),
        employer_pension_percent=Decimal("0"),
        pension_scheme_basis="qualifying_earnings",
        pension_relief_method="relief_at_source",
    )
    company_settings = SimpleNamespace(default_employee_pension_percent=None, default_employer_pension_percent=None)
    bonus = _component(company_id, user.id, component_type="bonus", amount=Decimal("100"))
    commission = _component(company_id, user.id, component_type="commission", amount=Decimal("50"))
    with patch("app.modules.paye_payroll.repository.list_prior_items_for_user_tax_year", return_value=[]):
        item = _calculated_item(
            MagicMock(),
            period=period,
            user=user,
            profile=SimpleNamespace(payroll_type="paye_employee"),
            settings=settings,
            company_settings=company_settings,
            components=[bonus, commission],
        )
    assert item.bonus_pay == Decimal("100.00")
    assert item.commission_pay == Decimal("50.00")
    assert item.component_pay == Decimal("150.00")
    assert item.gross_pay == Decimal("3150.00")
    assert item.ytd_gross_pay == Decimal("3150.00")
    assert item.component_snapshot[0]["type"] == "bonus"


def test_phase_4b_hourly_foundation_fields_do_not_affect_fixed_salary_calculation() -> None:
    company_id = uuid.uuid4()
    user = _user(SystemRole.EMPLOYEE, company_id=company_id)
    period = _period(company_id)
    settings = SimpleNamespace(
        pay_frequency="monthly",
        salary_type="fixed_monthly_salary",
        monthly_salary=Decimal("3000"),
        paye_hourly_rate=Decimal("50"),
        paye_uses_time_records=True,
        paye_hour_source="completed_time_shifts",
        tax_code="1257L",
        tax_basis="cumulative",
        ni_category="A",
        student_loan_plan="none",
        postgraduate_loan=False,
        pension_enrolment_status="not_eligible",
        employee_pension_percent=Decimal("0"),
        employer_pension_percent=Decimal("0"),
        pension_scheme_basis="qualifying_earnings",
        pension_relief_method="relief_at_source",
    )
    company_settings = SimpleNamespace(
        default_employee_pension_percent=None,
        default_employer_pension_percent=None,
        paye_overtime_enabled=True,
        paye_overtime_threshold_hours=Decimal("160"),
        paye_overtime_multiplier=Decimal("1.5"),
    )
    with patch("app.modules.paye_payroll.repository.list_prior_items_for_user_tax_year", return_value=[]):
        item = _calculated_item(
            MagicMock(),
            period=period,
            user=user,
            profile=SimpleNamespace(payroll_type="paye_employee"),
            settings=settings,
            company_settings=company_settings,
            components=[],
        )
    assert item.gross_pay == Decimal("3000.00")
    assert item.taxable_pay == Decimal("3000.00")
    assert item.employee_ni == Decimal("156.16")
    assert item.net_pay == Decimal("2453.34")
    assert item.regular_hours is None
    assert item.overtime_hours is None
    assert item.hourly_rate is None
    assert item.overtime_policy_snapshot is None
    assert item.time_record_source_snapshot is None


def test_hourly_employee_remains_unsupported_until_hourly_calculation_phase() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    user = _user(SystemRole.EMPLOYEE, company_id=company_id)
    period = _period(company_id)
    settings = SimpleNamespace(
        pay_frequency="monthly",
        salary_type="hourly",
        monthly_salary=None,
        paye_hourly_rate=Decimal("20"),
        paye_uses_time_records=True,
        paye_hour_source="completed_time_shifts",
        tax_code="1257L",
        tax_basis="cumulative",
        ni_category="A",
        student_loan_plan="none",
        postgraduate_loan=False,
        pension_enrolment_status="not_eligible",
        employee_pension_percent=Decimal("0"),
        employer_pension_percent=Decimal("0"),
        pension_scheme_basis="qualifying_earnings",
        pension_relief_method="relief_at_source",
    )
    db = MagicMock()
    with (
        patch("app.modules.paye_payroll.service._ensure_tax_year_rule"),
        patch("app.modules.paye_payroll.service._get_or_create_company_settings", return_value=SimpleNamespace()),
        patch("app.modules.paye_payroll.repository.get_monthly_period", return_value=period),
        patch("app.modules.paye_payroll.repository.clear_component_item_links_for_period"),
        patch("app.modules.paye_payroll.repository.delete_pending_items_for_period"),
        patch("app.modules.paye_payroll.repository.list_paye_candidates_for_company", return_value=[(user, SimpleNamespace(payroll_type="paye_employee"), settings)]),
        patch("app.modules.paye_payroll.repository.list_pay_components", return_value=[]),
        patch("app.modules.paye_payroll.repository.count_open_time_shifts_for_tax_month", return_value=0),
        patch("app.modules.paye_payroll.repository.list_completed_time_shifts_for_tax_month", return_value=[]),
        patch("app.modules.paye_payroll.service.monthly_paye_report", return_value=MagicMock()),
    ):
        recalculate_monthly_paye(db, actor, company_id=company_id, tax_year="2026-2027", tax_month=1)
    added_items = [call.args[0] for call in db.add.call_args_list if isinstance(call.args[0], MonthlyPayeItem)]
    assert added_items
    assert added_items[0].unsupported_reason == "No completed time shifts found for this PAYE tax month."


def test_hourly_paye_completed_shifts_calculate_gross_using_paye_rate_not_cis_rate() -> None:
    company_id = uuid.uuid4()
    user = _user(SystemRole.EMPLOYEE, company_id=company_id)
    period = _period(company_id)
    settings = SimpleNamespace(
        pay_frequency="monthly",
        salary_type="hourly",
        monthly_salary=None,
        paye_hourly_rate=Decimal("20"),
        paye_uses_time_records=True,
        paye_hour_source="completed_time_shifts",
        tax_code="1257L",
        tax_basis="month1",
        ni_category="A",
        student_loan_plan="none",
        postgraduate_loan=False,
        pension_enrolment_status="not_eligible",
        employee_pension_percent=Decimal("0"),
        employer_pension_percent=Decimal("0"),
        pension_scheme_basis="qualifying_earnings",
        pension_relief_method="relief_at_source",
    )
    company_settings = SimpleNamespace(
        default_employee_pension_percent=None,
        default_employer_pension_percent=None,
        paye_overtime_enabled=False,
        paye_overtime_threshold_hours=None,
        paye_overtime_multiplier=None,
    )
    shift = SimpleNamespace(
        id=uuid.uuid4(),
        clock_in_at=datetime(2026, 4, 7, 8, tzinfo=timezone.utc),
        clock_out_at=datetime(2026, 4, 7, 18, tzinfo=timezone.utc),
        break_seconds=0,
    )
    location = SimpleNamespace(id=uuid.uuid4(), name="Site A")
    profile = SimpleNamespace(payroll_type="paye_employee", hourly_rate=Decimal("999"), early_access_enabled=False)
    metrics = SimpleNamespace(
        actual_seconds=36000,
        counted_seconds=36000,
        rounded_seconds=36000,
        break_seconds=0,
        break_deducted_seconds=0,
    )
    with (
        patch("app.modules.paye_payroll.repository.list_prior_items_for_user_tax_year", return_value=[]),
        patch("app.modules.paye_payroll.service.ensure_company_time_policy", return_value=SimpleNamespace(timezone_name="UTC")),
        patch("app.modules.paye_payroll.repository.count_open_time_shifts_for_tax_month", return_value=0) as open_shifts,
        patch("app.modules.paye_payroll.repository.list_completed_time_shifts_for_tax_month", return_value=[(shift, location)]) as completed_shifts,
        patch("app.modules.paye_payroll.service.effective_time_policy_for_shift", return_value=SimpleNamespace(timezone_name="UTC")),
        patch("app.modules.paye_payroll.service.effective_early_access_for_shift", return_value=False),
        patch("app.modules.paye_payroll.service.time_policy_source_for_shift", return_value="company"),
        patch("app.modules.paye_payroll.service.compute_shift_metrics", return_value=metrics),
    ):
        item = _calculated_hourly_item(
            MagicMock(),
            period=period,
            user=user,
            profile=profile,
            settings=settings,
            company_settings=company_settings,
            components=[],
        )
    assert open_shifts.call_args.kwargs["start_utc"] == datetime(2026, 4, 6, 0, 0, tzinfo=timezone.utc)
    assert open_shifts.call_args.kwargs["end_utc"] == datetime(2026, 5, 6, 0, 0, tzinfo=timezone.utc)
    assert completed_shifts.call_args.kwargs["start_utc"] == datetime(2026, 4, 6, 0, 0, tzinfo=timezone.utc)
    assert completed_shifts.call_args.kwargs["end_utc"] == datetime(2026, 5, 6, 0, 0, tzinfo=timezone.utc)
    assert item.unsupported_reason is None
    assert item.regular_hours == Decimal("10.0000")
    assert item.overtime_hours == Decimal("0.0000")
    assert item.hourly_rate == Decimal("20")
    assert item.regular_pay == Decimal("200.0000")
    assert item.gross_hourly_pay == Decimal("200.0000")
    assert item.gross_pay == Decimal("200.00")
    assert item.taxable_pay == Decimal("200.00")
    assert item.niable_pay == Decimal("200.00")
    assert item.time_record_source_snapshot["shifts"][0]["shift_id"] == str(shift.id)


def test_hourly_paye_overtime_enabled_splits_monthly_threshold_and_components_stack() -> None:
    company_id = uuid.uuid4()
    user = _user(SystemRole.EMPLOYEE, company_id=company_id)
    period = _period(company_id)
    settings = SimpleNamespace(
        pay_frequency="monthly",
        salary_type="hourly",
        monthly_salary=None,
        paye_hourly_rate=Decimal("10"),
        paye_uses_time_records=True,
        paye_hour_source="completed_time_shifts",
        tax_code="1257L",
        tax_basis="month1",
        ni_category="A",
        student_loan_plan="none",
        postgraduate_loan=False,
        pension_enrolment_status="enrolled",
        employee_pension_percent=Decimal("5"),
        employer_pension_percent=Decimal("3"),
        pension_scheme_basis="total_earnings",
        pension_relief_method="net_pay_arrangement",
    )
    company_settings = SimpleNamespace(
        default_employee_pension_percent=None,
        default_employer_pension_percent=None,
        paye_overtime_enabled=True,
        paye_overtime_threshold_hours=Decimal("8"),
        paye_overtime_multiplier=Decimal("1.5"),
    )
    shift = SimpleNamespace(id=uuid.uuid4(), clock_in_at=datetime(2026, 4, 8, 8, tzinfo=timezone.utc), clock_out_at=datetime(2026, 4, 8, 20, tzinfo=timezone.utc), break_seconds=0)
    location = SimpleNamespace(id=uuid.uuid4(), name="Site A")
    metrics = SimpleNamespace(actual_seconds=43200, counted_seconds=43200, rounded_seconds=43200, break_seconds=0, break_deducted_seconds=0)
    bonus = _component(company_id, user.id, component_type="bonus", amount=Decimal("50"), taxable=True, niable=True, pensionable=True)
    with (
        patch("app.modules.paye_payroll.repository.list_prior_items_for_user_tax_year", return_value=[]),
        patch("app.modules.paye_payroll.service.ensure_company_time_policy", return_value=SimpleNamespace(timezone_name="UTC")),
        patch("app.modules.paye_payroll.repository.count_open_time_shifts_for_tax_month", return_value=0),
        patch("app.modules.paye_payroll.repository.list_completed_time_shifts_for_tax_month", return_value=[(shift, location)]),
        patch("app.modules.paye_payroll.service.effective_time_policy_for_shift", return_value=SimpleNamespace(timezone_name="UTC")),
        patch("app.modules.paye_payroll.service.effective_early_access_for_shift", return_value=False),
        patch("app.modules.paye_payroll.service.time_policy_source_for_shift", return_value="company"),
        patch("app.modules.paye_payroll.service.compute_shift_metrics", return_value=metrics),
    ):
        item = _calculated_hourly_item(
            MagicMock(),
            period=period,
            user=user,
            profile=SimpleNamespace(payroll_type="paye_employee", early_access_enabled=False),
            settings=settings,
            company_settings=company_settings,
            components=[bonus],
        )
    assert item.regular_hours == Decimal("8.0000")
    assert item.overtime_hours == Decimal("4.0000")
    assert item.regular_pay == Decimal("80.0000")
    assert item.overtime_pay == Decimal("60.0000")
    assert item.gross_hourly_pay == Decimal("140.0000")
    assert item.bonus_pay == Decimal("50.00")
    assert item.gross_pay == Decimal("190.00")
    assert item.taxable_pay == Decimal("180.50")
    assert item.niable_pay == Decimal("190.00")
    assert item.pensionable_pay == Decimal("190.00")
    assert item.overtime_policy_snapshot["rule"] == "monthly_threshold"


def test_hourly_paye_open_and_missing_completed_shifts_are_unsupported() -> None:
    company_id = uuid.uuid4()
    user = _user(SystemRole.EMPLOYEE, company_id=company_id)
    period = _period(company_id)
    settings = SimpleNamespace(
        pay_frequency="monthly",
        salary_type="hourly",
        monthly_salary=None,
        paye_hourly_rate=Decimal("20"),
        paye_uses_time_records=True,
        paye_hour_source="completed_time_shifts",
        tax_code="1257L",
        tax_basis="month1",
        ni_category="A",
        student_loan_plan="none",
        postgraduate_loan=False,
        pension_enrolment_status="not_eligible",
        employee_pension_percent=Decimal("0"),
        employer_pension_percent=Decimal("0"),
        pension_scheme_basis="qualifying_earnings",
        pension_relief_method="relief_at_source",
    )
    company_settings = SimpleNamespace(default_employee_pension_percent=None, default_employer_pension_percent=None, paye_overtime_enabled=False)
    with (
        patch("app.modules.paye_payroll.service.ensure_company_time_policy", return_value=SimpleNamespace(timezone_name="UTC")),
        patch("app.modules.paye_payroll.repository.count_open_time_shifts_for_tax_month", return_value=1),
    ):
        open_item = _calculated_hourly_item(
            MagicMock(),
            period=period,
            user=user,
            profile=SimpleNamespace(payroll_type="paye_employee"),
            settings=settings,
            company_settings=company_settings,
            components=[],
        )
    assert open_item.unsupported_reason == "Open shifts exist in this PAYE tax month. Close shifts before recalculating."

    with (
        patch("app.modules.paye_payroll.service.ensure_company_time_policy", return_value=SimpleNamespace(timezone_name="UTC")),
        patch("app.modules.paye_payroll.repository.count_open_time_shifts_for_tax_month", return_value=0),
        patch("app.modules.paye_payroll.repository.list_completed_time_shifts_for_tax_month", return_value=[]),
    ):
        empty_item = _calculated_hourly_item(
            MagicMock(),
            period=period,
            user=user,
            profile=SimpleNamespace(payroll_type="paye_employee"),
            settings=settings,
            company_settings=company_settings,
            components=[],
        )
    assert empty_item.unsupported_reason == "No completed time shifts found for this PAYE tax month."


def test_component_management_permissions_and_locking() -> None:
    company_id = uuid.uuid4()
    other_company_id = uuid.uuid4()
    employee = _user(SystemRole.EMPLOYEE, company_id=company_id)
    admin = _user(SystemRole.ADMIN, company_id=company_id)
    other_admin = _user(SystemRole.ADMIN, company_id=other_company_id)
    period = _period(company_id, status="pending")
    db = MagicMock()
    def _save_component(_db: MagicMock, component: MonthlyPayePayComponent) -> MonthlyPayePayComponent:
        component.id = uuid.uuid4()
        return component

    with (
        patch("app.modules.paye_payroll.repository.get_monthly_period", return_value=period),
        patch("app.modules.paye_payroll.service.get_user_by_id", return_value=employee),
        patch("app.modules.paye_payroll.repository.save_pay_component", side_effect=_save_component),
    ):
        created = create_pay_component(
            db,
            admin,
            PayePayComponentCreateRequest(
                company_id=company_id,
                user_id=employee.id,
                tax_year="2026-2027",
                tax_month=1,
                component_type="bonus",
                amount=Decimal("100"),
            ),
        )
    assert created.component_type == "bonus"

    with patch("app.modules.paye_payroll.repository.get_monthly_period", return_value=period):
        try:
            create_pay_component(
                db,
                other_admin,
                PayePayComponentCreateRequest(
                    company_id=company_id,
                    user_id=employee.id,
                    tax_year="2026-2027",
                    tax_month=1,
                    component_type="commission",
                    amount=Decimal("100"),
                ),
            )
            raise AssertionError("Expected company admin scope block")
        except PayePayrollPermissionError:
            pass

    component = _component(company_id, employee.id)
    approved = _period(company_id, status="approved")
    with (
        patch("app.modules.paye_payroll.repository.get_pay_component_by_id", return_value=component),
        patch("app.modules.paye_payroll.repository.get_monthly_period", return_value=approved),
        patch("app.modules.paye_payroll.service.get_user_by_id", return_value=employee),
    ):
        try:
            patch_pay_component(db, admin, component.id, PayePayComponentPatchRequest(amount=Decimal("200")))
            raise AssertionError("Expected approved-period component lock")
        except PayePayrollPermissionError:
            pass

    paid = _period(company_id, status="paid")
    with (
        patch("app.modules.paye_payroll.repository.get_pay_component_by_id", return_value=component),
        patch("app.modules.paye_payroll.repository.get_monthly_period", return_value=paid),
        patch("app.modules.paye_payroll.service.get_user_by_id", return_value=employee),
    ):
        try:
            patch_pay_component(db, admin, component.id, PayePayComponentPatchRequest(amount=Decimal("200")))
            raise AssertionError("Expected paid-period component lock")
        except PayePayrollPermissionError:
            pass


def test_company_admin_scope_and_employee_blocked_for_phase_2a_endpoints() -> None:
    own_company = uuid.uuid4()
    other_company = uuid.uuid4()
    admin = _user(SystemRole.ADMIN, company_id=own_company)
    db = MagicMock()
    with patch("app.modules.paye_payroll.service._ensure_tax_year_rule"):
        try:
            recalculate_monthly_paye(db, admin, company_id=other_company, tax_year="2026-2027", tax_month=1)
            raise AssertionError("Expected company scope block")
        except PayePayrollPermissionError:
            pass
    employee = _user(SystemRole.EMPLOYEE, company_id=own_company)
    client = TestClient(app)
    app.dependency_overrides[get_authenticated_user] = lambda: employee
    try:
        response = client.get("/api/paye-payroll/monthly-report?tax_year=2026-2027&tax_month=1")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_recalculate_blocked_for_approved_or_paid_and_mark_paid_requires_approved() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    db = MagicMock()
    approved = _period(company_id, status="approved")
    paid = _period(company_id, status="paid")
    pending = _period(company_id, status="pending")
    with (
        patch("app.modules.paye_payroll.service._ensure_tax_year_rule"),
        patch("app.modules.paye_payroll.repository.get_monthly_period", return_value=approved),
    ):
        try:
            recalculate_monthly_paye(db, actor, company_id=company_id, tax_year="2026-2027", tax_month=1)
            raise AssertionError("Expected approved recalc block")
        except PayePayrollPermissionError:
            pass
    with (
        patch("app.modules.paye_payroll.service._ensure_tax_year_rule"),
        patch("app.modules.paye_payroll.repository.get_monthly_period", return_value=paid),
    ):
        try:
            recalculate_monthly_paye(db, actor, company_id=company_id, tax_year="2026-2027", tax_month=1)
            raise AssertionError("Expected paid recalc block")
        except PayePayrollPermissionError:
            pass
    with patch("app.modules.paye_payroll.repository.get_monthly_period_by_id", return_value=pending):
        try:
            mark_monthly_paye_period_paid(db, actor, pending.id)
            raise AssertionError("Expected mark-paid block")
        except PayePayrollPermissionError:
            pass


def test_undo_paid_reverts_period_and_items_without_changing_values() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    paid_by = uuid.uuid4()
    approved_by = uuid.uuid4()
    approved_at = datetime.now(timezone.utc)
    paid_at = datetime.now(timezone.utc)
    period = _period(company_id, status="paid")
    period.approved_at = approved_at
    period.approved_by_user_id = approved_by
    period.paid_at = paid_at
    period.paid_by_user_id = paid_by
    item = _item(company_id, uuid.uuid4())
    item.period_id = period.id
    item.status = "paid"
    item.approved_at = approved_at
    item.approved_by_user_id = approved_by
    item.paid_at = paid_at
    item.paid_by_user_id = paid_by
    item.component_snapshot = [{"type": "bonus", "amount": "100.00"}]
    item.calculation_snapshot = {"phase": "2A"}
    before_values = (item.gross_pay, item.paye_tax, item.employee_ni, item.net_pay)
    with (
        patch("app.modules.paye_payroll.repository.get_monthly_period_by_id", return_value=period),
        patch("app.modules.paye_payroll.repository.list_items_for_period", return_value=[item]),
        patch("app.modules.paye_payroll.service.monthly_paye_report", return_value=MagicMock()),
    ):
        undo_paid_monthly_paye_period(MagicMock(), actor, period.id)
    assert period.status == "approved"
    assert period.paid_at is None
    assert period.paid_by_user_id is None
    assert period.approved_at == approved_at
    assert period.approved_by_user_id == approved_by
    assert item.status == "approved"
    assert item.paid_at is None
    assert item.paid_by_user_id is None
    assert item.approved_at == approved_at
    assert item.approved_by_user_id == approved_by
    assert (item.gross_pay, item.paye_tax, item.employee_ni, item.net_pay) == before_values
    assert item.component_snapshot == [{"type": "bonus", "amount": "100.00"}]
    assert item.calculation_snapshot == {"phase": "2A"}


def test_unlock_approved_reverts_period_and_items_without_changing_values() -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    approved_by = uuid.uuid4()
    approved_at = datetime.now(timezone.utc)
    period = _period(company_id, status="approved")
    period.approved_at = approved_at
    period.approved_by_user_id = approved_by
    item = _item(company_id, uuid.uuid4())
    item.period_id = period.id
    item.status = "approved"
    item.approved_at = approved_at
    item.approved_by_user_id = approved_by
    item.component_snapshot = [{"type": "bonus", "amount": "100.00"}]
    item.overtime_policy_snapshot = {"enabled": False}
    item.time_record_source_snapshot = {"source": "completed_time_shifts"}
    item.calculation_snapshot = {"phase": "2A"}
    before_values = (
        item.gross_pay,
        item.taxable_pay,
        item.paye_tax,
        item.employee_ni,
        item.net_pay,
        item.ytd_gross_pay,
        item.ytd_net_pay,
    )
    with (
        patch("app.modules.paye_payroll.repository.get_monthly_period_by_id", return_value=period),
        patch("app.modules.paye_payroll.repository.list_items_for_period", return_value=[item]),
        patch("app.modules.paye_payroll.service.monthly_paye_report", return_value=MagicMock()),
    ):
        unlock_approved_monthly_paye_period(MagicMock(), actor, period.id)
    assert period.status == "pending"
    assert period.approved_at is None
    assert period.approved_by_user_id is None
    assert item.status == "pending"
    assert item.approved_at is None
    assert item.approved_by_user_id is None
    assert (
        item.gross_pay,
        item.taxable_pay,
        item.paye_tax,
        item.employee_ni,
        item.net_pay,
        item.ytd_gross_pay,
        item.ytd_net_pay,
    ) == before_values
    assert item.component_snapshot == [{"type": "bonus", "amount": "100.00"}]
    assert item.overtime_policy_snapshot == {"enabled": False}
    assert item.time_record_source_snapshot == {"source": "completed_time_shifts"}
    assert item.calculation_snapshot == {"phase": "2A"}


def test_company_admin_unlock_approved_scope_and_invalid_status_blocks() -> None:
    own_company = uuid.uuid4()
    other_company = uuid.uuid4()
    admin = _user(SystemRole.ADMIN, company_id=own_company)
    own_approved = _period(own_company, status="approved")
    own_item = _item(own_company, uuid.uuid4())
    own_item.period_id = own_approved.id
    own_item.status = "approved"
    with (
        patch("app.modules.paye_payroll.repository.get_monthly_period_by_id", return_value=own_approved),
        patch("app.modules.paye_payroll.repository.list_items_for_period", return_value=[own_item]),
        patch("app.modules.paye_payroll.service.monthly_paye_report", return_value=MagicMock()),
    ):
        unlock_approved_monthly_paye_period(MagicMock(), admin, own_approved.id)
    assert own_approved.status == "pending"
    assert own_item.status == "pending"

    other_approved = _period(other_company, status="approved")
    with patch("app.modules.paye_payroll.repository.get_monthly_period_by_id", return_value=other_approved):
        try:
            unlock_approved_monthly_paye_period(MagicMock(), admin, other_approved.id)
            raise AssertionError("Expected company scope block")
        except PayePayrollPermissionError:
            pass

    for status in ("pending", "paid"):
        period = _period(own_company, status=status)
        with patch("app.modules.paye_payroll.repository.get_monthly_period_by_id", return_value=period):
            try:
                unlock_approved_monthly_paye_period(MagicMock(), admin, period.id)
                raise AssertionError(f"Expected unlock-approved block for {status}")
            except PayePayrollPermissionError:
                pass


def test_employee_cannot_unlock_approved_paye_period_endpoint() -> None:
    employee = _user(SystemRole.EMPLOYEE, company_id=uuid.uuid4())
    client = TestClient(app)
    app.dependency_overrides[get_authenticated_user] = lambda: employee
    try:
        response = client.post(f"/api/paye-payroll/periods/{uuid.uuid4()}/unlock-approved")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_company_admin_undo_paid_scope_and_invalid_status_blocks() -> None:
    own_company = uuid.uuid4()
    other_company = uuid.uuid4()
    admin = _user(SystemRole.ADMIN, company_id=own_company)
    own_paid = _period(own_company, status="paid")
    own_item = _item(own_company, uuid.uuid4())
    own_item.period_id = own_paid.id
    own_item.status = "paid"
    with (
        patch("app.modules.paye_payroll.repository.get_monthly_period_by_id", return_value=own_paid),
        patch("app.modules.paye_payroll.repository.list_items_for_period", return_value=[own_item]),
        patch("app.modules.paye_payroll.service.monthly_paye_report", return_value=MagicMock()),
    ):
        undo_paid_monthly_paye_period(MagicMock(), admin, own_paid.id)
    assert own_paid.status == "approved"
    assert own_item.status == "approved"

    other_paid = _period(other_company, status="paid")
    with patch("app.modules.paye_payroll.repository.get_monthly_period_by_id", return_value=other_paid):
        try:
            undo_paid_monthly_paye_period(MagicMock(), admin, other_paid.id)
            raise AssertionError("Expected company scope block")
        except PayePayrollPermissionError:
            pass

    for status in ("pending", "approved"):
        period = _period(own_company, status=status)
        with patch("app.modules.paye_payroll.repository.get_monthly_period_by_id", return_value=period):
            try:
                undo_paid_monthly_paye_period(MagicMock(), admin, period.id)
                raise AssertionError(f"Expected undo-paid block for {status}")
            except PayePayrollPermissionError:
                pass


def test_employee_cannot_undo_paid_paye_period_endpoint() -> None:
    employee = _user(SystemRole.EMPLOYEE, company_id=uuid.uuid4())
    client = TestClient(app)
    app.dependency_overrides[get_authenticated_user] = lambda: employee
    try:
        response = client.post(f"/api/paye-payroll/periods/{uuid.uuid4()}/undo-paid")
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()
