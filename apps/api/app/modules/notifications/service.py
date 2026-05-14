from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.companies.service import ensure_company_time_policy
from app.modules.leave import repository as leave_repo
from app.modules.messaging.repository import (
    count_conversations_with_unread_incoming,
    count_unread_visible_announcements,
)
from app.modules.notifications.schemas import NotificationSummaryItem, NotificationSummaryResponse
from app.modules.payroll.calculation import week_bounds_utc
from app.modules.payroll import repository as payroll_repo
from app.modules.rams import repository as rams_repo
from app.modules.smart_forms import repository as sf_repo
from app.modules.time_clock import repository as time_clock_repo
from app.modules.time_records import repository as time_records_repo
from app.modules.toolbox_talks import repository as tt_repo


def _now_for_announcements(db: Session) -> datetime:
    return datetime.now(timezone.utc)


def _announcement_company_filter(actor: User, company_id: uuid.UUID | None) -> uuid.UUID | None:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return company_id
    return actor.company_id


def _monday_week_start_in_tz(policy_timezone: str, instant_utc: datetime) -> date:
    try:
        tz = ZoneInfo(policy_timezone)
    except Exception:
        tz = ZoneInfo("UTC")
    local = instant_utc.astimezone(tz)
    d = local.date()
    return d - timedelta(days=d.weekday())


