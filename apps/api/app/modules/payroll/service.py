"""Payroll orchestration: recalculate, approvals, exports."""

from __future__ import annotations

import csv
import html
import io
import uuid
from datetime import date, datetime, timedelta, timezone
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
from app.modules.onboarding.repository import get_approved_onboarding_national_insurance_number
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
    assert_actor_can_view_payroll_item,
    assert_payroll_admin_or_administrator,
    assert_payroll_company_scope,
)
from app.modules.payroll.repository import (
    count_open_shifts_started_in_week,
    delete_pending_items_for_period,
    first_workplace_tax,
    get_item_by_id,
    get_period_by_company_week,
    list_employee_users_for_company,
    list_items_for_period,
    list_items_for_user_pay_history,
    list_payroll_items_for_user_company_ytd_calendar_year,
    list_periods_for_company_month,
    max_employee_shift_updated_at_in_payroll_week,
    period_has_approved_item,
    period_has_paid_item,
    save_item,
    save_period,
    update_item,
)
from app.modules.payroll.schemas import (
    PayHistoryEntry,
    PayrollItemCompanySnippet,
    PayrollItemPatchRequest,
    PayrollItemResponse,
    PayrollItemSummaryResponse,
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


class PayrollApprovedBlockingError(PayrollError):
    pass


class PayrollItemStateError(PayrollError):
    pass


class PayrollItemNotFoundError(Exception):
    """Missing payroll item or period (maps to HTTP 404)."""


def _decimal_or_none(value: object | None) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


def _effective_tax_amount_for_item(item: PayrollItem) -> Decimal | None:
    """Prefer display CIS when set; if display is exactly zero but calculated tax is non-zero, use calculated."""
    display = _decimal_or_none(item.display_tax_amount)
    calculated = _decimal_or_none(item.tax_amount)
    if display is not None:
        if display == 0 and calculated is not None and calculated != 0:
            return calculated
        return display
    return calculated


def _effective_net_amount_for_item(item: PayrollItem) -> Decimal | None:
    display = _decimal_or_none(item.display_net_amount)
    if display is not None:
        return display
    return _decimal_or_none(item.net_amount)


def _payment_mode_label(payment_mode: str | None) -> str:
    if payment_mode == "net_payment":
        return "Net payment"
    if payment_mode == "gross_payment":
        return "Gross payment"
    return "Not set"


def _week_end_display(week_start: date) -> date:
    return week_start + timedelta(days=6)


def _utc_dt_display_for_payslip(dt: datetime | None) -> str:
    if dt is None:
        return ""
    aware = dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)
    return html.escape(aware.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))


def _employee_primary_name(db_session: Session, user_id: uuid.UUID) -> str:
    email, name, _jt = _employee_display(db_session, user_id)
    if name and str(name).strip():
        return str(name).strip()
    return email or "Employee"


def _compute_ytd_for_item(
    db_session: Session,
    item: PayrollItem,
    period: PayrollPeriod,
) -> tuple[Decimal, Decimal]:
    calendar_year = period.week_start.year
    rows = list_payroll_items_for_user_company_ytd_calendar_year(
        db_session,
        user_id=item.user_id,
        company_id=item.company_id,
        calendar_year=calendar_year,
        through_week_start=period.week_start,
    )
    gross_sum = Decimal(0)
    cis_sum = Decimal(0)
    for row in rows:
        if row.gross_amount is not None:
            gross_sum += Decimal(str(row.gross_amount))
        t = _effective_tax_amount_for_item(row)
        if t is not None:
            cis_sum += t
    return gross_sum, cis_sum


def _load_item_period_owner(
    db_session: Session,
    item_id: uuid.UUID,
) -> tuple[PayrollItem, PayrollPeriod, User]:
    item = get_item_by_id(db_session, item_id)
    if item is None:
        raise PayrollItemNotFoundError("Payroll item not found.")
    period = db_session.get(PayrollPeriod, item.period_id)
    if period is None:
        raise PayrollItemNotFoundError("Payroll item not found.")
    owner = get_user_by_id(db_session, item.user_id)
    if owner is None:
        raise PayrollItemNotFoundError("Payroll item not found.")
    return item, period, owner


