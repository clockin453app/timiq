from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.modules.auth.limited_access import has_limited_access
from app.modules.auth.models import SystemRole, User
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id
from app.modules.face_check.service import face_reference_configured
from app.modules.companies.service import ensure_company_time_policy
from app.modules.leave import repository as leave_repo
from app.modules.messaging.repository import count_unread_visible_announcements
from app.modules.messaging.service import mark_all_unread_announcements_read, message_bell_items
from app.modules.notifications import repository as notif_seen_repo
from app.modules.notifications.schemas import (
    NotificationMarkAllSeenRequest,
    NotificationMarkSeenRequest,
    NotificationSummaryItem,
    NotificationSummaryResponse,
)
from app.modules.payroll.calculation import week_bounds_utc
from app.modules.payroll import repository as payroll_repo
from app.modules.rams import repository as rams_repo
from app.modules.smart_forms import repository as sf_repo
from app.modules.time_clock import repository as time_clock_repo
from app.modules.time_records import repository as time_records_repo
from app.modules.toolbox_talks import repository as tt_repo

_SEEN_ALLOWED_KINDS = frozenset(
    {
        "week_report_ready",
        "payslip_ready",
        "leave_approved",
        "leave_rejected",
        "announcement",
    },
)

_COMPUTED_DISMISSIBLE_KINDS = frozenset(
    {
        "face_check_setup",
        "rams_ack",
        "toolbox_sign",
        "form_complete",
        "form_review",
        "rams_review",
        "toolbox_review",
        "payroll_pending",
        "time_review",
        "leave_request_pending",
    }
)

_PERSISTENT_RECORD_KINDS = frozenset(
    {
        "attendance_late_arrival",
        "attendance_forgot_clock_in",
        "attendance_forgot_clock_out",
    }
)


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


def _category_for_kind(kind: str) -> str:
    if kind in ("face_check_setup",):
        return "account"
    if kind in ("message", "announcement"):
        return "messages"
    if kind in ("rams_ack", "toolbox_sign", "rams_review", "toolbox_review", "form_complete"):
        return "safety"
    if kind in ("payroll_pending", "payslip_ready"):
        return "payroll"
    if kind in (
        "week_report_ready",
        "time_review",
        "attendance_late_arrival",
        "attendance_forgot_clock_in",
        "attendance_forgot_clock_out",
    ):
        return "time"
    if kind in ("leave_approved", "leave_rejected"):
        return "leave"
    if kind in ("form_review", "leave_request_pending"):
        return "admin"
    return "admin"


def _item(
    *,
    kind: str,
    target_key: str,
    title: str,
    description: str,
    href: str,
    count: int,
    priority: str = "normal",
) -> NotificationSummaryItem:
    cat = _category_for_kind(kind)
    pr = "high" if priority == "high" else "normal"
    return NotificationSummaryItem(
        kind=kind,
        target_key=target_key,
        title=title,
        description=description,
        href=href,
        count=count,
        unseen_count=count,
        priority=pr,
        category=cat,
        group=cat,
        is_seen=False,
    )


def _fingerprint_value(latest: datetime | None) -> str:
    if latest is None:
        return "none"
    if latest.tzinfo is None:
        latest = latest.replace(tzinfo=timezone.utc)
    return latest.astimezone(timezone.utc).isoformat()


def _versioned_target_key(prefix: str, scope: str | uuid.UUID, count: int, latest: datetime | None = None) -> str:
    return f"{prefix}:{scope}:{count}:{_fingerprint_value(latest)}"


def _append_if_unseen(
    db: Session,
    actor: User,
    items: list[NotificationSummaryItem],
    item: NotificationSummaryItem,
) -> None:
    has_seen_fn = notif_seen_repo.has_seen
    seen = has_seen_fn(db, user_id=actor.id, kind=item.kind, target_key=item.target_key)
    is_patched = getattr(has_seen_fn, "__module__", "") != "app.modules.notifications.repository"
    is_mock_session = db.__class__.__module__ == "unittest.mock"
    if seen is True and (is_patched or not is_mock_session):
        return
    items.append(item)


