"""Dashboard aggregates for management overview and home cards."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.modules.audit.repository import list_audit_events
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.companies.repository import get_company_by_id, list_companies
from app.modules.companies.service import ensure_company_time_policy
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id
from app.modules.live_attendance.service import get_live_attendance_snapshot
from app.modules.onboarding.repository import count_reviewable_submissions
from app.modules.payroll.schemas import PayrollPeriodSummary, PayrollReportResponse
from app.modules.payroll.service import PayrollError, get_payroll_report
from app.modules.work_progress.repository import count_review_entries

from . import repository as dash_repo
from .permissions import (
    DashboardPermissionError,
    assert_administrator_company_filter,
    assert_management_dashboard_actor,
)
from .schemas import (
    ActivityFeedItem,
    AttendanceTrendPoint,
    ManagementSummaryResponse,
    NeedsAttentionItem,
    OverviewResponse,
    PayrollReadinessPanel,
    PayrollTrendPoint,
    SetupHealthPanel,
    TodayLiveRow,
)


class DashboardError(ValueError):
    pass


def _week_end(week_start: date) -> date:
    return week_start + timedelta(days=6)


def _payroll_status_from_period(p: PayrollPeriodSummary) -> str:
    if p.total_items == 0:
        return "not_calculated"
    if p.paid_count == p.total_items and p.total_items > 0:
        return "paid"
    if p.approved_count == p.total_items and p.total_items > 0:
        return "approved"
    if p.pending_count == p.total_items:
        return "pending"
    if p.paid_count > 0:
        return "mixed"
    if p.approved_count > 0 and p.pending_count > 0:
        return "pending_approval"
    return "mixed"


def _display_name(db_session: Session, user_id: uuid.UUID) -> str:
    user = get_user_by_id(db_session, user_id)
    if user is None:
        return "Unknown user"
    profile = get_employee_profile_by_user_id(db_session, user_id)
    if profile is not None:
        first = (profile.first_name or "").strip()
        last = (profile.last_name or "").strip()
        if first or last:
            return f"{first} {last}".strip()
    return user.email or "User"


def _resolve_company_targets(
    db_session: Session,
    actor: User,
    company_id: uuid.UUID | None,
) -> tuple[list[uuid.UUID], bool, uuid.UUID | None]:
    """
    Returns (company_ids_for_aggregate, aggregated_flag, primary_company_id).
    primary_company_id is set when a single company drives payroll/trends.
    """
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            raise DashboardError("Admin user is not assigned to a company.")
        return [actor.company_id], False, actor.company_id

    assert actor.system_role == SystemRole.ADMINISTRATOR
    if company_id is not None:
        if get_company_by_id(db_session, company_id) is None:
            raise DashboardError("Company not found.")
        return [company_id], False, company_id

    companies = list_companies(db_session)
    ids = [c.id for c in companies]
    if len(ids) == 1:
        return ids, False, ids[0]
    return ids, True, None


def _live_block(
    db_session: Session,
    actor: User,
    company_id: uuid.UUID | None,
) -> dict:
    snap = get_live_attendance_snapshot(
        db_session,
        actor,
        company_id=company_id,
        location_id=None,
        search=None,
    )
    s = snap["summary"]
    return {
        "live_open_shifts": int(s["open_shifts"]),
        "live_total_employees": int(s["total_employees"]),
        "live_present_today": int(s["present_today"]),
        "live_attendance_rate": s["attendance_rate"],
    }


def _payroll_block_for_company(
    db_session: Session,
    actor: User,
    company_id: uuid.UUID,
    now_utc: datetime,
) -> tuple[str, float | None, int, date | None, date | None, str | None]:
    week_start = dash_repo.current_week_monday_local(db_session, company_id, now_utc)
    try:
        report = get_payroll_report(
            db_session,
            actor,
            company_id=company_id,
            week_start=week_start,
            auto_recalculate_if_safe=False,
        )
    except PayrollError as exc:
        return "not_calculated", None, 0, None, None, str(exc)

    p = report.period
    if p.total_items == 0:
        msg = "Payroll has not been calculated for this week."
        return "not_calculated", None, 0, week_start, _week_end(week_start), msg

    gross = p.total_gross
    gross_f = float(gross) if gross is not None else None
    secs = int(p.total_rounded_seconds or 0)
    status = _payroll_status_from_period(p)
    msg = None
    if report.alerts.open_shifts_started_in_week_count > 0:
        msg = (
            f"{report.alerts.open_shifts_started_in_week_count} open shift(s) started this week "
            "may need attention before payroll is finalised."
        )
    return status, gross_f, secs, week_start, _week_end(week_start), msg


def _aggregate_payroll_current_week(
    db_session: Session,
    actor: User,
    company_ids: list[uuid.UUID],
    now_utc: datetime,
) -> tuple[str, float | None, int, date | None, date | None, str | None]:
    total_gross = Decimal(0)
    total_secs = 0
    statuses: list[str] = []
    ws_min: date | None = None
    we_max: date | None = None
    messages: list[str] = []

    for cid in company_ids:
        st, g, sec, ws, we, msg = _payroll_block_for_company(db_session, actor, cid, now_utc)
        statuses.append(st)
        if g is not None:
            total_gross += Decimal(str(g))
        total_secs += sec
        if ws is not None:
            ws_min = ws if ws_min is None else min(ws_min, ws)
        if we is not None:
            we_max = we if we_max is None else max(we_max, we)
        if msg:
            messages.append(msg)

    if not company_ids:
        return "not_calculated", None, 0, None, None, None

    uniq = set(statuses)
    if len(uniq) == 1:
        merged_status = statuses[0]
    else:
        merged_status = "mixed"

    gross_f = float(total_gross) if total_gross != 0 else None
    if gross_f is None and merged_status not in ("not_calculated",):
        gross_f = 0.0

    hint = None
    if len(company_ids) > 1:
        hint = "Totals combine all companies for each company’s current payroll week."
    if messages:
        hint = (hint + " " if hint else "") + messages[0][:500]

    return merged_status, gross_f, total_secs, ws_min, we_max, hint


def build_management_summary(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
) -> ManagementSummaryResponse:
    assert_management_dashboard_actor(actor)
    assert_administrator_company_filter(actor, company_id)

    now_utc = datetime.now(timezone.utc)
    company_targets, aggregated, primary = _resolve_company_targets(db_session, actor, company_id)

    if actor.system_role == SystemRole.ADMIN:
        live = _live_block(db_session, actor, None)
    else:
        if company_id is not None:
            admin_live_scope = company_id
        elif aggregated:
            admin_live_scope = None
        else:
            admin_live_scope = company_targets[0]
        live = _live_block(db_session, actor, admin_live_scope)

    if aggregated:
        emp, loc, wp = dash_repo.aggregate_active_counts(db_session, company_targets)
        pay_status, pay_gross, pay_secs, pay_ws, pay_we, pay_msg = _aggregate_payroll_current_week(
            db_session,
            actor,
            company_targets,
            now_utc,
        )
        active_employees = emp
    else:
        cid = company_targets[0]
        active_employees = dash_repo.count_active_employees_for_company(db_session, cid)
        loc = dash_repo.count_active_locations_for_company(db_session, cid)
        wp = dash_repo.count_active_workplaces_for_company(db_session, cid)
        pay_status, pay_gross, pay_secs, pay_ws, pay_we, pay_msg = _payroll_block_for_company(
            db_session,
            actor,
            cid,
            now_utc,
        )

    return ManagementSummaryResponse(
        generated_at=now_utc,
        company_id=primary,
        aggregated_companies=aggregated,
        active_employee_count=active_employees,
        active_location_count=loc,
        active_workplace_count=wp,
        live_open_shifts=live["live_open_shifts"],
        live_total_employees=live["live_total_employees"],
        live_present_today=live["live_present_today"],
        live_attendance_rate=live["live_attendance_rate"],
        payroll_week_start=pay_ws,
        payroll_week_end=pay_we,
        payroll_status=pay_status,
        payroll_total_gross=pay_gross,
        payroll_total_hours_seconds=pay_secs,
        payroll_message=pay_msg,
    )


def _build_admin_activity(
    db_session: Session,
    company_id: uuid.UUID,
    *,
    limit: int,
) -> list[ActivityFeedItem]:
    rows: list[tuple[datetime, ActivityFeedItem]] = []

    for shift in dash_repo.list_recent_non_employee_shifts(db_session, company_id, limit=8):
        actor_label = ""
        if shift.admin_actor_user_id is not None:
            actor_label = _display_name(db_session, shift.admin_actor_user_id)
        who = _display_name(db_session, shift.user_id)
        summary = f"Time clock — {shift.clock_source.replace('_', ' ')}"
        detail_parts = [who]
        if actor_label:
            detail_parts.append(f"by {actor_label}")
        rows.append(
            (
                shift.updated_at,
                ActivityFeedItem(
                    occurred_at=shift.updated_at,
                    summary=summary,
                    detail=" · ".join(detail_parts),
                ),
            ),
        )

    for item, period in dash_repo.list_recent_payroll_items(db_session, company_id, limit=8):
        who = _display_name(db_session, item.user_id)
        rows.append(
            (
                item.updated_at,
                ActivityFeedItem(
                    occurred_at=item.updated_at,
                    summary=f"Payroll item {item.status}",
                    detail=f"{who} · week starting {period.week_start}",
                ),
            ),
        )

    rows.sort(key=lambda r: r[0], reverse=True)
    return [r[1] for r in rows[:limit]]


def _build_audit_activity(
    db_session: Session,
    *,
    company_id: uuid.UUID | None,
    limit: int,
) -> list[ActivityFeedItem]:
    events = list_audit_events(db_session, limit=40)
    out: list[ActivityFeedItem] = []
    for ev in events:
        if company_id is not None and ev.company_id is not None and ev.company_id != company_id:
            continue
        actor_label = "System"
        if ev.actor_user_id is not None:
            actor_label = _display_name(db_session, ev.actor_user_id)
        action = ev.action.replace(".", " ").replace("_", " ")
        out.append(
            ActivityFeedItem(
                occurred_at=ev.created_at,
                summary=action.strip().title()[:120],
                detail=f"{actor_label} · {ev.entity_type}",
            ),
        )
        if len(out) >= limit:
            break
    return out


_WORK_PROGRESS_PENDING_REVIEW_STATUS = "submitted"


def _live_snapshot_company_scope(
    actor: User,
    company_id: uuid.UUID | None,
    aggregated: bool,
    company_targets: list[uuid.UUID],
) -> uuid.UUID | None:
    if actor.system_role == SystemRole.ADMIN:
        return None
    if company_id is not None:
        return company_id
    if aggregated:
        return None
    return company_targets[0] if company_targets else None


def _review_scope_company_id(
    actor: User,
    company_id: uuid.UUID | None,
    aggregated: bool,
    primary: uuid.UUID | None,
) -> uuid.UUID | None:
    if actor.system_role == SystemRole.ADMIN:
        return actor.company_id
    if company_id is not None:
        return company_id
    if aggregated:
        return None
    return primary


def _time_policy_looks_configured(db_session: Session, company_id: uuid.UUID) -> bool:
    policy = ensure_company_time_policy(db_session, company_id)
    tz = (policy.timezone_name or "").strip()
    if tz and tz not in ("Europe/London", "UTC"):
        return True
    return (policy.standard_start_time or "").strip() != "08:00"


def _payroll_status_from_totals(total_items: int, pending: int, approved: int, paid: int) -> str:
    if total_items == 0:
        return "not_calculated"
    if paid == total_items and total_items > 0:
        return "paid"
    if approved == total_items and total_items > 0:
        return "approved"
    if pending == total_items:
        return "pending"
    if paid > 0:
        return "mixed"
    if approved > 0 and pending > 0:
        return "pending_approval"
    return "mixed"


def _collect_payroll_reports_current_week(
    db_session: Session,
    actor: User,
    company_ids: list[uuid.UUID],
    now_utc: datetime,
) -> list[PayrollReportResponse]:
    out: list[PayrollReportResponse] = []
    for cid in company_ids:
        week_start = dash_repo.current_week_monday_local(db_session, cid, now_utc)
        try:
            out.append(
                get_payroll_report(
                    db_session,
                    actor,
                    company_id=cid,
                    week_start=week_start,
                    auto_recalculate_if_safe=False,
                )
            )
        except PayrollError:
            continue
    return out


def _build_payroll_readiness_panel(
    reports: list[PayrollReportResponse],
    *,
    aggregated: bool,
) -> PayrollReadinessPanel | None:
    if not reports:
        return None

    total_items = sum(r.period.total_items for r in reports)
    pending = sum(r.period.pending_count for r in reports)
    approved = sum(r.period.approved_count for r in reports)
    paid = sum(r.period.paid_count for r in reports)
    total_secs = sum(int(r.period.total_rounded_seconds or 0) for r in reports)

    gross_total = Decimal(0)
    has_gross = False
    for r in reports:
        if r.period.total_gross is not None:
            gross_total += Decimal(str(r.period.total_gross))
            has_gross = True
    gross_f = float(gross_total) if has_gross else None

    payroll_period_not_calculated = any(r.alerts.payroll_period_not_calculated for r in reports)
    payroll_needs_recalculation = any(r.alerts.payroll_needs_recalculation for r in reports)
    open_shifts_started_in_week_count = sum(r.alerts.open_shifts_started_in_week_count for r in reports)
    rate_missing_count = sum(r.alerts.rate_missing_employees_count for r in reports)

    status = _payroll_status_from_totals(total_items, pending, approved, paid)
    if payroll_period_not_calculated and total_items == 0:
        status = "not_calculated"

    week_start = min(r.period.week_start for r in reports)
    week_end = max(_week_end(r.period.week_start) for r in reports)

    scope_note = None
    if aggregated and len(reports) > 1:
        scope_note = (
            "Summed across each company’s current payroll week (local week start may differ by company)."
        )

    return PayrollReadinessPanel(
        payroll_status=status,
        week_start=week_start,
        week_end=week_end,
        total_items=total_items,
        pending_count=pending,
        approved_count=approved,
        paid_count=paid,
        rate_missing_count=rate_missing_count,
        payroll_period_not_calculated=payroll_period_not_calculated,
        payroll_needs_recalculation=payroll_needs_recalculation,
        open_shifts_started_in_week_count=open_shifts_started_in_week_count,
        total_gross=gross_f,
        total_hours_seconds=total_secs,
        scope_note=scope_note,
    )


def _build_today_live_rows(snapshot: dict) -> list[TodayLiveRow]:
    rows_raw = [e for e in snapshot.get("employees", []) if e.get("status") == "open_shift"]
    rows_raw.sort(key=lambda e: int(e.get("running_seconds") or 0), reverse=True)
    out: list[TodayLiveRow] = []
    for e in rows_raw[:5]:
        cin = e.get("clock_in_at")
        if cin is None:
            continue
        out.append(
            TodayLiveRow(
                display_name=str(e.get("display_name") or "Employee"),
                email=e.get("email"),
                location_name=e.get("location_name"),
                clock_in_at=cin,
                running_seconds=int(e.get("running_seconds") or 0),
            ),
        )
    return out


def _sort_needs_attention(items: list[NeedsAttentionItem]) -> list[NeedsAttentionItem]:
    rank = {"critical": 0, "warning": 1, "info": 2}
    return sorted(items, key=lambda x: (rank.get(x.severity, 9), x.code))


def _build_needs_attention_items(
    *,
    long_open_shifts: int,
    missing_hourly_rate: int,
    payroll_reports: list[PayrollReportResponse],
    payroll_readiness: PayrollReadinessPanel | None,
    onboarding_pending: int,
    work_progress_pending: int,
    employees_without_site_access: int,
    aggregated: bool,
) -> list[NeedsAttentionItem]:
    items: list[NeedsAttentionItem] = []

    def push(code: str, label: str, count: int, severity: str, href: str) -> None:
        if count <= 0:
            return
        items.append(
            NeedsAttentionItem(
                code=code,
                label=label,
                count=count,
                severity=severity,  # type: ignore[arg-type]
                href=href,
            ),
        )

    push(
        "long_open_shifts",
        f"Open shifts over {dash_repo.LONG_OPEN_SHIFT_THRESHOLD_HOURS}h (UTC since clock-in)",
        long_open_shifts,
        "critical",
        "/live-attendance",
    )
    push(
        "missing_hourly_rate",
        "Employees missing hourly rate",
        missing_hourly_rate,
        "warning",
        "/employees",
    )

    if payroll_reports:
        gap = sum(
            1
            for r in payroll_reports
            if r.alerts.payroll_period_not_calculated or r.period.total_items == 0
        )
        if gap > 0:
            label = (
                "Companies with payroll not calculated this week"
                if aggregated and gap > 1
                else "Payroll not calculated for current week"
            )
            items.append(
                NeedsAttentionItem(
                    code="payroll_not_calculated",
                    label=label,
                    count=gap,
                    severity="warning",
                    href="/payroll-report",
                ),
            )

    if payroll_readiness is not None:
        push(
            "payroll_pending_approval",
            "Payroll items pending approval",
            payroll_readiness.pending_count,
            "warning",
            "/payroll-report",
        )
        push(
            "payroll_rate_missing",
            "Payroll rows with missing rate",
            payroll_readiness.rate_missing_count,
            "warning",
            "/payroll-report",
        )
        push(
            "payroll_open_shifts_in_week",
            "Open shifts started in payroll week",
            payroll_readiness.open_shifts_started_in_week_count,
            "warning",
            "/payroll-report",
        )
        if payroll_readiness.payroll_needs_recalculation:
            items.append(
                NeedsAttentionItem(
                    code="payroll_needs_recalculation",
                    label="Payroll may need recalculation (shifts changed after run)",
                    count=1,
                    severity="warning",
                    href="/payroll-report",
                ),
            )

    push(
        "onboarding_pending_review",
        "Onboarding submissions awaiting review",
        onboarding_pending,
        "info",
        "/onboarding-review",
    )
    push(
        "work_progress_pending_review",
        "Site progress entries awaiting review",
        work_progress_pending,
        "info",
        "/work-progress-review",
    )
    push(
        "employees_no_site_access",
        "Employees with no site / location access",
        employees_without_site_access,
        "warning",
        "/site-access",
    )

    return _sort_needs_attention(items)


def build_overview(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
) -> OverviewResponse:
    summary = build_management_summary(db_session, actor, company_id=company_id)
    now_utc = summary.generated_at

    company_targets, aggregated, primary = _resolve_company_targets(db_session, actor, company_id)

    attendance_trend: list[AttendanceTrendPoint] = []
    payroll_trend: list[PayrollTrendPoint] = []
    recent: list[ActivityFeedItem] = []

    if primary is not None:
        raw_att = dash_repo.attendance_trend_last_local_days(
            db_session,
            primary,
            days=7,
            now_utc=now_utc,
        )
        attendance_trend = [AttendanceTrendPoint.model_validate(x) for x in raw_att]
        raw_pay = dash_repo.payroll_trend_recent_weeks(db_session, primary, weeks=7)
        payroll_trend = [PayrollTrendPoint.model_validate(x) for x in raw_pay]

        recent.extend(_build_admin_activity(db_session, primary, limit=12))

    if actor.system_role == SystemRole.ADMINISTRATOR:
        recent.extend(_build_audit_activity(db_session, company_id=primary, limit=12))

    recent.sort(key=lambda r: r.occurred_at, reverse=True)
    recent = recent[:20]

    live_scope = _live_snapshot_company_scope(actor, company_id, aggregated, company_targets)
    live_snapshot = get_live_attendance_snapshot(
        db_session,
        actor,
        company_id=live_scope,
        location_id=None,
        search=None,
    )
    today_live = _build_today_live_rows(live_snapshot)

    payroll_reports = _collect_payroll_reports_current_week(db_session, actor, company_targets, now_utc)
    payroll_readiness = _build_payroll_readiness_panel(payroll_reports, aggregated=aggregated)

    long_open = dash_repo.count_long_open_shifts_for_companies(
        db_session,
        company_targets,
        now_utc=now_utc,
    )
    missing_rate = dash_repo.count_employees_missing_hourly_rate_for_companies(db_session, company_targets)
    no_site = dash_repo.count_employees_without_site_access_for_companies(db_session, company_targets)

    review_company = _review_scope_company_id(actor, company_id, aggregated, primary)
    onboarding_pending = count_reviewable_submissions(
        db_session,
        actor=actor,
        status_filter="submitted",
        company_id=review_company,
    )
    work_progress_pending = count_review_entries(
        db_session,
        company_id_filter=review_company,
        status_filter=_WORK_PROGRESS_PENDING_REVIEW_STATUS,
    )

    needs_attention = _build_needs_attention_items(
        long_open_shifts=long_open,
        missing_hourly_rate=missing_rate,
        payroll_reports=payroll_reports,
        payroll_readiness=payroll_readiness,
        onboarding_pending=onboarding_pending,
        work_progress_pending=work_progress_pending,
        employees_without_site_access=no_site,
        aggregated=aggregated,
    )

    needs_attention_scope_note = None
    if aggregated and len(company_targets) > 1:
        needs_attention_scope_note = (
            "Totals combine all companies you can access. Pick a company above for single-company charts."
        )

    setup_health: SetupHealthPanel | None = None
    if company_targets:
        emp, loc, wp = dash_repo.aggregate_active_counts(db_session, company_targets)
        tp_configured = any(_time_policy_looks_configured(db_session, cid) for cid in company_targets)
        setup_scope = None
        if aggregated and len(company_targets) > 1:
            setup_scope = "Counts summed across all visible companies."
        setup_health = SetupHealthPanel(
            active_employee_count=emp,
            active_location_count=loc,
            active_workplace_count=wp,
            employees_missing_hourly_rate_count=missing_rate,
            employees_without_site_access_count=no_site,
            time_policy_row_present=True,
            time_policy_configured=tp_configured,
            scope_note=setup_scope,
        )

    base = summary.model_dump()
    return OverviewResponse(
        **base,
        attendance_trend=attendance_trend,
        payroll_trend=payroll_trend,
        recent_activity=recent,
        long_open_shift_threshold_hours=dash_repo.LONG_OPEN_SHIFT_THRESHOLD_HOURS,
        needs_attention=needs_attention,
        needs_attention_scope_note=needs_attention_scope_note,
        today_live=today_live,
        payroll_readiness=payroll_readiness,
        setup_health=setup_health,
    )
