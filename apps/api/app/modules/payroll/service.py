"""Payroll orchestration: recalculate, approvals, exports."""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.companies.repository import get_company_by_id
from app.modules.companies.service import ensure_company_time_policy
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id
from app.modules.payroll.calculation import (
    compute_money_bundle,
    policy_snapshot_dict,
    resolve_effective_tax_rate_percent,
    split_regular_overtime,
    sum_rounded_seconds_payroll_week,
    week_bounds_utc,
)
from app.modules.payroll.models import PayrollItem, PayrollPeriod
from app.modules.payroll.permissions import (
    PayrollPermissionError,
    assert_payroll_admin_or_administrator,
    assert_payroll_company_scope,
)
from app.modules.payroll.repository import (
    count_open_shifts_started_in_week,
    delete_non_paid_items_for_period,
    first_workplace_tax,
    get_item_by_id,
    get_period_by_company_week,
    list_employee_users_for_company,
    list_items_for_period,
    list_items_for_user_pay_history,
    list_periods_for_company_month,
    period_has_paid_item,
    save_item,
    save_period,
    update_item,
)
from app.modules.payroll.schemas import (
    PayHistoryEntry,
    PayrollItemPatchRequest,
    PayrollItemResponse,
    PayrollMonthSummaryResponse,
    PayrollPaySplit,
    PayrollPeriodSummary,
    PayrollReportAlerts,
    PayrollReportResponse,
)


class PayrollError(ValueError):
    pass


class PayrollPaidBlockingError(PayrollError):
    pass


class PayrollItemStateError(PayrollError):
    pass


def _decimal_or_none(value: object | None) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


def _employee_display(
    db_session: Session,
    user_id: uuid.UUID,
) -> tuple[str | None, str | None, str | None]:
    user = get_user_by_id(db_session, user_id)
    if user is None:
        return None, None, None
    profile = get_employee_profile_by_user_id(db_session, user_id)
    if profile is None:
        return user.email, None, None
    first = (profile.first_name or "").strip()
    last = (profile.last_name or "").strip()
    name = f"{first} {last}".strip() if first or last else None
    job_title = (profile.job_title or "").strip() or None
    return user.email, name, job_title


def _item_regular_overtime_pay_components(item: PayrollItem) -> tuple[Decimal, Decimal]:
    if item.rate_missing:
        return Decimal(0), Decimal(0)
    hourly = _decimal_or_none(item.hourly_rate_snapshot)
    if hourly is None:
        return Decimal(0), Decimal(0)
    mult = _decimal_or_none(item.overtime_multiplier_snapshot) or Decimal(1)
    reg_h = Decimal(item.regular_seconds) / Decimal(3600)
    ot_h = Decimal(item.overtime_seconds) / Decimal(3600)
    reg_p = (reg_h * hourly).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    ot_p = (ot_h * hourly * mult).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    return reg_p, ot_p


def _build_pay_split(items: list[PayrollItem]) -> PayrollPaySplit:
    reg = Decimal(0)
    ot = Decimal(0)
    for i in items:
        rp, op = _item_regular_overtime_pay_components(i)
        reg += rp
        ot += op
    tg = Decimal(0)
    has_gross = False
    for i in items:
        if i.gross_amount is not None:
            tg += Decimal(str(i.gross_amount))
            has_gross = True
    return PayrollPaySplit(
        regular_pay=reg,
        overtime_pay=ot,
        other_pay=Decimal(0),
        total_gross=tg if has_gross else None,
    )


def _build_report_alerts(
    db_session: Session,
    *,
    company_id: uuid.UUID,
    policy,
    week_start: date,
    period: PayrollPeriod | None,
    all_items: list[PayrollItem],
) -> PayrollReportAlerts:
    week_start_utc, week_end_utc = week_bounds_utc(policy, week_start)
    open_n = count_open_shifts_started_in_week(
        db_session,
        company_id=company_id,
        week_start_utc=week_start_utc,
        week_end_utc=week_end_utc,
    )
    pending = sum(1 for i in all_items if i.status == "pending")
    rate_missing = sum(1 for i in all_items if i.rate_missing)
    zero_hours = sum(1 for i in all_items if i.rounded_total_seconds == 0)
    not_calculated = period is None or period.calculated_at is None
    return PayrollReportAlerts(
        pending_approval_count=pending,
        open_shifts_started_in_week_count=open_n,
        rate_missing_employees_count=rate_missing,
        zero_rounded_hours_employees_count=zero_hours,
        payroll_period_not_calculated=not_calculated,
    )