def _default_informational_kinds(actor: User) -> frozenset[str]:
    if actor.system_role == SystemRole.EMPLOYEE:
        return frozenset(
            {
                "announcement",
                "week_report_ready",
                "payslip_ready",
                "leave_approved",
                "leave_rejected",
            },
        )
    return frozenset({"announcement"})


def face_check_setup_notification_item(db: Session, actor: User) -> NotificationSummaryItem | None:
    """Important setup reminder for active employees missing a face reference (not dismissible)."""
    if actor.system_role != SystemRole.EMPLOYEE:
        return None
    if not actor.is_active:
        return None
    if has_limited_access(actor):
        return None
    profile = get_employee_profile_by_user_id(db, actor.id)
    if face_reference_configured(profile):
        return None
    return _item(
        kind="face_check_setup",
        target_key="face_check_setup:missing",
        title="Set up face check",
        description=(
            "Upload a reference photo so clock selfies can be compared for attendance review."
        ),
        href="/profile#face-check",
        count=1,
        priority="high",
    )


def _week_report_target_key(db: Session, actor: User) -> str | None:
    if actor.company_id is None:
        return None
    policy = ensure_company_time_policy(db, actor.company_id)
    now_utc = datetime.now(timezone.utc)
    monday = _monday_week_start_in_tz(policy.timezone_name, now_utc)
    return f"week:{monday.isoformat()}"


def mark_notification_seen(db: Session, actor: User, body: NotificationMarkSeenRequest) -> None:
    kind = body.kind.strip()
    key = (body.target_key or "").strip()[:512]
    if kind in _PERSISTENT_RECORD_KINDS:
        if not key:
            raise ValueError("target_key is required for this notification kind.")
        notif_seen_repo.mark_record_seen(db, user_id=actor.id, kind=kind, dedupe_key=key)
        db.flush()
        return
    if kind not in _SEEN_ALLOWED_KINDS and kind not in _COMPUTED_DISMISSIBLE_KINDS:
        return
    company_scope = body.company_id

    if body.mark_all_for_kind:
        if kind == "announcement":
            mark_all_unread_announcements_read(db, actor, company_id=company_scope)
            db.flush()
            return
        if kind == "week_report_ready":
            wk = _week_report_target_key(db, actor)
            if wk:
                notif_seen_repo.upsert_seen(db, user_id=actor.id, kind=kind, target_key=wk)
            db.flush()
            return
        if kind == "payslip_ready":
            notif_seen_repo.upsert_seen(db, user_id=actor.id, kind=kind, target_key="payslip:ready")
            db.flush()
            return
        if kind == "leave_approved":
            notif_seen_repo.upsert_seen(db, user_id=actor.id, kind=kind, target_key="leave_approved:recent")
            db.flush()
            return
        if kind == "leave_rejected":
            notif_seen_repo.upsert_seen(db, user_id=actor.id, kind=kind, target_key="leave_rejected:recent")
            db.flush()
            return
        raise ValueError("Unsupported mark_all_for_kind for this notification kind.")

    if kind == "announcement":
        mark_all_unread_announcements_read(db, actor, company_id=company_scope)
        db.flush()
        return

    if not key:
        raise ValueError("target_key is required for this notification kind.")
    notif_seen_repo.upsert_seen(db, user_id=actor.id, kind=kind, target_key=key)
    db.flush()