def get_payroll_item_summary(db_session: Session, actor: User, item_id: uuid.UUID) -> PayrollItemSummaryResponse:
    item, period, owner = _load_item_period_owner(db_session, item_id)
    assert_actor_can_view_payroll_item(actor, item, owner)
    ytd_pay, ytd_cis = _compute_ytd_for_item(db_session, item, period)
    company = get_company_by_id(db_session, item.company_id)
    cis = _effective_tax_amount_for_item(item)
    net_eff = _effective_net_amount_for_item(item)
    owner_email = owner.email
    return PayrollItemSummaryResponse(
        item_id=item.id,
        company=PayrollItemCompanySnippet(
            id=item.company_id,
            name=company.name if company is not None else "Company",
        ),
        employee_display_name=_employee_primary_name(db_session, item.user_id),
        employee_email=owner_email,
        timezone_name=period.timezone_name,
        week_start=period.week_start,
        week_end=_week_end_display(period.week_start),
        status=item.status,
        approved_at=item.approved_at,
        paid_at=item.paid_at,
        payment_mode=item.payment_mode,
        payment_mode_label=_payment_mode_label(item.payment_mode),
        regular_seconds=item.regular_seconds,
        overtime_seconds=item.overtime_seconds,
        rounded_total_seconds=item.rounded_total_seconds,
        gross_amount=_decimal_or_none(item.gross_amount),
        cis_tax_amount=cis,
        net_amount=net_eff,
        other_deductions_amount=Decimal(str(item.other_deductions_amount or 0)),
        hourly_rate_snapshot=_decimal_or_none(item.hourly_rate_snapshot),
        rate_missing=item.rate_missing,
        ytd_taxable_pay=ytd_pay,
        ytd_cis_deducted=ytd_cis,
        can_open_payslip=True,
    )


def render_payroll_item_payslip_html(db_session: Session, actor: User, item_id: uuid.UUID) -> str:
    item, period, owner = _load_item_period_owner(db_session, item_id)
    assert_actor_can_view_payroll_item(actor, item, owner)
    ytd_pay, ytd_cis = _compute_ytd_for_item(db_session, item, period)
    company = get_company_by_id(db_session, item.company_id)
    cname = html.escape(company.name if company is not None else "Company")
    ename = html.escape(_employee_primary_name(db_session, item.user_id))
    ni = get_approved_onboarding_national_insurance_number(db_session, item.user_id)
    ni_esc = html.escape(ni) if ni else ""
    cis = _effective_tax_amount_for_item(item)
    net_eff = _effective_net_amount_for_item(item)
    gross = _decimal_or_none(item.gross_amount)
    other_d = Decimal(str(item.other_deductions_amount or 0))
    reg_h = item.regular_seconds / 3600
    ot_h = item.overtime_seconds / 3600
    tot_h = item.rounded_total_seconds / 3600
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    mode_label = html.escape(_payment_mode_label(item.payment_mode))
    paid_line_parts: list[str] = []
    if item.paid_at is not None:
        paid_line_parts.append(f"<p><strong>Paid at:</strong> {_utc_dt_display_for_payslip(item.paid_at)}</p>")
    elif item.approved_at is not None:
        paid_line_parts.append(
            f"<p><strong>Approved at:</strong> {_utc_dt_display_for_payslip(item.approved_at)}</p>",
        )
    paid_line = "".join(paid_line_parts)

    other_block = ""
    if other_d != 0:
        other_block = f'<tr><td>Other deductions</td><td class="num">£{other_d:.2f}</td></tr>'

    ni_block = ""
    if ni_esc:
        ni_block = f"<p><strong>NI number:</strong> {ni_esc}</p>"

    email_raw = (owner.email or "").strip()
    email_block = ""
    if email_raw:
        email_block = f"<p><strong>Email:</strong> {html.escape(email_raw)}</p>"

    wk_start_esc = html.escape(str(period.week_start))
    wk_end_esc = html.escape(str(_week_end_display(period.week_start)))
    tz_esc = html.escape(period.timezone_name or "UTC")
    period_line = f"<p><strong>Period:</strong> week {wk_start_esc} to {wk_end_esc} ({tz_esc}, Mon–Sun)</p>"
    net_display = f"£{net_eff:.2f}" if net_eff is not None else "—"
    gross_display = f"£{gross:.2f}" if gross is not None else "—"
    cis_display = f"£{cis:.2f}" if cis is not None else "—"
    statement_heading = "CIS pay statement" if cis is not None and cis != 0 else "Payslip"

    html_out = f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Payslip — {cname}</title>