def item_to_response(db_session: Session, item: PayrollItem) -> PayrollItemResponse:
    email, name, job_title = _employee_display(db_session, item.user_id)
    return PayrollItemResponse(
        id=item.id,
        period_id=item.period_id,
        user_id=item.user_id,
        company_id=item.company_id,
        employee_email=email,
        employee_name=name,
        employee_job_title=job_title,
        regular_seconds=item.regular_seconds,
        overtime_seconds=item.overtime_seconds,
        rounded_total_seconds=item.rounded_total_seconds,
        hourly_rate_snapshot=_decimal_or_none(item.hourly_rate_snapshot),
        tax_rate_snapshot=_decimal_or_none(item.tax_rate_snapshot),
        overtime_multiplier_snapshot=_decimal_or_none(item.overtime_multiplier_snapshot),
        gross_amount=_decimal_or_none(item.gross_amount),
        tax_amount=_decimal_or_none(item.tax_amount),
        net_amount=_decimal_or_none(item.net_amount),
        other_deductions_amount=Decimal(str(item.other_deductions_amount or 0)),
        display_tax_amount=_decimal_or_none(item.display_tax_amount),
        display_net_amount=_decimal_or_none(item.display_net_amount),
        payment_mode=item.payment_mode,
        notes=item.notes,
        policy_snapshot=item.policy_snapshot or {},
        status=item.status,
        approved_at=item.approved_at,
        approved_by_user_id=item.approved_by_user_id,
        paid_at=item.paid_at,
        paid_by_user_id=item.paid_by_user_id,
        rate_missing=item.rate_missing,
    )


def _summarize_period(
    db_session: Session,
    period: PayrollPeriod,
    items: list[PayrollItem],
) -> PayrollPeriodSummary:
    pending = sum(1 for i in items if i.status == "pending")
    approved = sum(1 for i in items if i.status == "approved")
    paid = sum(1 for i in items if i.status == "paid")
    tr = tor = tt = tg = tn = Decimal(0)
    for i in items:
        tr += i.regular_seconds
        tor += i.overtime_seconds
        tt += i.rounded_total_seconds
        if i.gross_amount is not None:
            tg += Decimal(str(i.gross_amount))
        if i.display_net_amount is not None:
            tn += Decimal(str(i.display_net_amount))
        elif i.net_amount is not None:
            tn += Decimal(str(i.net_amount))
    total_tax = Decimal(0)
    for i in items:
        if i.display_tax_amount is not None:
            total_tax += Decimal(str(i.display_tax_amount))
        elif i.tax_amount is not None:
            total_tax += Decimal(str(i.tax_amount))
    other_sum = sum(Decimal(str(i.other_deductions_amount or 0)) for i in items)
    return PayrollPeriodSummary(
        id=period.id,
        company_id=period.company_id,
        week_start=period.week_start,
        timezone_name=period.timezone_name,
        calculated_at=period.calculated_at,
        calculated_by_user_id=period.calculated_by_user_id,
        total_items=len(items),
        pending_count=pending,
        approved_count=approved,
        paid_count=paid,
        total_regular_seconds=tr,
        total_overtime_seconds=tor,
        total_rounded_seconds=tt,
        total_gross=tg if items else None,
        total_tax=total_tax if items else None,
        total_net=tn if items else None,
        total_other_deductions=other_sum,
    )


