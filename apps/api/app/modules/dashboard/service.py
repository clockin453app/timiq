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
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id
from app.modules.live_attendance.service import get_live_attendance_snapshot
from app.modules.payroll.schemas import PayrollPeriodSummary
from app.modules.payroll.service import PayrollError, get_payroll_report

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
    OverviewResponse,
    PayrollTrendPoint,
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
        report = get_payroll_report(db_session, actor, company_id=company_id, week_start=week_start)
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

    base = summary.model_dump()
    return OverviewResponse(
        **base,
        attendance_trend=attendance_trend,
        payroll_trend=payroll_trend,
        recent_activity=recent,
    )