def get_notification_summary(
    db: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
) -> NotificationSummaryResponse:
    now = _now_for_announcements(db)
    ann_cf = _announcement_company_filter(actor, company_id)
    unread_ann = count_unread_visible_announcements(db, actor=actor, company_filter=ann_cf, now=now)
    unread_msg = count_conversations_with_unread_incoming(db, user_id=actor.id)

    items: list[NotificationSummaryItem] = []

    if unread_ann > 0:
        items.append(
            NotificationSummaryItem(
                kind="announcement",
                title="Announcements",
                description="Unread company or platform announcements.",
                href="/messages?tab=announcements",
                count=unread_ann,
                priority="normal",
            ),
        )
    if unread_msg > 0:
        items.append(
            NotificationSummaryItem(
                kind="message",
                title="Messages",
                description="Conversations with new messages for you.",
                href="/messages",
                count=unread_msg,
                priority="normal",
            ),
        )

    if actor.system_role == SystemRole.EMPLOYEE and actor.company_id is not None:
        rams_n = rams_repo.count_pending_acknowledgements_for_user(db, actor.id)
        if rams_n > 0:
            items.append(
                NotificationSummaryItem(
                    kind="rams_ack",
                    title="RAMS acknowledgement",
                    description="Risk assessments waiting for your acknowledgement.",
                    href="/rams",
                    count=rams_n,
                    priority="high",
                ),
            )
        tb_n = tt_repo.count_pending_sign_for_user(db, actor.id)
        if tb_n > 0:
            items.append(
                NotificationSummaryItem(
                    kind="toolbox_sign",
                    title="Toolbox talks",
                    description="Toolbox talks waiting for your sign-off.",
                    href="/toolbox-talks",
                    count=tb_n,
                    priority="high",
                ),
            )

        policy = ensure_company_time_policy(db, actor.company_id)
        now_utc = datetime.now(timezone.utc)
        monday = _monday_week_start_in_tz(policy.timezone_name, now_utc)
        # v1 payslip bell: no read/unseen state — count approved/paid rows in trailing ~13 payroll weeks.
        min_week_start = monday - timedelta(days=91)
        payslip_n = payroll_repo.count_approved_paid_items_for_user_since_week_start(
            db,
            actor.id,
            min_period_week_start=min_week_start,
        )
        if payslip_n > 0:
            items.append(
                NotificationSummaryItem(
                    kind="payslip_ready",
                    title="Payslip ready",
                    description="You have payslips available to view.",
                    href="/pay-history",
                    count=payslip_n,
                    priority="normal",
                ),
            )

        prev_monday = monday - timedelta(days=7)
        ws_c, we_c = week_bounds_utc(policy, monday)
        ws_p, we_p = week_bounds_utc(policy, prev_monday)
        n_current = time_records_repo.count_completed_shifts_for_user_payroll_week(
            db,
            company_id=actor.company_id,
            subject_user_id=actor.id,
            week_start_utc=ws_c,
            week_end_utc=we_c,
        )
        n_prev = time_records_repo.count_completed_shifts_for_user_payroll_week(
            db,
            company_id=actor.company_id,
            subject_user_id=actor.id,
            week_start_utc=ws_p,
            week_end_utc=we_p,
        )
        week_report_n = n_current if n_current > 0 else n_prev
        if week_report_n > 0:
            items.append(
                NotificationSummaryItem(
                    kind="week_report_ready",
                    title="Week report ready",
                    description="Your weekly time report is available.",
                    href="/week-report",
                    count=week_report_n,
                    priority="normal",
                ),
            )
        since_leave = now - timedelta(days=14)
        leave_appr = leave_repo.count_user_leave_status_since(
            db, user_id=actor.id, status="approved", since=since_leave
        )
        leave_rej = leave_repo.count_user_leave_status_since(
            db, user_id=actor.id, status="rejected", since=since_leave
        )
        if leave_appr > 0:
            items.append(
                NotificationSummaryItem(
                    kind="leave_approved",
                    title="Leave approved",
                    description="A recent leave request was approved.",
                    href="/leave",
                    count=leave_appr,
                    priority="normal",
                ),
            )
        if leave_rej > 0:
            items.append(
                NotificationSummaryItem(
                    kind="leave_rejected",
                    title="Leave update",
                    description="Leave request requires review.",
                    href="/leave",
                    count=leave_rej,
                    priority="normal",
                ),
            )

    scope: uuid.UUID | None
    if actor.system_role == SystemRole.ADMINISTRATOR:
        scope = company_id
    elif actor.system_role == SystemRole.ADMIN and actor.company_id is not None:
        scope = actor.company_id
    else:
        scope = None

    if actor.system_role in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        if scope is not None:
            forms_n = sf_repo.count_submissions_for_review(db, company_id=scope, status_filter="submitted")
            if forms_n > 0:
                items.append(
                    NotificationSummaryItem(
                        kind="form_review",
                        title="Smart forms review",
                        description="Submitted forms awaiting review.",
                        href="/forms/review",
                        count=forms_n,
                        priority="normal",
                    ),
                )
            rams_d = rams_repo.count_assessments_for_company_by_status(db, scope, "draft")
            if rams_d > 0:
                items.append(
                    NotificationSummaryItem(
                        kind="rams_review",
                        title="RAMS drafts",
                        description="RAMS assessments still in draft.",
                        href="/rams/manage",
                        count=rams_d,
                        priority="normal",
                    ),
                )
            tb_d = tt_repo.count_talks_for_company_by_status(db, scope, "draft")
            if tb_d > 0:
                items.append(
                    NotificationSummaryItem(
                        kind="toolbox_review",
                        title="Toolbox talk drafts",
                        description="Toolbox talks still in draft.",
                        href="/toolbox-talks/manage",
                        count=tb_d,
                        priority="normal",
                    ),
                )
            pending_pay = payroll_repo.count_pending_payroll_items_for_company(db, scope)
            if pending_pay > 0:
                items.append(
                    NotificationSummaryItem(
                        kind="payroll_pending",
                        title="Payroll pending approval",
                        description="Payroll rows are waiting for approval.",
                        href="/payroll-report",
                        count=pending_pay,
                        priority="high",
                    ),
                )
            pending_leave = leave_repo.count_pending_leave_for_company(db, scope)
            if pending_leave > 0:
                items.append(
                    NotificationSummaryItem(
                        kind="leave_request_pending",
                        title="Leave requests",
                        description="Leave requests are pending approval.",
                        href="/leave/manage",
                        count=pending_leave,
                        priority="normal",
                    ),
                )
            open_shifts = time_clock_repo.count_open_shifts_for_company_employees(db, scope)
            rate_missing_rows = payroll_repo.count_rate_missing_payroll_items_for_company(db, scope)
            time_review_n = open_shifts + rate_missing_rows
            if time_review_n > 0:
                items.append(
                    NotificationSummaryItem(
                        kind="time_review",
                        title="Time records to review",
                        description="Open shifts or payroll rows may need attention.",
                        href="/time-records",
                        count=time_review_n,
                        priority="normal",
                    ),
                )
        elif actor.system_role == SystemRole.ADMINISTRATOR:
            forms_n = sf_repo.count_submissions_by_status_global(db, status_filter="submitted")
            if forms_n > 0:
                items.append(
                    NotificationSummaryItem(
                        kind="form_review",
                        title="Smart forms review (all companies)",
                        description="Submitted forms awaiting review across companies.",
                        href="/forms/review",
                        count=forms_n,
                        priority="normal",
                    ),
                )
            rams_d = rams_repo.count_assessments_by_status_global(db, "draft")
            if rams_d > 0:
                items.append(
                    NotificationSummaryItem(
                        kind="rams_review",
                        title="RAMS drafts (all companies)",
                        description="RAMS assessments still in draft.",
                        href="/rams/manage",
                        count=rams_d,
                        priority="normal",
                    ),
                )
            tb_d = tt_repo.count_talks_by_status_global(db, "draft")
            if tb_d > 0:
                items.append(
                    NotificationSummaryItem(
                        kind="toolbox_review",
                        title="Toolbox talk drafts (all companies)",
                        description="Toolbox talks still in draft.",
                        href="/toolbox-talks/manage",
                        count=tb_d,
                        priority="normal",
                    ),
                )

    total = sum(i.count for i in items)
    return NotificationSummaryResponse(total_count=total, items=items)