def get_payroll_report(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID,
    week_start: date,
    user_id: uuid.UUID | None = None,
) -> PayrollReportResponse:
    assert_payroll_admin_or_administrator(actor)
    assert_payroll_company_scope(actor, company_id)
    policy = ensure_company_time_policy(db_session, company_id)
    period = get_period_by_company_week(db_session, company_id, week_start)
    if period is None:
        empty = PayrollPeriodSummary(
            id=uuid.UUID("00000000-0000-0000-0000-000000000000"),
            company_id=company_id,
            week_start=week_start,
            timezone_name=policy.timezone_name,
            calculated_at=None,
            calculated_by_user_id=None,
            total_items=0,
            pending_count=0,
            approved_count=0,
            paid_count=0,
            total_regular_seconds=0,
            total_overtime_seconds=0,
            total_rounded_seconds=0,
            total_gross=None,
            total_tax=None,
            total_net=None,
            total_other_deductions=Decimal(0),
        )
        alerts = _build_report_alerts(
            db_session,
            company_id=company_id,
            policy=policy,
            week_start=week_start,
            period=None,
            all_items=[],
        )
        split = _build_pay_split([])
        return PayrollReportResponse(period=empty, items=[], alerts=alerts, split=split)

    all_items = list_items_for_period(db_session, period.id)
    if user_id is not None:
        target = get_user_by_id(db_session, user_id)
        if (
            target is None
            or target.company_id != company_id
            or target.system_role != SystemRole.EMPLOYEE
        ):
            raise PayrollError("Invalid employee filter.")
        display_items = [i for i in all_items if i.user_id == user_id]
    else:
        display_items = all_items

    alerts = _build_report_alerts(
        db_session,
        company_id=company_id,
        policy=policy,
        week_start=week_start,
        period=period,
        all_items=all_items,
    )
    split = _build_pay_split(all_items)
    return PayrollReportResponse(
        period=_summarize_period(db_session, period, all_items),
        items=[item_to_response(db_session, i) for i in display_items],
        alerts=alerts,
        split=split,
    )


def get_payroll_month_summary(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID,
    year: int,
    month: int,
) -> PayrollMonthSummaryResponse:
    assert_payroll_admin_or_administrator(actor)
    assert_payroll_company_scope(actor, company_id)
    if month < 1 or month > 12 or year < 2000 or year > 2100:
        raise PayrollError("Invalid month or year.")
    periods = list_periods_for_company_month(db_session, company_id, year=year, month=month)
    all_items: list[PayrollItem] = []
    user_ids: set[uuid.UUID] = set()
    for p in periods:
        for row in list_items_for_period(db_session, p.id):
            all_items.append(row)
            user_ids.add(row.user_id)
    tr = tor = tt = 0
    tg = tn = total_tax = Decimal(0)
    other_sum = Decimal(0)
    has_gross = has_net = has_tax = False
    for i in all_items:
        tr += i.regular_seconds
        tor += i.overtime_seconds
        tt += i.rounded_total_seconds
        if i.gross_amount is not None:
            tg += Decimal(str(i.gross_amount))
            has_gross = True
        if i.display_net_amount is not None:
            tn += Decimal(str(i.display_net_amount))
            has_net = True
        elif i.net_amount is not None:
            tn += Decimal(str(i.net_amount))
            has_net = True
        if i.display_tax_amount is not None:
            total_tax += Decimal(str(i.display_tax_amount))
            has_tax = True
        elif i.tax_amount is not None:
            total_tax += Decimal(str(i.tax_amount))
            has_tax = True
        other_sum += Decimal(str(i.other_deductions_amount or 0))
    return PayrollMonthSummaryResponse(
        company_id=company_id,
        year=year,
        month=month,
        payroll_weeks=len(periods),
        distinct_employees=len(user_ids),
        total_regular_seconds=tr,
        total_overtime_seconds=tor,
        total_rounded_seconds=tt,
        total_gross=tg if has_gross else None,
        total_tax=total_tax if has_tax else None,
        total_net=tn if has_net else None,
        total_other_deductions=other_sum,
        total_days=None,
    )