<style>
html {{ box-sizing: border-box; }}
*, *::before, *::after {{ box-sizing: inherit; }}
body {{
  margin: 0;
  padding: 0;
  background: #f3f4f6;
  color: #111827;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: clamp(14px, 2.8vw, 16px);
  line-height: 1.5;
  -webkit-text-size-adjust: 100%;
}}
.payslip-wrap {{
  width: 100%;
  max-width: 100%;
  margin: 0 auto;
  padding: 12px;
}}
@media (min-width: 768px) {{
  .payslip-wrap {{ padding: 20px 24px 28px; }}
}}
.payslip-card {{
  max-width: 210mm;
  margin: 0 auto;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 18px 16px 20px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}}
@media (min-width: 768px) {{
  .payslip-card {{ padding: 22px 24px 24px; }}
}}
.payslip-head {{
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
  padding-bottom: 14px;
  margin-bottom: 16px;
  border-bottom: 1px solid #e5e7eb;
}}
.payslip-head-left {{ flex: 1 1 12rem; min-width: 0; }}
.payslip-head-right {{ flex: 0 1 auto; text-align: right; }}
.co-name {{
  font-size: clamp(1.05rem, 3vw, 1.2rem);
  font-weight: 700;
  word-break: break-word;
}}
.doc-type {{
  font-size: clamp(0.95rem, 2.6vw, 1.05rem);
  font-weight: 700;
  color: #374151;
  white-space: nowrap;
}}
.meta-block p {{ margin: 0.35rem 0; }}
.meta-block strong {{ color: #374151; }}
.pay-table {{
  width: 100%;
  border-collapse: collapse;
  margin-top: 1.1rem;
  table-layout: fixed;
}}
.pay-table td {{
  border: 1px solid #d1d5db;
  padding: 0.6rem 0.65rem;
  vertical-align: top;
  word-wrap: break-word;
  overflow-wrap: anywhere;
}}
.pay-table td:first-child {{
  font-weight: 600;
  color: #374151;
  width: 54%;
  background: #f9fafb;
}}
.pay-table .num {{
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}}
.pay-table tr.section td:first-child {{
  background: #eef2f7;
}}
.foot-note {{
  margin-top: 1.25rem;
  font-size: 0.8rem;
  color: #6b7280;
}}
@media print {{
  body {{ background: #fff; font-size: 11pt; }}
  .payslip-wrap {{ max-width: none; padding: 0; }}
  .payslip-card {{ max-width: none; border: none; box-shadow: none; border-radius: 0; padding: 0; }}
  .pay-table td {{ padding: 0.45rem 0.5rem; }}
  @page {{ size: A4; margin: 12mm; }}
}}
</style></head><body>
<div class="payslip-wrap">
  <div class="payslip-card">
    <header class="payslip-head">
      <div class="payslip-head-left">
        <div class="co-name">{cname}</div>
      </div>
      <div class="payslip-head-right">
        <div class="doc-type">{html.escape(statement_heading)}</div>
      </div>
    </header>
    <div class="meta-block">
      <p><strong>Employee:</strong> {ename}</p>
      {email_block}
      {ni_block}
      {period_line}
      <p><strong>Generated:</strong> {html.escape(generated)}</p>
      {paid_line}
      <p><strong>Payment type:</strong> {mode_label}</p>
    </div>
    <table class="pay-table"><tbody>
      <tr><td>Hours worked (rounded total)</td><td class="num">{tot_h:.2f} h</td></tr>
      <tr><td>Regular / overtime hours</td><td class="num">{reg_h:.2f} / {ot_h:.2f} h</td></tr>
      <tr class="section"><td>Gross pay</td><td class="num">{gross_display}</td></tr>
      <tr><td>CIS tax</td><td class="num">{cis_display}</td></tr>
      {other_block}
      <tr class="section"><td>Total net pay</td><td class="num">{net_display}</td></tr>
      <tr><td>YTD taxable pay ({period.week_start.year})</td><td class="num">£{ytd_pay:.2f}</td></tr>
      <tr><td>YTD CIS deducted ({period.week_start.year})</td><td class="num">£{ytd_cis:.2f}</td></tr>
    </tbody></table>
    <p class="foot-note">Use your browser&rsquo;s Print dialog to print or save as PDF.</p>
  </div>
</div>
</body></html>"""

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="payroll.payslip_viewed",
        entity_type="payroll_item",
        entity_id=str(item.id),
        company_id=item.company_id,
        details={
            "item_id": str(item.id),
            "owner_user_id": str(item.user_id),
            "company_id": str(item.company_id),
            "actor_user_id": str(actor.id),
            "as_admin": actor.id != item.user_id,
        },
    )
    return html_out


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
    needs_recalc = False
    if period is not None and period.calculated_at is not None:
        max_shift_updated = max_employee_shift_updated_at_in_payroll_week(
            db_session,
            company_id=company_id,
            week_start_utc=week_start_utc,
            week_end_utc=week_end_utc,
        )
        if max_shift_updated is not None and max_shift_updated > period.calculated_at:
            needs_recalc = True
    approved_n = sum(1 for i in all_items if i.status == "approved")
    paid_n = sum(1 for i in all_items if i.status == "paid")
    can_auto = (not_calculated or needs_recalc) and approved_n == 0 and paid_n == 0
    return PayrollReportAlerts(
        pending_approval_count=pending,
        open_shifts_started_in_week_count=open_n,
        rate_missing_employees_count=rate_missing,
        zero_rounded_hours_employees_count=zero_hours,
        payroll_period_not_calculated=not_calculated,
        payroll_needs_recalculation=needs_recalc,
        can_auto_recalculate=can_auto,
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
        eff = _effective_tax_amount_for_item(i)
        if eff is not None:
            total_tax += eff
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
    auto_recalculate_if_safe: bool = True,
    _auto_recalc_depth: int = 0,
) -> PayrollReportResponse:
    assert_payroll_admin_or_administrator(actor)
    assert_payroll_company_scope(actor, company_id)
    policy = ensure_company_time_policy(db_session, company_id)
    period = get_period_by_company_week(db_session, company_id, week_start)
    if period is None:
        alerts = _build_report_alerts(
            db_session,
            company_id=company_id,
            policy=policy,
            week_start=week_start,
            period=None,
            all_items=[],
        )
        if (
            auto_recalculate_if_safe
            and _auto_recalc_depth == 0
            and alerts.can_auto_recalculate
        ):
            recalculate_payroll(db_session, actor, company_id=company_id, week_start=week_start)
            inner = get_payroll_report(
                db_session,
                actor,
                company_id=company_id,
                week_start=week_start,
                user_id=user_id,
                auto_recalculate_if_safe=auto_recalculate_if_safe,
                _auto_recalc_depth=_auto_recalc_depth + 1,
            )
            return inner.model_copy(update={"payroll_auto_recalculated": True})
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
    if (
        auto_recalculate_if_safe
        and _auto_recalc_depth == 0
        and alerts.can_auto_recalculate
    ):
        recalculate_payroll(db_session, actor, company_id=company_id, week_start=week_start)
        inner = get_payroll_report(
            db_session,
            actor,
            company_id=company_id,
            week_start=week_start,
            user_id=user_id,
            auto_recalculate_if_safe=auto_recalculate_if_safe,
            _auto_recalc_depth=_auto_recalc_depth + 1,
        )
        return inner.model_copy(update={"payroll_auto_recalculated": True})
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
        eff_tax = _effective_tax_amount_for_item(i)
        if eff_tax is not None:
            total_tax += eff_tax
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
    if period is not None and period_has_approved_item(db_session, period.id):
        raise PayrollApprovedBlockingError(
            "Payroll is approved. Unlock it before recalculating.",
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
    delete_pending_items_for_period(db_session, period.id)

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
    tax_for_net = _effective_tax_amount_for_item(item)
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
    company_names: dict[uuid.UUID, str] = {}
    for i in items:
        period = db_session.get(PayrollPeriod, i.period_id)
        if period is None:
            continue
        if i.company_id not in company_names:
            co = get_company_by_id(db_session, i.company_id)
            company_names[i.company_id] = co.name if co is not None else "Company"
        eff_cis = _effective_tax_amount_for_item(i)
        eff_net = _effective_net_amount_for_item(i)
        result.append(
            PayHistoryEntry(
                id=i.id,
                company_id=i.company_id,
                week_start=period.week_start,
                week_end=_week_end_display(period.week_start),
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
                company_name=company_names[i.company_id],
                payment_mode=i.payment_mode,
                can_open_payslip=True,
                effective_cis_tax_amount=eff_cis,
                effective_net_amount=eff_net,
                timezone_name=period.timezone_name,
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
    report = get_payroll_report(
        db_session,
        actor,
        company_id=company_id,
        week_start=week_start,
        auto_recalculate_if_safe=False,
    )
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
    report = get_payroll_report(
        db_session,
        actor,
        company_id=company_id,
        week_start=week_start,
        auto_recalculate_if_safe=False,
    )
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