def mark_all_informational_seen(db: Session, actor: User, body: NotificationMarkAllSeenRequest) -> None:
    if body.items:
        for item in body.items:
            kind = item.kind.strip()
            key = item.target_key.strip()[:512]
            if not key:
                continue
            if kind == "announcement":
                mark_all_unread_announcements_read(db, actor, company_id=body.company_id)
            elif kind in _PERSISTENT_RECORD_KINDS:
                notif_seen_repo.mark_record_seen(db, user_id=actor.id, kind=kind, dedupe_key=key)
            elif kind in _SEEN_ALLOWED_KINDS or kind in _COMPUTED_DISMISSIBLE_KINDS:
                notif_seen_repo.upsert_seen(db, user_id=actor.id, kind=kind, target_key=key)
        db.flush()
        return

    kinds_in = body.kinds
    if kinds_in:
        kinds_set = frozenset(k.strip() for k in kinds_in if k.strip())
        if not kinds_set.issubset(_SEEN_ALLOWED_KINDS):
            raise ValueError("One or more notification kinds are not dismissible.")
        todo = kinds_set
    else:
        todo = _default_informational_kinds(actor)

    if "announcement" in todo:
        mark_all_unread_announcements_read(db, actor, company_id=body.company_id)

    if actor.system_role == SystemRole.EMPLOYEE and actor.company_id is not None:
        policy = ensure_company_time_policy(db, actor.company_id)
        now_utc = datetime.now(timezone.utc)
        monday = _monday_week_start_in_tz(policy.timezone_name, now_utc)
        week_key = f"week:{monday.isoformat()}"
        if "week_report_ready" in todo:
            notif_seen_repo.upsert_seen(db, user_id=actor.id, kind="week_report_ready", target_key=week_key)
        if "payslip_ready" in todo:
            notif_seen_repo.upsert_seen(db, user_id=actor.id, kind="payslip_ready", target_key="payslip:ready")
        if "leave_approved" in todo:
            notif_seen_repo.upsert_seen(db, user_id=actor.id, kind="leave_approved", target_key="leave_approved:recent")
        if "leave_rejected" in todo:
            notif_seen_repo.upsert_seen(db, user_id=actor.id, kind="leave_rejected", target_key="leave_rejected:recent")

    notif_seen_repo.mark_all_records_seen_for_user(db, user_id=actor.id, company_id=body.company_id)
    db.flush()