def recalculate_payroll(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID,
    week_start: date,
) -> PayrollReportResponse:
    assert_payroll_admin_or_administrator(actor)
    assert_payroll_company_scope(actor, company_id)
    company = get_company_by_id(db_session, company_id)
    if company is None:
        raise PayrollError("Company not found.")
    policy = ensure_company_time_policy(db_session, company_id)
    workplace_tax = first_workplace_tax(db_session, company_id)
    default_tax = float(company.default_tax_rate) if company.default_tax_rate is not None else None

    period = get_period_by_company_week(db_session, company_id, week_start)
    if period is not None and period_has_paid_item(db_session, period.id):
        raise PayrollPaidBlockingError(
            "Cannot recalculate: this period contains paid payroll items.",
        )
    if period is None:
        period = PayrollPeriod(
            company_id=company_id,
            week_start=week_start,
            timezone_name=policy.timezone_name,
        )
    else:
        period.timezone_name = policy.timezone_name
    period = save_period(db_session, period)
    delete_non_paid_items_for_period(db_session, period.id)

    employees = list_employee_users_for_company(db_session, company_id)
    now = datetime.now(timezone.utc)
    ot_mult = Decimal(str(policy.overtime_multiplier))

    for emp in employees:
        profile = get_employee_profile_by_user_id(db_session, emp.id)
        total_r = sum_rounded_seconds_payroll_week(
            db_session,
            company_id=company_id,
            user_id=emp.id,
            week_start=week_start,
            policy=policy,
        )
        reg_s, ot_s = split_regular_overtime(total_r, policy.overtime_after_hours)
        hourly = None
        if profile is not None and profile.hourly_rate is not None:
            hourly = Decimal(str(profile.hourly_rate))
        tax_pct = resolve_effective_tax_rate_percent(profile, default_tax, workplace_tax)
        other_d = Decimal(0)
        bundle = compute_money_bundle(
            regular_seconds=reg_s,
            overtime_seconds=ot_s,
            hourly_rate=hourly,
            overtime_multiplier=ot_mult,
            tax_rate_percent=tax_pct,
            other_deductions=other_d,
        )
        snap = policy_snapshot_dict(policy)
        item = PayrollItem(
            period_id=period.id,
            user_id=emp.id,
            company_id=company_id,
            regular_seconds=reg_s,
            overtime_seconds=ot_s,
            rounded_total_seconds=total_r,
            hourly_rate_snapshot=float(hourly) if hourly is not None else None,
            tax_rate_snapshot=float(tax_pct) if tax_pct is not None else None,
            overtime_multiplier_snapshot=float(ot_mult),
            gross_amount=float(bundle["gross_amount"]) if bundle["gross_amount"] is not None else None,
            tax_amount=float(bundle["tax_amount"]) if bundle["tax_amount"] is not None else None,
            net_amount=float(bundle["net_amount"]) if bundle["net_amount"] is not None else None,
            other_deductions_amount=float(other_d),
            display_tax_amount=float(bundle["display_tax_amount"]) if bundle["display_tax_amount"] is not None else None,
            display_net_amount=float(bundle["display_net_amount"]) if bundle["display_net_amount"] is not None else None,
            policy_snapshot=snap,
            status="pending",
            rate_missing=bool(bundle["rate_missing"]),
        )
        save_item(db_session, item)

    period.calculated_at = now
    period.calculated_by_user_id = actor.id
    save_period(db_session, period)

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="payroll_recalculated",
        entity_type="payroll_period",
        entity_id=str(period.id),
        company_id=company_id,
        details={"week_start": str(week_start)},
    )

    items = list_items_for_period(db_session, period.id)
    policy = ensure_company_time_policy(db_session, company_id)
    alerts = _build_report_alerts(
        db_session,
        company_id=company_id,
        policy=policy,
        week_start=week_start,
        period=period,
        all_items=items,
    )
    split = _build_pay_split(items)
    return PayrollReportResponse(
        period=_summarize_period(db_session, period, items),
        items=[item_to_response(db_session, i) for i in items],
        alerts=alerts,
        split=split,
    )


def patch_payroll_item(
    db_session: Session,
    actor: User,
    item_id: uuid.UUID,
    request: PayrollItemPatchRequest,
) -> PayrollItemResponse:
    assert_payroll_admin_or_administrator(actor)
    item = get_item_by_id(db_session, item_id)
    if item is None:
        raise PayrollError("Payroll item not found.")
    assert_payroll_company_scope(actor, item.company_id)

    if request.notes is not None:
        item.notes = request.notes
    if request.payment_mode is not None:
        item.payment_mode = request.payment_mode
    if request.other_deductions_amount is not None:
        item.other_deductions_amount = float(request.other_deductions_amount)
    if request.display_tax_amount is not None:
        item.display_tax_amount = float(request.display_tax_amount)
    if request.display_net_amount is not None:
        item.display_net_amount = float(request.display_net_amount)

    gross = _decimal_or_none(item.gross_amount)
    tax_for_net = _decimal_or_none(item.display_tax_amount)
    if tax_for_net is None:
        tax_for_net = _decimal_or_none(item.tax_amount)
    other_d = Decimal(str(item.other_deductions_amount or 0))
    if gross is not None and tax_for_net is not None and request.display_net_amount is None:
        net_calc = (gross - tax_for_net - other_d).quantize(Decimal("0.01"))
        item.net_amount = float(net_calc)
        item.display_net_amount = float(net_calc)

    item.updated_at = datetime.now(timezone.utc)
    update_item(db_session, item)

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="payroll_item_edited",
        entity_type="payroll_item",
        entity_id=str(item.id),
        company_id=item.company_id,
        details={},
    )
    return item_to_response(db_session, item)


