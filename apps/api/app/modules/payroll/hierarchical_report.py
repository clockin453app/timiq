"""Hierarchical payroll report document (employee → week → days → weekly pay).

Shared by print HTML and PDF so human-facing exports stay consistent and A4-narrow.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any


@dataclass(frozen=True)
class PayrollDayLine:
    work_date: date
    day_label: str
    site: str
    hours: Decimal
    ot_hours: Decimal | None
    role: str | None = None  # only when it differs within the week


@dataclass
class PayrollWeekBlock:
    week_start: date
    week_end: date
    week_label: str
    days: list[PayrollDayLine] = field(default_factory=list)
    hours: Decimal = Decimal("0")
    ot_hours: Decimal = Decimal("0")
    gross: Decimal | None = None
    cis_tax: Decimal | None = None
    other_deductions: Decimal | None = None
    net: Decimal | None = None
    status: str = "—"


@dataclass
class PayrollEmployeeBlock:
    user_key: str
    employee_name: str
    role: str
    employee_email: str = ""
    weeks: list[PayrollWeekBlock] = field(default_factory=list)
    # Totals across all weeks in this report for the employee.
    days_worked: int = 0
    weeks_worked: int = 0
    hours: Decimal = Decimal("0")
    ot_hours: Decimal = Decimal("0")
    gross: Decimal | None = None
    cis_tax: Decimal | None = None
    other_deductions: Decimal | None = None
    net: Decimal | None = None


@dataclass
class PayrollHierarchicalReport:
    company_name: str
    period_label: str
    timezone_name: str
    employee_filter_label: str
    generated_label: str
    alert_lines: list[str]
    employees: list[PayrollEmployeeBlock]
    total_hours_seconds: int
    total_gross: Decimal | None
    total_cis_tax: Decimal | None
    total_net: Decimal | None
    employee_count: int
    totals_heading: str = "Employee period total"


_MONTH_ABBR = (
    "",
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)
_DAY_ABBR = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def format_short_day(d: date) -> str:
    """Mon 3 Aug"""
    return f"{_DAY_ABBR[d.weekday()]} {d.day} {_MONTH_ABBR[d.month]}"


def format_week_label(week_start: date, week_end: date) -> str:
    """W31 · 27 Jul–2 Aug 2026"""
    iso_week = week_start.isocalendar().week
    if week_start.month == week_end.month and week_start.year == week_end.year:
        span = f"{week_start.day}–{week_end.day} {_MONTH_ABBR[week_end.month]} {week_end.year}"
    elif week_start.year == week_end.year:
        span = (
            f"{week_start.day} {_MONTH_ABBR[week_start.month]}–"
            f"{week_end.day} {_MONTH_ABBR[week_end.month]} {week_end.year}"
        )
    else:
        span = (
            f"{week_start.day} {_MONTH_ABBR[week_start.month]} {week_start.year}–"
            f"{week_end.day} {_MONTH_ABBR[week_end.month]} {week_end.year}"
        )
    return f"W{iso_week} · {span}"


def _parse_iso_date(raw: str) -> date | None:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _parse_week_start_from_period(period: str) -> date | None:
    text = (period or "").strip()
    if " to " in text:
        return _parse_iso_date(text.split(" to ", 1)[0])
    return _parse_iso_date(text)


def _dec(raw: object) -> Decimal | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text or text in {"—", "-", ""}:
        return None
    try:
        return Decimal(text)
    except Exception:
        return None


def _hours_dec(raw: object) -> Decimal:
    value = _dec(raw)
    return value if value is not None else Decimal("0")


def build_hierarchical_payroll_report(
    *,
    company_name: str,
    period_label: str,
    timezone_name: str,
    employee_filter_label: str,
    generated_label: str,
    alert_lines: list[str],
    shift_rows: list[dict[str, Any]],
    payroll_rows: list[dict[str, Any]],
    total_hours_seconds: int,
    total_gross: Decimal | None,
    total_cis_tax: Decimal | None,
    total_net: Decimal | None,
    totals_heading: str = "Employee period total",
) -> PayrollHierarchicalReport:
    """Assemble employee → week → days from flat shift + payroll week rows."""

    # user_key -> employee meta
    employees: dict[str, PayrollEmployeeBlock] = {}

    def _ensure(key: str, name: str, role: str, email: str = "") -> PayrollEmployeeBlock:
        block = employees.get(key)
        cleaned_email = (email or "").strip()
        if block is None:
            block = PayrollEmployeeBlock(
                user_key=key,
                employee_name=name or "Employee",
                role=role or "—",
                employee_email=cleaned_email,
            )
            employees[key] = block
        else:
            if role and role != "—" and (not block.role or block.role == "—"):
                block.role = role
            if cleaned_email and not block.employee_email:
                block.employee_email = cleaned_email
        return block

    def _week_block(emp: PayrollEmployeeBlock, week_start: date) -> PayrollWeekBlock:
        week_end = week_start + timedelta(days=6)
        for existing in emp.weeks:
            if existing.week_start == week_start:
                return existing
        block = PayrollWeekBlock(
            week_start=week_start,
            week_end=week_end,
            week_label=format_week_label(week_start, week_end),
        )
        emp.weeks.append(block)
        return block

    for row in shift_rows:
        hours = _hours_dec(row.get("hours"))
        if hours <= 0:
            continue
        work_date = _parse_iso_date(str(row.get("shift_date") or ""))
        if work_date is None:
            continue
        week_start = _parse_iso_date(str(row.get("period") or "")) or (
            work_date - timedelta(days=work_date.weekday())
        )
        key = str(row.get("user_id") or row.get("employee_email") or row.get("employee") or "")
        name = str(row.get("employee") or "Employee")
        role = str(row.get("role") or "—")
        email = str(row.get("employee_email") or "")
        emp = _ensure(key, name, role, email)
        week = _week_block(emp, week_start)
        ot = _dec(row.get("ot_hours"))
        site = str(row.get("location") or "").strip() or "—"
        week.days.append(
            PayrollDayLine(
                work_date=work_date,
                day_label=format_short_day(work_date),
                site=site,
                hours=hours,
                ot_hours=ot,
                role=role if role and role != "—" else None,
            ),
        )

    for row in payroll_rows:
        week_start = _parse_week_start_from_period(str(row.get("period") or ""))
        if week_start is None:
            continue
        key = str(row.get("user_id") or row.get("employee_email") or row.get("employee") or "")
        name = str(row.get("employee") or "Employee")
        role = str(row.get("role") or "—")
        email = str(row.get("employee_email") or "")
        emp = _ensure(key, name, role, email)
        week = _week_block(emp, week_start)
        week.hours = _hours_dec(row.get("hours"))
        week.ot_hours = _hours_dec(row.get("ot_hours"))
        week.gross = _dec(row.get("gross"))
        week.cis_tax = _dec(row.get("cis_tax"))
        week.net = _dec(row.get("net"))
        week.other_deductions = _dec(row.get("other_deductions"))
        week.status = str(row.get("status") or "—").strip() or "—"

    # Finalise: sort, annotate differing roles, compute employee totals.
    ordered: list[PayrollEmployeeBlock] = []
    for emp in sorted(employees.values(), key=lambda e: (e.employee_name.lower(), e.user_key)):
        emp.weeks.sort(key=lambda w: w.week_start)
        for week in emp.weeks:
            week.days.sort(key=lambda d: d.work_date)
            # Deduplicate same-day same-site rows by summing hours if needed.
            merged: dict[tuple[date, str], PayrollDayLine] = {}
            for day in week.days:
                key = (day.work_date, day.site)
                prev = merged.get(key)
                if prev is None:
                    merged[key] = day
                else:
                    merged[key] = PayrollDayLine(
                        work_date=day.work_date,
                        day_label=day.day_label,
                        site=day.site,
                        hours=prev.hours + day.hours,
                        ot_hours=(
                            (prev.ot_hours or Decimal("0")) + (day.ot_hours or Decimal("0"))
                            if prev.ot_hours is not None or day.ot_hours is not None
                            else None
                        ),
                        role=day.role or prev.role,
                    )
            week.days = list(merged.values())
            week.days.sort(key=lambda d: d.work_date)

            roles_in_week = {
                (d.role or "").strip()
                for d in week.days
                if (d.role or "").strip() and d.role != "—"
            }
            # Only annotate day rows when this week used more than one role.
            if len(roles_in_week) <= 1:
                week.days = [
                    PayrollDayLine(
                        work_date=d.work_date,
                        day_label=d.day_label,
                        site=d.site,
                        hours=d.hours,
                        ot_hours=d.ot_hours,
                        role=None,
                    )
                    for d in week.days
                ]
            else:
                week.days = [
                    PayrollDayLine(
                        work_date=d.work_date,
                        day_label=d.day_label,
                        site=d.site,
                        hours=d.hours,
                        ot_hours=d.ot_hours,
                        role=(d.role or emp.role or "—"),
                    )
                    for d in week.days
                ]

            if week.hours == 0 and week.days:
                week.hours = sum((d.hours for d in week.days), Decimal("0"))
            if week.ot_hours == 0 and week.days:
                week.ot_hours = sum((d.ot_hours or Decimal("0") for d in week.days), Decimal("0"))

        emp.days_worked = sum(len(w.days) for w in emp.weeks)
        emp.weeks_worked = len([w for w in emp.weeks if w.days or w.hours > 0 or w.gross is not None])
        emp.hours = sum((w.hours for w in emp.weeks), Decimal("0"))
        emp.ot_hours = sum((w.ot_hours for w in emp.weeks), Decimal("0"))

        def _sum_optional(getter) -> Decimal | None:
            values = [getter(w) for w in emp.weeks if getter(w) is not None]
            if not values:
                return None
            return sum(values, Decimal("0"))

        emp.gross = _sum_optional(lambda w: w.gross)
        emp.cis_tax = _sum_optional(lambda w: w.cis_tax)
        emp.net = _sum_optional(lambda w: w.net)
        emp.other_deductions = _sum_optional(lambda w: w.other_deductions)
        ordered.append(emp)

    return PayrollHierarchicalReport(
        company_name=company_name,
        period_label=period_label,
        timezone_name=timezone_name or "—",
        employee_filter_label=employee_filter_label or "All employees",
        generated_label=generated_label,
        alert_lines=list(alert_lines or []),
        employees=ordered,
        total_hours_seconds=int(total_hours_seconds or 0),
        total_gross=total_gross,
        total_cis_tax=total_cis_tax,
        total_net=total_net,
        employee_count=len(ordered),
        totals_heading=totals_heading,
    )


def money_display(value: Decimal | None) -> str:
    if value is None:
        return "—"
    return f"£{value:,.2f}"


def hours_display(value: Decimal | None) -> str:
    if value is None:
        return "—"
    return f"{value:,.2f}"


def status_display(value: str | None) -> str:
    text = (value or "—").strip() or "—"
    if text == "—":
        return text
    return text.replace("_", " ").title()


def _looks_like_email(value: str) -> bool:
    text = (value or "").strip()
    return "@" in text and " " not in text


def employee_identity_lines(emp: PayrollEmployeeBlock) -> tuple[str, str | None]:
    """Primary identity plus optional email line. Never invents name or email."""
    name = (emp.employee_name or "").strip()
    email = (emp.employee_email or "").strip()
    placeholder = name in {"", "—", "-", "Employee"}
    name_is_email = _looks_like_email(name)

    if email and (placeholder or (name_is_email and name.lower() == email.lower())):
        return email, None
    if name and email and name.lower() != email.lower():
        return name, email
    if name:
        return name, None
    if email:
        return email, None
    return "Employee", None


def employee_role_line(emp: PayrollEmployeeBlock) -> str:
    role = (emp.role or "").strip()
    return role if role else "—"


def status_badge_kind(value: str | None) -> str:
    """Map stored payroll status to a presentation kind. Does not change stored values."""
    key = (value or "").strip().lower()
    if key == "paid":
        return "paid"
    if key == "approved":
        return "approved"
    if key == "pending":
        return "pending"
    if key in {"rejected", "failed", "cancelled"}:
        return "danger"
    return "neutral"


# Shared visual tokens for PDF + print HTML (presentation only).
REPORT_NAVY = "#172033"
REPORT_MUTED = "#64748B"
REPORT_SLATE = "#475569"
REPORT_NET = "#166534"
REPORT_HEADER_TINT = "#F4F6F9"
STATUS_BADGE_COLORS: dict[str, tuple[str, str, str]] = {
    "paid": ("#ECFDF5", "#166534", "#BBF7D0"),
    "approved": ("#EFF6FF", "#1D4ED8", "#BFDBFE"),
    "pending": ("#FFFBEB", "#92400E", "#FDE68A"),
    "danger": ("#FEF2F2", "#B91C1C", "#FECACA"),
    "neutral": ("#F8FAFC", "#334155", "#CBD5E1"),
}


def employee_summary_badge(report: PayrollHierarchicalReport, emp: PayrollEmployeeBlock) -> str:
    """Compact month/period badge shown beside the employee role."""
    if "month" in (report.totals_heading or "").lower():
        if emp.weeks:
            return emp.weeks[0].week_start.strftime("%b %Y").upper()
        return "MONTH"
    return "Period summary"


def is_single_week_report(report: PayrollHierarchicalReport) -> bool:
    """True when the report spans at most one distinct payroll week.

    Uses week_start values from the hierarchical model (not display strings),
    so a cross-month week like 27 Jul–2 Aug still counts as a single week.
    """
    week_starts = {
        week.week_start
        for emp in report.employees
        for week in emp.weeks
    }
    return len(week_starts) <= 1