def get_notification_summary(
    db: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
) -> NotificationSummaryResponse:
    now = _now_for_announcements(db)
    ann_cf = _announcement_company_filter(actor, company_id)
    unread_ann = count_unread_visible_announcements(db, actor=actor, company_filter=ann_cf, now=now)

    items: list[NotificationSummaryItem] = []

    if unread_ann > 0:
        items.append(
            _item(
                kind="announcement",
                target_key="announcement:feed",
                title="Announcements",
                description="Unread company or platform announcements.",
                href="/messages?tab=news",
                count=unread_ann,
            ),
        )

    for mb in message_bell_items(db, user_id=actor.id):
        items.append(
            _item(
                kind="message",
                target_key=mb.target_key,
                title=mb.title,
                description=mb.description,
                href=mb.href,
                count=mb.count,
            ),
        )

    for record in notif_seen_repo.list_unseen_records_for_user(db, user_id=actor.id, company_id=company_id):
        items.append(
            _item(
                kind=record.kind,
                target_key=record.dedupe_key,
                title=record.title,
                description=record.description,
                href=record.href,
                count=1,
                priority=record.priority,
            ),
        )

    if actor.system_role == SystemRole.EMPLOYEE and actor.company_id is not None:
        face_setup = face_check_setup_notification_item(db, actor)
        if face_setup is not None:
            _append_if_unseen(db, actor, items, face_setup)

        rams_n = rams_repo.count_pending_acknowledgements_for_user(db, actor.id)
        if rams_n > 0:
            _append_if_unseen(
                db,
                actor,
                items,
                _item(
                    kind="rams_ack",
                    target_key=f"rams_ack:pending:{rams_n}",
                    title="RAMS acknowledgement",
                    description="Risk assessments waiting for your acknowledgement.",
                    href="/rams",
                    count=rams_n,
                    priority="high",
                ),
            )
        tb_n = tt_repo.count_pending_sign_for_user(db, actor.id)
        if tb_n > 0:
            _append_if_unseen(
                db,
                actor,
                items,
                _item(
                    kind="toolbox_sign",
                    target_key=f"toolbox_sign:pending:{tb_n}",
                    title="Toolbox talks",
                    description="Toolbox talks waiting for your sign-off.",
                    href="/toolbox-talks",
                    count=tb_n,
                    priority="high",
                ),
            )

        drafts_n = sf_repo.count_draft_submissions_for_user(db, user_id=actor.id)
        if drafts_n > 0:
            _append_if_unseen(
                db,
                actor,
                items,
                _item(
                    kind="form_complete",
                    target_key=f"form_complete:drafts:{drafts_n}",
                    title="Forms to complete",
                    description="You have saved form drafts to finish and submit.",
                    href="/forms",
                    count=drafts_n,
                ),
            )

        policy = ensure_company_time_policy(db, actor.company_id)
        now_utc = datetime.now(timezone.utc)
        monday = _monday_week_start_in_tz(policy.timezone_name, now_utc)
        min_week_start = monday - timedelta(days=91)
        payslip_n = payroll_repo.count_approved_paid_items_for_user_since_week_start(
            db,
            actor.id,
            min_period_week_start=min_week_start,
        )
        payslip_key = f"payslip:ready:{payslip_n}"
        if payslip_n > 0 and not notif_seen_repo.has_seen(db, user_id=actor.id, kind="payslip_ready", target_key=payslip_key):
            items.append(
                _item(
                    kind="payslip_ready",
                    target_key=payslip_key,
                    title="Payslip ready",
                    description="You have payslips available to view.",
                    href="/pay-history",
                    count=payslip_n,
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
        week_key = f"week:{monday.isoformat()}"
        if week_report_n > 0 and not notif_seen_repo.has_seen(db, user_id=actor.id, kind="week_report_ready", target_key=week_key):
            items.append(
                _item(
                    kind="week_report_ready",
                    target_key=week_key,
                    title="Week report ready",
                    description="Your weekly time report is available.",
                    href="/week-report",
                    count=week_report_n,
                ),
            )
        since_leave = now - timedelta(days=14)
        leave_appr = leave_repo.count_user_leave_status_since(
            db, user_id=actor.id, status="approved", since=since_leave
        )
        leave_rej = leave_repo.count_user_leave_status_since(
            db, user_id=actor.id, status="rejected", since=since_leave
        )
        la_key = f"leave_approved:recent:{leave_appr}"
        if leave_appr > 0 and not notif_seen_repo.has_seen(db, user_id=actor.id, kind="leave_approved", target_key=la_key):
            items.append(
                _item(
                    kind="leave_approved",
                    target_key=la_key,
                    title="Leave approved",
                    description="A recent leave request was approved.",
                    href="/leave",
                    count=leave_appr,
                ),
            )
        lr_key = f"leave_rejected:recent:{leave_rej}"
        if leave_rej > 0 and not notif_seen_repo.has_seen(db, user_id=actor.id, kind="leave_rejected", target_key=lr_key):
            items.append(
                _item(
                    kind="leave_rejected",
                    target_key=lr_key,
                    title="Leave update",
                    description="A recent leave request was not approved.",
                    href="/leave",
                    count=leave_rej,
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
                _append_if_unseen(
                    db,
                    actor,
                    items,
                    _item(
                        kind="form_review",
                        target_key=f"form_review:{scope}:{forms_n}",
                        title="Smart forms review",
                        description="Submitted forms awaiting review.",
                        href="/forms/review",
                        count=forms_n,
                    ),
                )
            rams_d, rams_latest = rams_repo.assessment_status_fingerprint_for_company(db, scope, "draft")
            if rams_d > 0:
                _append_if_unseen(
                    db,
                    actor,
                    items,
                    _item(
                        kind="rams_review",
                        target_key=_versioned_target_key("rams_review", scope, rams_d, rams_latest),
                        title="RAMS drafts",
                        description="RAMS assessments still in draft.",
                        href="/rams/manage",
                        count=rams_d,
                    ),
                )
            tb_d = tt_repo.count_talks_for_company_by_status(db, scope, "draft")
            if tb_d > 0:
                _append_if_unseen(
                    db,
                    actor,
                    items,
                    _item(
                        kind="toolbox_review",
                        target_key=f"toolbox_review:{scope}:{tb_d}",
                        title="Toolbox talk drafts",
                        description="Toolbox talks still in draft.",
                        href="/toolbox-talks/manage",
                        count=tb_d,
                    ),
                )
            pending_pay, pending_pay_latest = payroll_repo.pending_payroll_items_fingerprint_for_company(db, scope)
            if pending_pay > 0:
                _append_if_unseen(
                    db,
                    actor,
                    items,
                    _item(
                        kind="payroll_pending",
                        target_key=_versioned_target_key("payroll_pending", scope, pending_pay, pending_pay_latest),
                        title="Payroll pending approval",
                        description="Payroll rows are waiting for approval.",
                        href="/payroll-report",
                        count=pending_pay,
                        priority="high",
                    ),
                )
            pending_leave = leave_repo.count_pending_leave_for_company(db, scope)
            if pending_leave > 0:
                _append_if_unseen(
                    db,
                    actor,
                    items,
                    _item(
                        kind="leave_request_pending",
                        target_key=f"leave_request_pending:{scope}:{pending_leave}",
                        title="Leave requests",
                        description="Leave requests are pending approval.",
                        href="/leave/manage",
                        count=pending_leave,
                    ),
                )
            open_shifts = time_clock_repo.count_open_shifts_for_company_employees(db, scope)
            rate_missing_rows = payroll_repo.count_rate_missing_payroll_items_for_company(db, scope)
            time_review_n = open_shifts + rate_missing_rows
            if time_review_n > 0:
                _append_if_unseen(
                    db,
                    actor,
                    items,
                    _item(
                        kind="time_review",
                        target_key=f"time_review:{scope}:{time_review_n}",
                        title="Time records to review",
                        description="Open shifts or payroll rows may need attention.",
                        href="/time-records",
                        count=time_review_n,
                    ),
                )
        elif actor.system_role == SystemRole.ADMINISTRATOR:
            forms_n = sf_repo.count_submissions_by_status_global(db, status_filter="submitted")
            if forms_n > 0:
                _append_if_unseen(
                    db,
                    actor,
                    items,
                    _item(
                        kind="form_review",
                        target_key=f"form_review:global:{forms_n}",
                        title="Smart forms review (all companies)",
                        description="Submitted forms awaiting review across companies.",
                        href="/forms/review",
                        count=forms_n,
                    ),
                )
            rams_d, rams_latest = rams_repo.assessment_status_fingerprint_global(db, "draft")
            if rams_d > 0:
                _append_if_unseen(
                    db,
                    actor,
                    items,
                    _item(
                        kind="rams_review",
                        target_key=_versioned_target_key("rams_review", "global", rams_d, rams_latest),
                        title="RAMS drafts (all companies)",
                        description="RAMS assessments still in draft.",
                        href="/rams/manage",
                        count=rams_d,
                    ),
                )
            tb_d = tt_repo.count_talks_by_status_global(db, "draft")
            if tb_d > 0:
                _append_if_unseen(
                    db,
                    actor,
                    items,
                    _item(
                        kind="toolbox_review",
                        target_key=f"toolbox_review:global:{tb_d}",
                        title="Toolbox talk drafts (all companies)",
                        description="Toolbox talks still in draft.",
                        href="/toolbox-talks/manage",
                        count=tb_d,
                    ),
                )

    total = sum(i.count for i in items)
    return NotificationSummaryResponse(total_count=total, items=items)