def approve_item(db_session: Session, actor: User, item_id: uuid.UUID) -> PayrollItemResponse:
    assert_payroll_admin_or_administrator(actor)
    item = get_item_by_id(db_session, item_id)
    if item is None:
        raise PayrollError("Payroll item not found.")
    assert_payroll_company_scope(actor, item.company_id)
    if item.status != "pending":
        raise PayrollItemStateError("Only pending rows can be approved.")
    item.status = "approved"
    item.approved_at = datetime.now(timezone.utc)
    item.approved_by_user_id = actor.id
    update_item(db_session, item)
    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="payroll_item_approved",
        entity_type="payroll_item",
        entity_id=str(item.id),
        company_id=item.company_id,
        details={},
    )
    return item_to_response(db_session, item)


def unlock_item(db_session: Session, actor: User, item_id: uuid.UUID) -> PayrollItemResponse:
    assert_payroll_admin_or_administrator(actor)
    item = get_item_by_id(db_session, item_id)
    if item is None:
        raise PayrollError("Payroll item not found.")
    assert_payroll_company_scope(actor, item.company_id)
    if item.status == "paid":
        raise PayrollItemStateError("Paid rows cannot be unlocked.")
    if item.status != "approved":
        raise PayrollItemStateError("Only approved rows can be unlocked.")
    item.status = "pending"
    item.approved_at = None
    item.approved_by_user_id = None
    update_item(db_session, item)
    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="payroll_item_unlocked",
        entity_type="payroll_item",
        entity_id=str(item.id),
        company_id=item.company_id,
        details={},
    )
    return item_to_response(db_session, item)


def mark_paid_item(db_session: Session, actor: User, item_id: uuid.UUID) -> PayrollItemResponse:
    assert_payroll_admin_or_administrator(actor)
    item = get_item_by_id(db_session, item_id)
    if item is None:
        raise PayrollError("Payroll item not found.")
    assert_payroll_company_scope(actor, item.company_id)
    if item.status != "approved":
        raise PayrollItemStateError("Only approved rows can be marked paid.")
    item.status = "paid"
    item.paid_at = datetime.now(timezone.utc)
    item.paid_by_user_id = actor.id
    update_item(db_session, item)
    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="payroll_item_marked_paid",
        entity_type="payroll_item",
        entity_id=str(item.id),
        company_id=item.company_id,
        details={},
    )
    return item_to_response(db_session, item)


def approve_all_pending(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID,
    week_start: date,
) -> PayrollReportResponse:
    assert_payroll_admin_or_administrator(actor)
    assert_payroll_company_scope(actor, company_id)
    period = get_period_by_company_week(db_session, company_id, week_start)
    if period is None:
        raise PayrollError("Payroll period not found. Run recalculate first.")
    items = list_items_for_period(db_session, period.id)
    for it in items:
        if it.status == "pending":
            it.status = "approved"
            it.approved_at = datetime.now(timezone.utc)
            it.approved_by_user_id = actor.id
            update_item(db_session, it)
    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="payroll_approve_all",
        entity_type="payroll_period",
        entity_id=str(period.id),
        company_id=company_id,
        details={"week_start": str(week_start)},
    )
    items = list_items_for_period(db_session, period.id)
    policy = ensure_company_time_policy(db_session, company_id)
    alerts = _build_report_alerts(
        db_session,
        company_id=company_id,
        policy=policy,
        week_start=week_start,
        period=period,
        all_items=items,
    )
    split = _build_pay_split(items)
    return PayrollReportResponse(
        period=_summarize_period(db_session, period, items),
        items=[item_to_response(db_session, i) for i in items],
        alerts=alerts,
        split=split,
    )


