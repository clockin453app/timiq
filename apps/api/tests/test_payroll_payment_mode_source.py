"""Employee payment mode source and payslip display labels."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.modules.auth.models import SystemRole
from app.modules.employee_profiles.schemas import EmployeeProfileUpdateRequest
from app.modules.employee_profiles.service import update_profile_for_actor_or_user_id
from app.modules.payroll.schemas import PayrollItemPatchRequest, PayrollItemResponse, PayrollPaySplit, PayrollReportAlerts
from app.modules.payroll.service import (
    PayrollApprovedBlockingError,
    PayrollError,
    PayrollPaidBlockingError,
    _payment_mode_label_for_item,
    patch_payroll_item,
    recalculate_payroll,
    render_payroll_item_payslip_html,
    render_payroll_item_payslip_pdf,
)


def _actor() -> SimpleNamespace:
    return SimpleNamespace(id=uuid.uuid4(), company_id=uuid.uuid4(), system_role=SystemRole.ADMINISTRATOR)


def _employee(company_id: uuid.UUID) -> SimpleNamespace:
    return SimpleNamespace(id=uuid.uuid4(), company_id=company_id, system_role=SystemRole.EMPLOYEE, email="employee@example.com")


def _profile(*, user_id: uuid.UUID, company_id: uuid.UUID, payment_mode: str | None) -> SimpleNamespace:
    return SimpleNamespace(
        user_id=user_id,
        company_id=company_id,
        hourly_rate=Decimal("20.00"),
        tax_rate=Decimal("20.00"),
        payment_mode=payment_mode,
    )


def test_employee_profile_can_save_gross_payment_mode() -> None:
    actor = _actor()
    target = _employee(actor.company_id)
    profile = _profile(user_id=target.id, company_id=actor.company_id, payment_mode=None)
    with (
        patch("app.modules.employee_profiles.service.get_user_by_id", return_value=target),
        patch("app.modules.employee_profiles.service.get_or_create_profile_for_user", return_value=profile),
        patch("app.modules.employee_profiles.service.can_manage_user", return_value=True),
        patch("app.modules.employee_profiles.service.update_employee_profile", side_effect=lambda _db, p: p),
    ):
        out = update_profile_for_actor_or_user_id(
            MagicMock(),
            actor,
            EmployeeProfileUpdateRequest(payment_mode="gross_payment"),
            user_id=target.id,
        )
    assert out.payment_mode == "gross_payment"


def test_employee_profile_can_save_net_payment_mode() -> None:
    actor = _actor()
    target = _employee(actor.company_id)
    profile = _profile(user_id=target.id, company_id=actor.company_id, payment_mode="gross_payment")
    with (
        patch("app.modules.employee_profiles.service.get_user_by_id", return_value=target),
        patch("app.modules.employee_profiles.service.get_or_create_profile_for_user", return_value=profile),
        patch("app.modules.employee_profiles.service.can_manage_user", return_value=True),
        patch("app.modules.employee_profiles.service.update_employee_profile", side_effect=lambda _db, p: p),
    ):
        out = update_profile_for_actor_or_user_id(
            MagicMock(),
            actor,
            EmployeeProfileUpdateRequest(payment_mode="net_payment"),
            user_id=target.id,
        )
    assert out.payment_mode == "net_payment"


def _recalculate_saved_payment_modes(
    *,
    profile_mode: str | None,
    existing_pending_mode: str | None = None,
    existing_pending_source: str | None = None,
) -> list[tuple[str, str | None]]:
    company_id = uuid.uuid4()
    emp = _employee(company_id)
    period_id = uuid.uuid4()
    saved_items = []

    def save_period(_db, period):
        period.id = period_id
        return period

    def save_item(_db, item):
        item.id = uuid.uuid4()
        item.notes = None
        item.approved_at = None
        item.approved_by_user_id = None
        item.paid_at = None
        item.paid_by_user_id = None
        saved_items.append(item)
        return item

    def item_response(_db, item):
        return PayrollItemResponse(
            id=item.id,
            period_id=item.period_id,
            user_id=item.user_id,
            company_id=item.company_id,
            employee_email="employee@example.com",
            employee_name="Employee Example",
            employee_job_title=None,
            regular_seconds=item.regular_seconds,
            overtime_seconds=item.overtime_seconds,
            rounded_total_seconds=item.rounded_total_seconds,
            hourly_rate_snapshot=Decimal(str(item.hourly_rate_snapshot)) if item.hourly_rate_snapshot is not None else None,
            tax_rate_snapshot=Decimal(str(item.tax_rate_snapshot)) if item.tax_rate_snapshot is not None else None,
            overtime_multiplier_snapshot=Decimal(str(item.overtime_multiplier_snapshot)) if item.overtime_multiplier_snapshot is not None else None,
            gross_amount=Decimal(str(item.gross_amount)) if item.gross_amount is not None else None,
            tax_amount=Decimal(str(item.tax_amount)) if item.tax_amount is not None else None,
            net_amount=Decimal(str(item.net_amount)) if item.net_amount is not None else None,
            other_deductions_amount=Decimal(str(item.other_deductions_amount)),
            display_tax_amount=Decimal(str(item.display_tax_amount)) if item.display_tax_amount is not None else None,
            display_net_amount=Decimal(str(item.display_net_amount)) if item.display_net_amount is not None else None,
            payment_mode=item.payment_mode,
            notes=item.notes,
            policy_snapshot=item.policy_snapshot,
            status=item.status,
            approved_at=item.approved_at,
            approved_by_user_id=item.approved_by_user_id,
            paid_at=item.paid_at,
            paid_by_user_id=item.paid_by_user_id,
            rate_missing=item.rate_missing,
        )

    existing_items = []
    if existing_pending_mode is not None:
        existing_items.append(
            SimpleNamespace(
                status="pending",
                user_id=emp.id,
                payment_mode=existing_pending_mode,
                payment_mode_source=existing_pending_source,
            )
        )

    with (
        patch("app.modules.payroll.service.get_company_by_id", return_value=SimpleNamespace(default_tax_rate=20)),
        patch(
            "app.modules.payroll.service.ensure_company_time_policy",
            return_value=SimpleNamespace(timezone_name="Europe/London", overtime_multiplier=Decimal("1.5"), overtime_after_hours=8.5),
        ),
        patch("app.modules.payroll.service.first_workplace_tax", return_value=None),
        patch("app.modules.payroll.service.get_period_by_company_week", return_value=None),
        patch("app.modules.payroll.service.period_has_paid_item", return_value=False),
        patch("app.modules.payroll.service.period_has_approved_item", return_value=False),
        patch("app.modules.payroll.service.save_period", side_effect=save_period),
        patch("app.modules.payroll.service.list_items_for_period", side_effect=[existing_items, saved_items]),
        patch("app.modules.payroll.service.delete_pending_items_for_period"),
        patch("app.modules.payroll.service.list_cis_employee_users_for_company", return_value=[emp]),
        patch("app.modules.payroll.service.get_employee_profile_by_user_id", return_value=_profile(user_id=emp.id, company_id=company_id, payment_mode=profile_mode)),
        patch("app.modules.payroll.service.sum_rounded_seconds_payroll_week", return_value=3600),
        patch("app.modules.payroll.service.policy_snapshot_dict", return_value={}),
        patch("app.modules.payroll.service.save_item", side_effect=save_item),
        patch("app.modules.payroll.service.create_internal_audit_event"),
        patch(
            "app.modules.payroll.service._build_report_alerts",
            return_value=PayrollReportAlerts(
                pending_approval_count=0,
                open_shifts_started_in_week_count=0,
                rate_missing_employees_count=0,
                zero_rounded_hours_employees_count=0,
                payroll_period_not_calculated=False,
            ),
        ),
        patch(
            "app.modules.payroll.service._build_pay_split",
            return_value=PayrollPaySplit(
                regular_pay=Decimal("0"),
                overtime_pay=Decimal("0"),
                other_pay=Decimal("0"),
                total_gross=Decimal("0"),
            ),
        ),
        patch("app.modules.payroll.service._compute_late_unpaid_employees", return_value=([], 0, 0, 0)),
        patch("app.modules.payroll.service._accounting_export_overlaps_payroll_week", return_value=False),
        patch("app.modules.payroll.service._payroll_approved_leave_rows", return_value=[]),
        patch("app.modules.payroll.service.item_to_response", side_effect=item_response),
    ):
        recalculate_payroll(MagicMock(), _actor(), company_id=company_id, week_start=date(2026, 5, 11))
    return [(item.payment_mode, item.payment_mode_source) for item in saved_items]


def test_new_payroll_item_uses_profile_gross_payment_when_no_pending_item() -> None:
    assert _recalculate_saved_payment_modes(profile_mode="gross_payment") == [("gross_payment", "profile")]


def test_new_payroll_item_uses_profile_net_payment_when_no_pending_item() -> None:
    assert _recalculate_saved_payment_modes(profile_mode="net_payment") == [("net_payment", "profile")]


def test_pending_profile_sourced_item_refreshes_from_profile_mode() -> None:
    assert _recalculate_saved_payment_modes(
        profile_mode="gross_payment",
        existing_pending_mode="net_payment",
        existing_pending_source="profile",
    ) == [("gross_payment", "profile")]


def test_pending_manual_item_payment_mode_wins_over_profile_mode() -> None:
    assert _recalculate_saved_payment_modes(
        profile_mode="gross_payment",
        existing_pending_mode="net_payment",
        existing_pending_source="manual",
    ) == [("net_payment", "manual")]


def test_missing_profile_payment_mode_defaults_to_net_payment() -> None:
    assert _recalculate_saved_payment_modes(profile_mode=None) == [("net_payment", "profile")]


def test_payment_mode_label_handles_known_and_missing_modes() -> None:
    assert _payment_mode_label_for_item(SimpleNamespace(payment_mode="gross_payment")) == "Gross payment"
    assert _payment_mode_label_for_item(SimpleNamespace(payment_mode="net_payment")) == "Net payment"
    assert _payment_mode_label_for_item(SimpleNamespace(payment_mode=None)) == "Not provided"


@patch("app.modules.payroll.service.update_item", side_effect=lambda _db, item: item)
@patch("app.modules.payroll.service.create_internal_audit_event")
@patch("app.modules.payroll.service.item_to_response", side_effect=lambda _db, item: item)
@patch("app.modules.payroll.service.get_item_by_id")
def test_patch_payment_mode_sets_manual_source_only_when_mode_changes(
    mock_get: MagicMock,
    _mock_response: MagicMock,
    _mock_audit: MagicMock,
    _mock_update: MagicMock,
) -> None:
    item = SimpleNamespace(
        id=uuid.uuid4(),
        status="pending",
        company_id=uuid.uuid4(),
        payment_mode="net_payment",
        payment_mode_source="profile",
        notes=None,
        other_deductions_amount=0,
        display_tax_amount=None,
        display_net_amount=None,
        rate_missing=True,
    )
    mock_get.return_value = item
    actor = SimpleNamespace(system_role=SystemRole.ADMINISTRATOR, company_id=None, id=uuid.uuid4())

    patch_payroll_item(MagicMock(), actor, item.id, PayrollItemPatchRequest(payment_mode="net_payment"))
    assert item.payment_mode_source == "profile"

    patch_payroll_item(MagicMock(), actor, item.id, PayrollItemPatchRequest(payment_mode="gross_payment"))
    assert item.payment_mode == "gross_payment"
    assert item.payment_mode_source == "manual"


@patch("app.modules.payroll.service.get_item_by_id")
def test_paid_row_still_rejects_payment_mode_edit(mock_get: MagicMock) -> None:
    item = SimpleNamespace(id=uuid.uuid4(), status="paid", company_id=uuid.uuid4())
    mock_get.return_value = item
    actor = SimpleNamespace(system_role=SystemRole.ADMINISTRATOR, company_id=None, id=uuid.uuid4())
    with pytest.raises(PayrollError, match="locked"):
        patch_payroll_item(MagicMock(), actor, item.id, PayrollItemPatchRequest(payment_mode="gross_payment"))


def test_recalculate_still_blocks_paid_period() -> None:
    company_id = uuid.uuid4()
    actor = _actor()
    period = SimpleNamespace(id=uuid.uuid4(), company_id=company_id, week_start=date(2026, 5, 11))
    with (
        patch("app.modules.payroll.service.get_company_by_id", return_value=SimpleNamespace(default_tax_rate=20)),
        patch("app.modules.payroll.service.ensure_company_time_policy", return_value=SimpleNamespace(timezone_name="Europe/London")),
        patch("app.modules.payroll.service.first_workplace_tax", return_value=None),
        patch("app.modules.payroll.service.get_period_by_company_week", return_value=period),
        patch("app.modules.payroll.service.period_has_paid_item", return_value=True),
    ):
        with pytest.raises(PayrollPaidBlockingError):
            recalculate_payroll(MagicMock(), actor, company_id=company_id, week_start=period.week_start)


def test_recalculate_still_blocks_approved_period() -> None:
    company_id = uuid.uuid4()
    actor = _actor()
    period = SimpleNamespace(id=uuid.uuid4(), company_id=company_id, week_start=date(2026, 5, 11))
    with (
        patch("app.modules.payroll.service.get_company_by_id", return_value=SimpleNamespace(default_tax_rate=20)),
        patch("app.modules.payroll.service.ensure_company_time_policy", return_value=SimpleNamespace(timezone_name="Europe/London")),
        patch("app.modules.payroll.service.first_workplace_tax", return_value=None),
        patch("app.modules.payroll.service.get_period_by_company_week", return_value=period),
        patch("app.modules.payroll.service.period_has_paid_item", return_value=False),
        patch("app.modules.payroll.service.period_has_approved_item", return_value=True),
    ):
        with pytest.raises(PayrollApprovedBlockingError):
            recalculate_payroll(MagicMock(), actor, company_id=company_id, week_start=period.week_start)


def _payslip_item(payment_mode: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        company_id=uuid.uuid4(),
        period_id=uuid.uuid4(),
        status="paid",
        paid_at=datetime(2026, 5, 18, 9, 0, tzinfo=timezone.utc),
        approved_at=None,
        payment_mode=payment_mode,
        regular_seconds=3600,
        overtime_seconds=0,
        rounded_total_seconds=3600,
        gross_amount=Decimal("20.00"),
        tax_amount=Decimal("4.00"),
        display_tax_amount=None,
        net_amount=Decimal("16.00"),
        display_net_amount=None,
        other_deductions_amount=Decimal("0.00"),
        hourly_rate_snapshot=Decimal("20.00"),
        rate_missing=False,
    )


def _payslip_context(payment_mode: str):
    item = _payslip_item(payment_mode)
    owner = SimpleNamespace(id=item.user_id, email="employee@example.com", system_role=SystemRole.EMPLOYEE, company_id=item.company_id)
    period = SimpleNamespace(id=item.period_id, week_start=date(2026, 5, 11), timezone_name="Europe/London")
    actor = owner
    return item, period, owner, actor


def test_payslip_html_displays_gross_payment_label() -> None:
    item, period, owner, actor = _payslip_context("gross_payment")
    with (
        patch("app.modules.payroll.service._load_item_period_owner", return_value=(item, period, owner)),
        patch("app.modules.payroll.service._compute_ytd_for_item", return_value=(Decimal("20.00"), Decimal("0.00"))),
        patch("app.modules.payroll.service.get_company_by_id", return_value=SimpleNamespace(name="Company")),
        patch("app.modules.payroll.service._employee_tax_identifiers_for_payroll", return_value=(None, None)),
        patch("app.modules.payroll.service._employee_primary_name", return_value="Employee Example"),
        patch("app.modules.payroll.service.create_internal_audit_event"),
    ):
        assert "Gross payment" in render_payroll_item_payslip_html(MagicMock(), actor, item.id)


def test_payslip_html_displays_net_payment_label() -> None:
    item, period, owner, actor = _payslip_context("net_payment")
    with (
        patch("app.modules.payroll.service._load_item_period_owner", return_value=(item, period, owner)),
        patch("app.modules.payroll.service._compute_ytd_for_item", return_value=(Decimal("20.00"), Decimal("4.00"))),
        patch("app.modules.payroll.service.get_company_by_id", return_value=SimpleNamespace(name="Company")),
        patch("app.modules.payroll.service._employee_tax_identifiers_for_payroll", return_value=(None, None)),
        patch("app.modules.payroll.service._employee_primary_name", return_value="Employee Example"),
        patch("app.modules.payroll.service.create_internal_audit_event"),
    ):
        assert "Net payment" in render_payroll_item_payslip_html(MagicMock(), actor, item.id)


def test_payslip_pdf_receives_item_payment_mode_label() -> None:
    item, period, owner, actor = _payslip_context("gross_payment")
    with (
        patch("app.modules.payroll.service._load_item_period_owner", return_value=(item, period, owner)),
        patch("app.modules.payroll.service._compute_ytd_for_item", return_value=(Decimal("20.00"), Decimal("0.00"))),
        patch("app.modules.payroll.service.get_company_by_id", return_value=SimpleNamespace(name="Company")),
        patch("app.modules.payroll.service._employee_tax_identifiers_for_payroll", return_value=(None, None)),
        patch("app.modules.payroll.service._employee_primary_name", return_value="Employee Example"),
        patch("app.modules.payroll.service.create_internal_audit_event"),
        patch("app.modules.payroll.service.build_payroll_item_payslip_pdf", return_value=b"%PDF") as build_pdf,
    ):
        render_payroll_item_payslip_pdf(MagicMock(), actor, item.id)
    assert build_pdf.call_args.kwargs["payment_mode_label"] == "Gross payment"
