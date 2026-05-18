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
    _summary,
    approve_monthly_paye_period,
    create_pay_component,
    mark_monthly_paye_period_paid,
    patch_pay_component,
    recalculate_monthly_paye,
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