def list_my_pay_history(db_session: Session, actor: User) -> list[PayHistoryEntry]:
    if actor.system_role != SystemRole.EMPLOYEE:
        return []
    items = list_items_for_user_pay_history(db_session, actor.id)
    result: list[PayHistoryEntry] = []
    for i in items:
        period = db_session.get(PayrollPeriod, i.period_id)
        if period is None:
            continue
        result.append(
            PayHistoryEntry(
                id=i.id,
                company_id=i.company_id,
                week_start=period.week_start,
                period_id=i.period_id,
                regular_seconds=i.regular_seconds,
                overtime_seconds=i.overtime_seconds,
                rounded_total_seconds=i.rounded_total_seconds,
                gross_amount=_decimal_or_none(i.gross_amount),
                tax_amount=_decimal_or_none(i.tax_amount),
                net_amount=_decimal_or_none(i.net_amount),
                display_tax_amount=_decimal_or_none(i.display_tax_amount),
                display_net_amount=_decimal_or_none(i.display_net_amount),
                other_deductions_amount=Decimal(str(i.other_deductions_amount or 0)),
                status=i.status,
                approved_at=i.approved_at,
                paid_at=i.paid_at,
                rate_missing=i.rate_missing,
            )
        )
    return result


def export_csv_report(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID,
    week_start: date,
) -> str:
    report = get_payroll_report(db_session, actor, company_id=company_id, week_start=week_start)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "email",
            "name",
            "regular_hours",
            "overtime_hours",
            "total_rounded_hours",
            "hourly_rate_snapshot",
            "tax_rate_snapshot",
            "gross",
            "cis_tax",
            "other_deductions",
            "net",
            "display_tax",
            "display_net",
            "status",
            "payment_mode",
            "rate_missing",
        ],
    )
    for row in report.items:
        writer.writerow(
            [
                row.employee_email or "",
                row.employee_name or "",
                row.regular_seconds / 3600,
                row.overtime_seconds / 3600,
                row.rounded_total_seconds / 3600,
                row.hourly_rate_snapshot,
                row.tax_rate_snapshot,
                row.gross_amount,
                row.tax_amount,
                row.other_deductions_amount,
                row.net_amount,
                row.display_tax_amount,
                row.display_net_amount,
                row.status,
                row.payment_mode or "",
                row.rate_missing,
            ],
        )
    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="payroll_csv_exported",
        entity_type="payroll_period",
        entity_id=str(report.period.id) if report.period.total_items else "",
        company_id=company_id,
        details={"week_start": str(week_start)},
    )
    return buffer.getvalue()


def export_print_html(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID,
    week_start: date,
) -> str:
    company = get_company_by_id(db_session, company_id)
    name = company.name if company else "Company"
    report = get_payroll_report(db_session, actor, company_id=company_id, week_start=week_start)
    rows_html = []
    for row in report.items:
        rows_html.append(
            "<tr>"
            f"<td>{row.employee_email or ''}</td>"
            f"<td>{row.employee_name or ''}</td>"
            f"<td>{row.regular_seconds / 3600:.2f}</td>"
            f"<td>{row.overtime_seconds / 3600:.2f}</td>"
            f"<td>{row.gross_amount or '—'}</td>"
            f"<td>{row.display_tax_amount or row.tax_amount or '—'}</td>"
            f"<td>{row.other_deductions_amount}</td>"
            f"<td>{row.display_net_amount or row.net_amount or '—'}</td>"
            f"<td>{row.status}</td>"
            "</tr>"
        )
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Payroll {name} — {week_start}</title>
<style>
body {{ font-family: system-ui, sans-serif; margin: 24px; color: #111; }}
h1 {{ font-size: 1.25rem; }}
table {{ border-collapse: collapse; width: 100%; margin-top: 16px; }}
th, td {{ border: 1px solid #ccc; padding: 8px; text-align: left; font-size: 0.875rem; }}
th {{ background: #f4f4f5; }}
@media print {{ body {{ margin: 12px; }} }}
</style></head><body>
<h1>Payroll — {name}</h1>
<p>Week starting {week_start} · {report.period.timezone_name if report.period.total_items else ""}</p>
<table><thead><tr>
<th>Email</th><th>Name</th><th>Regular h</th><th>OT h</th><th>Gross</th><th>CIS tax</th><th>Other ded.</th><th>Net</th><th>Status</th>
</tr></thead><tbody>
{"".join(rows_html)}
</tbody></table>
<p style="margin-top:16px;font-size:12px;color:#666;">Use browser Print → Save as PDF for a PDF copy.</p>
</body></html>"""
    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="payroll_print_exported",
        entity_type="payroll_period",
        entity_id=str(report.period.id) if report.period.total_items else "",
        company_id=company_id,
        details={"week_start": str(week_start)},
    )
    return html
