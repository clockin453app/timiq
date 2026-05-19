"""Audit events for sensitive PAYE payroll mutations."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.modules.auth.models import SystemRole, User
from app.modules.paye_payroll.calculation import tax_month_bounds
from app.modules.paye_payroll.models import MonthlyPayeItem, MonthlyPayePayComponent, MonthlyPayePeriod
from app.modules.paye_payroll.schemas import (
    CompanyPayeSettingsPatchRequest,
    EmployeePayeSettingsPatchRequest,
    PayePayComponentCreateRequest,
    PayePayComponentPatchRequest,
)
from app.modules.paye_payroll.service import (
    PayePayrollPermissionError,
    approve_monthly_paye_period,
    create_pay_component,
    delete_pay_component,
    mark_monthly_paye_period_paid,
    patch_company_paye_settings,
    patch_employee_paye_settings,
    patch_pay_component,
    recalculate_monthly_paye,
    undo_paid_monthly_paye_period,
    unlock_approved_monthly_paye_period,
)

FORBIDDEN_DETAIL_TERMS = (
    "calculation_snapshot",
    "component_snapshot",
    "overtime_policy_snapshot",
    "time_record_source_snapshot",
    "token",
    "cookie",
    "password",
    "storage_path",
    "r2",
    "html",
    "pdf",
    "national_insurance",
    "utr",
    "bank",
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
    start, end = tax_month_bounds("2026-2027", 1)
    return MonthlyPayePeriod(
        id=uuid.uuid4(),
        company_id=company_id,
        tax_year="2026-2027",
        tax_month=1,
        period_start=start,
        period_end=end,
        pay_date=end,
        status=status,
        created_at=now,
        updated_at=now,
    )


def _item(company_id: uuid.UUID, user_id: uuid.UUID, *, status: str = "pending") -> MonthlyPayeItem:
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
        status=status,
        created_at=now,
        updated_at=now,
    )


def _component(company_id: uuid.UUID, user_id: uuid.UUID) -> MonthlyPayePayComponent:
    now = datetime.now(timezone.utc)
    return MonthlyPayePayComponent(
        id=uuid.uuid4(),
        company_id=company_id,
        user_id=user_id,
        tax_year="2026-2027",
        tax_month=1,
        period_id=None,
        component_type="bonus",
        description="Q1 bonus",
        amount=Decimal("100.00"),
        taxable=True,
        niable=True,
        pensionable=True,
        created_by_user_id=uuid.uuid4(),
        created_at=now,
        updated_at=now,
    )


def _assert_safe_audit_details(details: dict) -> None:
    blob = json.dumps(details, default=str).lower()
    for term in FORBIDDEN_DETAIL_TERMS:
        assert term not in blob


def _audit_kwargs(mock_audit: MagicMock) -> dict:
    mock_audit.assert_called_once()
    return mock_audit.call_args.kwargs


@patch("app.modules.paye_payroll.service.create_internal_audit_event")
@patch("app.modules.paye_payroll.service.monthly_paye_report", return_value=MagicMock())
@patch("app.modules.paye_payroll.service.paye_repo.list_items_for_period")
@patch("app.modules.paye_payroll.service.paye_repo.list_paye_candidates_for_company", return_value=[])
@patch("app.modules.paye_payroll.service.paye_repo.delete_pending_items_for_period")
@patch("app.modules.paye_payroll.service.paye_repo.clear_component_item_links_for_period")
@patch("app.modules.paye_payroll.service._get_or_create_company_settings")
@patch("app.modules.paye_payroll.service._ensure_tax_year_rule")
def test_recalculate_creates_audit_event(
    mock_tax_year: MagicMock,
    mock_company_settings: MagicMock,
    mock_clear_links: MagicMock,
    mock_delete_pending: MagicMock,
    mock_candidates: MagicMock,
    mock_list_items: MagicMock,
    mock_report: MagicMock,
    mock_audit: MagicMock,
) -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    period = _period(company_id)
    item = _item(company_id, uuid.uuid4())
    mock_tax_year.return_value = MagicMock()
    mock_company_settings.return_value = MagicMock()
    with patch("app.modules.paye_payroll.service.paye_repo.get_monthly_period", return_value=None):
        with patch("app.modules.paye_payroll.service._period_for_tax_month", return_value=period):
            with patch.object(period, "id", period.id, create=True):
                db = MagicMock()
                db.commit = MagicMock()
                mock_list_items.return_value = [item]
                recalculate_monthly_paye(
                    db,
                    actor,
                    company_id=company_id,
                    tax_year="2026-2027",
                    tax_month=1,
                )
    kwargs = _audit_kwargs(mock_audit)
    assert kwargs["action"] == "paye_monthly_recalculated"
    assert kwargs["entity_type"] == "monthly_paye_period"
    assert kwargs["entity_id"] == str(period.id)
    assert kwargs["company_id"] == company_id
    _assert_safe_audit_details(kwargs["details"])


@patch("app.modules.paye_payroll.service.create_internal_audit_event")
@patch("app.modules.paye_payroll.service.monthly_paye_report", return_value=MagicMock())
@patch("app.modules.paye_payroll.service.paye_repo.list_items_for_period")
@patch("app.modules.paye_payroll.service.paye_repo.get_monthly_period_by_id")
def test_approve_period_creates_audit_event(
    mock_get_period: MagicMock,
    mock_list_items: MagicMock,
    mock_report: MagicMock,
    mock_audit: MagicMock,
) -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    period = _period(company_id, status="pending")
    item = _item(company_id, uuid.uuid4(), status="pending")
    mock_get_period.return_value = period
    mock_list_items.return_value = [item]
    approve_monthly_paye_period(MagicMock(), actor, period.id)
    kwargs = _audit_kwargs(mock_audit)
    assert kwargs["action"] == "paye_period_approved"
    assert kwargs["entity_type"] == "monthly_paye_period"
    _assert_safe_audit_details(kwargs["details"])
    assert kwargs["details"]["status_before"] == "pending"
    assert kwargs["details"]["status_after"] == "approved"


@patch("app.modules.paye_payroll.service.create_internal_audit_event")
@patch("app.modules.paye_payroll.service.monthly_paye_report", return_value=MagicMock())
@patch("app.modules.paye_payroll.service.paye_repo.list_items_for_period")
@patch("app.modules.paye_payroll.service.paye_repo.get_monthly_period_by_id")
def test_mark_paid_creates_audit_event(
    mock_get_period: MagicMock,
    mock_list_items: MagicMock,
    mock_report: MagicMock,
    mock_audit: MagicMock,
) -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    period = _period(company_id, status="approved")
    item = _item(company_id, uuid.uuid4(), status="approved")
    mock_get_period.return_value = period
    mock_list_items.return_value = [item]
    mark_monthly_paye_period_paid(MagicMock(), actor, period.id)
    kwargs = _audit_kwargs(mock_audit)
    assert kwargs["action"] == "paye_period_marked_paid"
    _assert_safe_audit_details(kwargs["details"])


@patch("app.modules.paye_payroll.service.create_internal_audit_event")
@patch("app.modules.paye_payroll.service.monthly_paye_report", return_value=MagicMock())
@patch("app.modules.paye_payroll.service.paye_repo.list_items_for_period")
@patch("app.modules.paye_payroll.service.paye_repo.get_monthly_period_by_id")
def test_undo_paid_creates_audit_event(
    mock_get_period: MagicMock,
    mock_list_items: MagicMock,
    mock_report: MagicMock,
    mock_audit: MagicMock,
) -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    period = _period(company_id, status="paid")
    item = _item(company_id, uuid.uuid4(), status="paid")
    mock_get_period.return_value = period
    mock_list_items.return_value = [item]
    undo_paid_monthly_paye_period(MagicMock(), actor, period.id)
    kwargs = _audit_kwargs(mock_audit)
    assert kwargs["action"] == "paye_period_undo_paid"
    _assert_safe_audit_details(kwargs["details"])


@patch("app.modules.paye_payroll.service.create_internal_audit_event")
@patch("app.modules.paye_payroll.service.monthly_paye_report", return_value=MagicMock())
@patch("app.modules.paye_payroll.service.paye_repo.list_items_for_period")
@patch("app.modules.paye_payroll.service.paye_repo.get_monthly_period_by_id")
def test_unlock_approved_creates_audit_event(
    mock_get_period: MagicMock,
    mock_list_items: MagicMock,
    mock_report: MagicMock,
    mock_audit: MagicMock,
) -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    period = _period(company_id, status="approved")
    item = _item(company_id, uuid.uuid4(), status="approved")
    mock_get_period.return_value = period
    mock_list_items.return_value = [item]
    unlock_approved_monthly_paye_period(MagicMock(), actor, period.id)
    kwargs = _audit_kwargs(mock_audit)
    assert kwargs["action"] == "paye_period_unlocked_to_pending"
    _assert_safe_audit_details(kwargs["details"])


@patch("app.modules.paye_payroll.service.create_internal_audit_event")
@patch("app.modules.paye_payroll.service._component_response")
@patch("app.modules.paye_payroll.service.paye_repo.save_pay_component")
@patch("app.modules.paye_payroll.service.paye_repo.get_monthly_period", return_value=None)
@patch("app.modules.paye_payroll.service._target_paye_employee_for_component")
@patch("app.modules.paye_payroll.service._assert_components_unlocked")
def test_component_create_creates_audit_event(
    mock_unlocked: MagicMock,
    mock_target: MagicMock,
    mock_get_period: MagicMock,
    mock_save: MagicMock,
    mock_response: MagicMock,
    mock_audit: MagicMock,
) -> None:
    company_id = uuid.uuid4()
    user_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    component = _component(company_id, user_id)
    mock_response.return_value = MagicMock()
    db = MagicMock()

    def _save(_db, row):
        row.id = component.id
        return row

    mock_save.side_effect = _save
    create_pay_component(
        db,
        actor,
        PayePayComponentCreateRequest(
            company_id=company_id,
            user_id=user_id,
            tax_year="2026-2027",
            tax_month=1,
            component_type="bonus",
            description="Bonus",
            amount=Decimal("100.00"),
            taxable=True,
            niable=True,
            pensionable=True,
        ),
    )
    kwargs = _audit_kwargs(mock_audit)
    assert kwargs["action"] == "paye_component_created"
    assert kwargs["entity_type"] == "monthly_paye_pay_component"
    _assert_safe_audit_details(kwargs["details"])


@patch("app.modules.paye_payroll.service.create_internal_audit_event")
@patch("app.modules.paye_payroll.service._component_response")
@patch("app.modules.paye_payroll.service._target_paye_employee_for_component")
@patch("app.modules.paye_payroll.service._assert_components_unlocked")
@patch("app.modules.paye_payroll.service.paye_repo.get_pay_component_by_id")
def test_component_update_creates_audit_event(
    mock_get: MagicMock,
    mock_unlocked: MagicMock,
    mock_target: MagicMock,
    mock_response: MagicMock,
    mock_audit: MagicMock,
) -> None:
    company_id = uuid.uuid4()
    user_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    component = _component(company_id, user_id)
    mock_get.return_value = component
    mock_response.return_value = MagicMock()
    db = MagicMock()
    patch_pay_component(
        db,
        actor,
        component.id,
        PayePayComponentPatchRequest(amount=Decimal("150.00")),
    )
    kwargs = _audit_kwargs(mock_audit)
    assert kwargs["action"] == "paye_component_updated"
    assert kwargs["details"]["changed_fields"] == ["amount"]
    _assert_safe_audit_details(kwargs["details"])


@patch("app.modules.paye_payroll.service.create_internal_audit_event")
@patch("app.modules.paye_payroll.service.paye_repo.delete_pay_component")
@patch("app.modules.paye_payroll.service._target_paye_employee_for_component")
@patch("app.modules.paye_payroll.service._assert_components_unlocked")
@patch("app.modules.paye_payroll.service.paye_repo.get_pay_component_by_id")
def test_component_delete_creates_audit_event(
    mock_get: MagicMock,
    mock_unlocked: MagicMock,
    mock_target: MagicMock,
    mock_delete: MagicMock,
    mock_audit: MagicMock,
) -> None:
    company_id = uuid.uuid4()
    user_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    component = _component(company_id, user_id)
    mock_get.return_value = component
    db = MagicMock()
    delete_pay_component(db, actor, component.id)
    kwargs = _audit_kwargs(mock_audit)
    assert kwargs["action"] == "paye_component_deleted"
    assert kwargs["entity_id"] == str(component.id)
    _assert_safe_audit_details(kwargs["details"])


@patch("app.modules.paye_payroll.service.create_internal_audit_event")
@patch("app.modules.paye_payroll.service.EmployeePayeSettingsResponse.model_validate")
def test_employee_settings_update_creates_audit_event(
    mock_validate: MagicMock,
    mock_audit: MagicMock,
) -> None:
    company_id = uuid.uuid4()
    target = _user(SystemRole.EMPLOYEE, company_id=company_id)
    actor = _user(SystemRole.ADMINISTRATOR)
    row = SimpleNamespace(user_id=target.id, company_id=company_id)
    mock_validate.return_value = MagicMock()
    db = MagicMock()
    with (
        patch("app.modules.paye_payroll.service._target_employee_for_actor", return_value=target),
        patch("app.modules.paye_payroll.service._get_or_create_employee_settings", return_value=row),
    ):
        patch_employee_paye_settings(
            db,
            actor,
            target.id,
            EmployeePayeSettingsPatchRequest(tax_basis="month1"),
        )
    kwargs = _audit_kwargs(mock_audit)
    assert kwargs["action"] == "paye_employee_settings_updated"
    assert kwargs["entity_type"] == "employee_paye_settings"
    assert kwargs["details"]["changed_fields"] == ["tax_basis"]
    _assert_safe_audit_details(kwargs["details"])


@patch("app.modules.paye_payroll.service.create_internal_audit_event")
@patch("app.modules.paye_payroll.service.CompanyPayeSettingsResponse.model_validate")
def test_company_settings_update_creates_audit_event(
    mock_validate: MagicMock,
    mock_audit: MagicMock,
) -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    row = SimpleNamespace(company_id=company_id)
    mock_validate.return_value = MagicMock()
    db = MagicMock()
    with patch("app.modules.paye_payroll.service._get_or_create_company_settings", return_value=row):
        patch_company_paye_settings(
            db,
            actor,
            CompanyPayeSettingsPatchRequest(company_id=company_id, paye_overtime_enabled=True),
        )
    kwargs = _audit_kwargs(mock_audit)
    assert kwargs["action"] == "paye_company_settings_updated"
    assert kwargs["entity_type"] == "company_paye_settings"
    assert kwargs["details"]["changed_fields"] == ["paye_overtime_enabled"]
    _assert_safe_audit_details(kwargs["details"])


@patch("app.modules.paye_payroll.service.create_internal_audit_event")
@patch("app.modules.paye_payroll.service.paye_repo.get_monthly_period_by_id")
def test_blocked_approve_does_not_create_audit_event(
    mock_get_period: MagicMock,
    mock_audit: MagicMock,
) -> None:
    company_id = uuid.uuid4()
    actor = _user(SystemRole.ADMINISTRATOR)
    mock_get_period.return_value = _period(company_id, status="approved")
    with pytest.raises(PayePayrollPermissionError):
        approve_monthly_paye_period(MagicMock(), actor, uuid.uuid4())
    mock_audit.assert_not_called()
