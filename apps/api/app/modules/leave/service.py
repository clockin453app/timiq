from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.companies.repository import get_company_by_id
from app.modules.companies.service import ensure_company_time_policy
from app.modules.leave.calculation import (
    compute_leave_total_days,
    leave_year_date_range,
    leave_year_key_for_date,
)
from app.modules.leave.models import LeaveBalanceAdjustment, LeavePolicy, LeaveRequest
from app.modules.leave import repository as leave_repo
from app.modules.leave.schemas import (
    LeaveAdminSummaryResponse,
    LeaveBalanceAdjustmentCreate,
    LeaveBalanceAdjustmentResponse,
    LeaveMeSummaryResponse,
    LeavePolicyPatchRequest,
    LeavePolicyResponse,
    LeaveRequestCreate,
    LeaveRequestRejectBody,
    LeaveRequestResponse,
    WeekLeaveRow,
)
from app.modules.notifications.events import (
    list_active_company_admin_ids,
    record_leave_decision,
    record_leave_request_submitted,
)
from app.modules.time_records.repository import list_time_shifts_for_records


class LeaveError(ValueError):
    pass


class LeavePermissionError(ValueError):
    pass


def _assert_company_scope(actor: User, company_id: uuid.UUID) -> None:
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return
    if actor.system_role == SystemRole.ADMIN and actor.company_id == company_id:
        return
    raise LeavePermissionError("You cannot manage leave for this company.")


def _assert_admin_or_administrator(actor: User) -> None:
    if actor.system_role not in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        raise LeavePermissionError("Admin access required.")


def _ensure_policy(db: Session, company_id: uuid.UUID) -> LeavePolicy:
    p = leave_repo.get_policy_by_company(db, company_id)
    if p is None:
        p = leave_repo.create_policy_defaults(db, company_id)
    return p


def _policy_response(p: LeavePolicy) -> LeavePolicyResponse:
    return LeavePolicyResponse(
        company_id=p.company_id,
        annual_leave_year_start_month=p.annual_leave_year_start_month,
        annual_leave_year_start_day=p.annual_leave_year_start_day,
        default_annual_allowance_days=Decimal(str(p.default_annual_allowance_days))
        if p.default_annual_allowance_days is not None
        else None,
        allow_half_days=p.allow_half_days,
        paid_annual_leave=p.paid_annual_leave,
        paid_sick_leave=p.paid_sick_leave,
        sick_leave_requires_note=p.sick_leave_requires_note,
    )


def get_leave_policy(db: Session, actor: User, *, company_id: uuid.UUID) -> LeavePolicyResponse:
    _assert_admin_or_administrator(actor)
    _assert_company_scope(actor, company_id)
    if get_company_by_id(db, company_id) is None:
        raise LeaveError("Company not found.")
    p = _ensure_policy(db, company_id)
    return _policy_response(p)


def patch_leave_policy(
    db: Session, actor: User, *, company_id: uuid.UUID, body: LeavePolicyPatchRequest
) -> LeavePolicyResponse:
    _assert_admin_or_administrator(actor)
    _assert_company_scope(actor, company_id)
    p = _ensure_policy(db, company_id)
    changed: dict[str, object] = {}
    if body.annual_leave_year_start_month is not None:
        p.annual_leave_year_start_month = body.annual_leave_year_start_month
        changed["annual_leave_year_start_month"] = body.annual_leave_year_start_month
    if body.annual_leave_year_start_day is not None:
        p.annual_leave_year_start_day = body.annual_leave_year_start_day
        changed["annual_leave_year_start_day"] = body.annual_leave_year_start_day
    if body.default_annual_allowance_days is not None:
        p.default_annual_allowance_days = float(body.default_annual_allowance_days)
        changed["default_annual_allowance_days"] = str(body.default_annual_allowance_days)
    if body.allow_half_days is not None:
        p.allow_half_days = body.allow_half_days
        changed["allow_half_days"] = body.allow_half_days
    if body.paid_annual_leave is not None:
        p.paid_annual_leave = body.paid_annual_leave
        changed["paid_annual_leave"] = body.paid_annual_leave
    if body.paid_sick_leave is not None:
        p.paid_sick_leave = body.paid_sick_leave
        changed["paid_sick_leave"] = body.paid_sick_leave
    if body.sick_leave_requires_note is not None:
        p.sick_leave_requires_note = body.sick_leave_requires_note
        changed["sick_leave_requires_note"] = body.sick_leave_requires_note
    p.updated_at = datetime.now(timezone.utc)
    leave_repo.upsert_policy(db, p)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="leave.policy_updated",
        entity_type="leave_policy",
        entity_id=str(p.id),
        company_id=company_id,
        details={"company_id": str(company_id), "changed_fields": changed, "actor_user_id": str(actor.id)},
    )
    return _policy_response(p)


def _utc_bounds_for_date_range(policy: object, d0: date, d1: date) -> tuple[datetime, datetime]:
    try:
        tz = ZoneInfo(policy.timezone_name)
    except Exception:
        tz = ZoneInfo("UTC")
    start_local = datetime.combine(d0, time.min, tzinfo=tz)
    end_exc = datetime.combine(d1 + timedelta(days=1), time.min, tzinfo=tz)
    return start_local.astimezone(timezone.utc), end_exc.astimezone(timezone.utc)


def _shift_overlap_warnings(
    db: Session,
    actor: User,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    date_from: date,
    date_to: date,
) -> list[str]:
    policy = ensure_company_time_policy(db, company_id)
    start_utc, end_utc = _utc_bounds_for_date_range(policy, date_from, date_to)
    rows = list_time_shifts_for_records(
        db,
        viewer=actor,
        start_utc=start_utc,
        end_utc=end_utc,
        location_id=None,
        status="completed",
        filter_user_id=user_id,
        filter_company_id=company_id if actor.system_role == SystemRole.ADMINISTRATOR else None,
        limit=100,
        offset=0,
    )
    if not rows:
        return []
    return [
        "This leave overlaps completed clocked shifts in the same period. "
        "Leave does not change time records; review both in reports."
    ]


def _annual_balance_warning(
    db: Session,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    policy: LeavePolicy,
    new_annual_days: Decimal,
    anchor_date: date,
) -> str | None:
    if policy.default_annual_allowance_days is None:
        return None
    ly = leave_year_key_for_date(
        anchor_date,
        start_month=policy.annual_leave_year_start_month,
        start_day=policy.annual_leave_year_start_day,
    )
    rs, re_ = leave_year_date_range(
        ly,
        start_month=policy.annual_leave_year_start_month,
        start_day=policy.annual_leave_year_start_day,
    )
    allowance = Decimal(str(policy.default_annual_allowance_days))
    adj = leave_repo.sum_adjustments_days(db, company_id=company_id, user_id=user_id, leave_year=ly)
    used = leave_repo.sum_annual_leave_days(
        db, company_id=company_id, user_id=user_id, status="approved", range_start=rs, range_end=re_
    )
    pending = leave_repo.sum_annual_leave_days(
        db, company_id=company_id, user_id=user_id, status="pending", range_start=rs, range_end=re_
    )
    remaining = allowance + adj - used - pending
    if new_annual_days > remaining + Decimal("0.0001"):
        return (
            f"This request ({new_annual_days} days) exceeds the remaining annual leave "
            f"balance (~{remaining} days) for leave year {ly}. An admin can still approve with overlap override."
        )
    return None


def _to_request_response(
    row: LeaveRequest,
    *,
    warnings: list[str] | None = None,
    balance_warning: str | None = None,
) -> LeaveRequestResponse:
    return LeaveRequestResponse(
        id=row.id,
        company_id=row.company_id,
        user_id=row.user_id,
        leave_type=row.leave_type,
        status=row.status,
        date_from=row.date_from,
        date_to=row.date_to,
        start_half_day=row.start_half_day,
        end_half_day=row.end_half_day,
        total_days=Decimal(str(row.total_days)),
        reason=row.reason,
        employee_note=row.employee_note,
        admin_note=row.admin_note,
        approved_by_user_id=row.approved_by_user_id,
        approved_at=row.approved_at,
        rejected_by_user_id=row.rejected_by_user_id,
        rejected_at=row.rejected_at,
        cancelled_at=row.cancelled_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
        warnings=warnings or [],
        balance_warning=balance_warning,
    )


def _assert_company_scope_or_self(actor: User, company_id: uuid.UUID, user_id: uuid.UUID) -> None:
    if actor.system_role == SystemRole.EMPLOYEE:
        if actor.company_id == company_id and actor.id == user_id:
            return
        raise LeavePermissionError("You cannot manage leave for this company.")
    _assert_company_scope(actor, company_id)


def create_leave_request_for_user(
    db: Session,
    actor: User,
    *,
    company_id: uuid.UUID,
    body: LeaveRequestCreate,
) -> LeaveRequestResponse:
    if actor.system_role == SystemRole.EMPLOYEE:
        subject_id = actor.id
    else:
        if body.user_id is None:
            raise LeaveError("user_id is required when admins create leave on behalf of an employee.")
        subject_id = body.user_id

    _assert_company_scope_or_self(actor, company_id, subject_id)
    target = get_user_by_id(db, subject_id)
    if target is None or target.company_id != company_id:
        raise LeaveError("Employee not found in this company.")
    if actor.system_role == SystemRole.EMPLOYEE and actor.id != subject_id:
        raise LeavePermissionError("You can only request leave for yourself.")

    policy = _ensure_policy(db, company_id)
    total = compute_leave_total_days(
        body.date_from,
        body.date_to,
        start_half_day=body.start_half_day,
        end_half_day=body.end_half_day,
        allow_half_days=policy.allow_half_days,
    )

    overlap_n = leave_repo.count_overlapping_requests(
        db,
        company_id=company_id,
        user_id=subject_id,
        date_from=body.date_from,
        date_to=body.date_to,
    )
    allow_admin_overlap = actor.system_role in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR)
    force = body.force_overlap and allow_admin_overlap
    if overlap_n > 0 and not force:
        raise LeaveError("Leave overlaps existing pending or approved leave for these dates.")

    if policy.sick_leave_requires_note and body.leave_type == "sick_leave":
        note = (body.employee_note or "").strip() or (body.reason or "").strip()
        if not note:
            raise LeaveError("A brief note is required for sick leave under company policy.")

    warnings = _shift_overlap_warnings(
        db, actor, company_id=company_id, user_id=subject_id, date_from=body.date_from, date_to=body.date_to
    )
    bal_warn = None
    if body.leave_type == "annual_leave":
        bal_warn = _annual_balance_warning(
            db,
            company_id=company_id,
            user_id=subject_id,
            policy=policy,
            new_annual_days=total,
            anchor_date=body.date_from,
        )

    row = LeaveRequest(
        company_id=company_id,
        user_id=subject_id,
        leave_type=body.leave_type,
        status="pending",
        date_from=body.date_from,
        date_to=body.date_to,
        start_half_day=body.start_half_day,
        end_half_day=body.end_half_day,
        total_days=float(total),
        reason=body.reason,
        employee_note=body.employee_note,
    )
    leave_repo.save_request(db, row)
    if actor.system_role == SystemRole.EMPLOYEE and actor.id == subject_id:
        record_leave_request_submitted(
            db,
            company_id=company_id,
            request_id=row.id,
            employee_user_id=subject_id,
            recipient_user_ids=list_active_company_admin_ids(db, company_id=company_id),
        )
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="leave.request_created",
        entity_type="leave_request",
        entity_id=str(row.id),
        company_id=company_id,
        details={
            "company_id": str(company_id),
            "user_id": str(subject_id),
            "request_id": str(row.id),
            "leave_type": row.leave_type,
            "date_from": str(row.date_from),
            "date_to": str(row.date_to),
            "total_days": str(total),
            "status": row.status,
            "actor_user_id": str(actor.id),
        },
    )
    return _to_request_response(row, warnings=warnings, balance_warning=bal_warn)


def list_my_leave(db: Session, actor: User) -> list[LeaveRequestResponse]:
    if actor.company_id is None:
        return []
    rows = leave_repo.list_my_requests(db, actor.id)
    return [_to_request_response(r) for r in rows]


def cancel_my_leave(db: Session, actor: User, request_id: uuid.UUID) -> LeaveRequestResponse:
    row = leave_repo.get_request(db, request_id)
    if row is None:
        raise LeaveError("Leave request not found.")
    if row.user_id != actor.id:
        raise LeavePermissionError("You cannot cancel this request.")
    if row.status != "pending":
        raise LeaveError("Only pending requests can be cancelled.")
    row.status = "cancelled"
    row.cancelled_at = datetime.now(timezone.utc)
    row.updated_at = datetime.now(timezone.utc)
    leave_repo.save_request(db, row)
    record_leave_decision(
        db,
        company_id=row.company_id,
        request_id=row.id,
        employee_user_id=row.user_id,
        approved=True,
    )
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="leave.request_cancelled",
        entity_type="leave_request",
        entity_id=str(row.id),
        company_id=row.company_id,
        details={
            "company_id": str(row.company_id),
            "user_id": str(row.user_id),
            "request_id": str(row.id),
            "leave_type": row.leave_type,
            "status": row.status,
            "actor_user_id": str(actor.id),
        },
    )
    return _to_request_response(row)


def list_company_leave_requests(
    db: Session,
    actor: User,
    *,
    company_id: uuid.UUID,
    status: str | None = None,
    user_id: uuid.UUID | None = None,
    leave_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[LeaveRequestResponse]:
    _assert_admin_or_administrator(actor)
    _assert_company_scope(actor, company_id)
    rows = leave_repo.list_requests_filtered(
        db,
        company_id=company_id,
        status=status,
        user_id=user_id,
        leave_type=leave_type,
        date_from=date_from,
        date_to=date_to,
    )
    return [_to_request_response(r) for r in rows]


def get_leave_request(db: Session, actor: User, request_id: uuid.UUID) -> LeaveRequestResponse:
    row = leave_repo.get_request(db, request_id)
    if row is None:
        raise LeaveError("Leave request not found.")
    if actor.system_role == SystemRole.EMPLOYEE:
        if row.user_id != actor.id:
            raise LeavePermissionError("You cannot view this request.")
    else:
        _assert_company_scope(actor, row.company_id)
    return _to_request_response(row)


def approve_leave_request(db: Session, actor: User, request_id: uuid.UUID) -> LeaveRequestResponse:
    _assert_admin_or_administrator(actor)
    row = leave_repo.get_request(db, request_id)
    if row is None:
        raise LeaveError("Leave request not found.")
    _assert_company_scope(actor, row.company_id)
    if row.status != "pending":
        raise LeaveError("Only pending requests can be approved.")
    overlap_n = leave_repo.count_overlapping_requests(
        db,
        company_id=row.company_id,
        user_id=row.user_id,
        date_from=row.date_from,
        date_to=row.date_to,
        exclude_request_id=row.id,
    )
    if overlap_n > 0:
        raise LeaveError("Another pending or approved leave overlaps these dates.")
    row.status = "approved"
    row.approved_at = datetime.now(timezone.utc)
    row.approved_by_user_id = actor.id
    row.updated_at = datetime.now(timezone.utc)
    leave_repo.save_request(db, row)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="leave.request_approved",
        entity_type="leave_request",
        entity_id=str(row.id),
        company_id=row.company_id,
        details={
            "company_id": str(row.company_id),
            "user_id": str(row.user_id),
            "request_id": str(row.id),
            "leave_type": row.leave_type,
            "date_from": str(row.date_from),
            "date_to": str(row.date_to),
            "total_days": str(row.total_days),
            "status": row.status,
            "actor_user_id": str(actor.id),
        },
    )
    return _to_request_response(row)


def reject_leave_request(
    db: Session, actor: User, request_id: uuid.UUID, body: LeaveRequestRejectBody
) -> LeaveRequestResponse:
    _assert_admin_or_administrator(actor)
    row = leave_repo.get_request(db, request_id)
    if row is None:
        raise LeaveError("Leave request not found.")
    _assert_company_scope(actor, row.company_id)
    if row.status != "pending":
        raise LeaveError("Only pending requests can be rejected.")
    row.status = "rejected"
    row.rejected_at = datetime.now(timezone.utc)
    row.rejected_by_user_id = actor.id
    row.admin_note = body.admin_note
    row.updated_at = datetime.now(timezone.utc)
    leave_repo.save_request(db, row)
    record_leave_decision(
        db,
        company_id=row.company_id,
        request_id=row.id,
        employee_user_id=row.user_id,
        approved=False,
    )
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="leave.request_rejected",
        entity_type="leave_request",
        entity_id=str(row.id),
        company_id=row.company_id,
        details={
            "company_id": str(row.company_id),
            "user_id": str(row.user_id),
            "request_id": str(row.id),
            "leave_type": row.leave_type,
            "status": row.status,
            "actor_user_id": str(actor.id),
        },
    )
    return _to_request_response(row)


def admin_cancel_leave_request(db: Session, actor: User, request_id: uuid.UUID) -> LeaveRequestResponse:
    _assert_admin_or_administrator(actor)
    row = leave_repo.get_request(db, request_id)
    if row is None:
        raise LeaveError("Leave request not found.")
    _assert_company_scope(actor, row.company_id)
    if row.status != "pending":
        raise LeaveError("Only pending requests can be cancelled.")
    row.status = "cancelled"
    row.cancelled_at = datetime.now(timezone.utc)
    row.updated_at = datetime.now(timezone.utc)
    leave_repo.save_request(db, row)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="leave.request_cancelled",
        entity_type="leave_request",
        entity_id=str(row.id),
        company_id=row.company_id,
        details={
            "company_id": str(row.company_id),
            "user_id": str(row.user_id),
            "request_id": str(row.id),
            "leave_type": row.leave_type,
            "status": row.status,
            "actor_user_id": str(actor.id),
            "by_admin": True,
        },
    )
    return _to_request_response(row)


def leave_me_summary(db: Session, actor: User) -> LeaveMeSummaryResponse:
    if actor.company_id is None:
        raise LeaveError("No company assigned.")
    policy = _ensure_policy(db, actor.company_id)
    today = datetime.now(timezone.utc).date()
    ly = leave_year_key_for_date(
        today,
        start_month=policy.annual_leave_year_start_month,
        start_day=policy.annual_leave_year_start_day,
    )
    rs, re_ = leave_year_date_range(
        ly,
        start_month=policy.annual_leave_year_start_month,
        start_day=policy.annual_leave_year_start_day,
    )
    allowance = (
        Decimal(str(policy.default_annual_allowance_days))
        if policy.default_annual_allowance_days is not None
        else None
    )
    adj = leave_repo.sum_adjustments_days(db, company_id=actor.company_id, user_id=actor.id, leave_year=ly)
    used = leave_repo.sum_annual_leave_days(
        db,
        company_id=actor.company_id,
        user_id=actor.id,
        status="approved",
        range_start=rs,
        range_end=re_,
    )
    pending = leave_repo.sum_annual_leave_days(
        db,
        company_id=actor.company_id,
        user_id=actor.id,
        status="pending",
        range_start=rs,
        range_end=re_,
    )
    remaining: Decimal | None = None
    if allowance is not None:
        remaining = allowance + adj - used - pending
    return LeaveMeSummaryResponse(
        leave_year=ly,
        allowance_days=allowance,
        used_annual_days=used,
        pending_annual_days=pending,
        remaining_days=remaining,
        adjustment_sum_days=adj,
        allow_half_days=policy.allow_half_days,
        sick_leave_requires_note=policy.sick_leave_requires_note,
    )


def leave_admin_summary(db: Session, actor: User, *, company_id: uuid.UUID) -> LeaveAdminSummaryResponse:
    _assert_admin_or_administrator(actor)
    _assert_company_scope(actor, company_id)
    pending = len(leave_repo.list_requests_filtered(db, company_id=company_id, status="pending"))
    approved = len(leave_repo.list_requests_filtered(db, company_id=company_id, status="approved"))
    rejected = len(leave_repo.list_requests_filtered(db, company_id=company_id, status="rejected"))
    return LeaveAdminSummaryResponse(
        company_id=company_id,
        pending_count=pending,
        approved_count=approved,
        rejected_count=rejected,
    )


def create_balance_adjustment(
    db: Session, actor: User, *, company_id: uuid.UUID, body: LeaveBalanceAdjustmentCreate
) -> LeaveBalanceAdjustmentResponse:
    _assert_admin_or_administrator(actor)
    _assert_company_scope(actor, company_id)
    target = get_user_by_id(db, body.user_id)
    if target is None or target.company_id != company_id:
        raise LeaveError("Employee not found in this company.")
    row = LeaveBalanceAdjustment(
        company_id=company_id,
        user_id=body.user_id,
        leave_year=body.leave_year.strip(),
        adjustment_days=float(body.adjustment_days),
        reason=body.reason.strip(),
        created_by_user_id=actor.id,
    )
    leave_repo.create_balance_adjustment(db, row)
    create_internal_audit_event(
        db_session=db,
        actor=actor,
        action="leave.balance_adjusted",
        entity_type="leave_balance_adjustment",
        entity_id=str(row.id),
        company_id=company_id,
        details={
            "company_id": str(company_id),
            "user_id": str(body.user_id),
            "leave_year": row.leave_year,
            "adjustment_days": str(body.adjustment_days),
            "actor_user_id": str(actor.id),
        },
    )
    return LeaveBalanceAdjustmentResponse(
        id=row.id,
        company_id=row.company_id,
        user_id=row.user_id,
        leave_year=row.leave_year,
        adjustment_days=Decimal(str(row.adjustment_days)),
        reason=row.reason,
        created_by_user_id=row.created_by_user_id,
        created_at=row.created_at,
    )


def list_balance_adjustments_view(
    db: Session,
    actor: User,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID | None,
    leave_year: str | None,
) -> list[LeaveBalanceAdjustmentResponse]:
    _assert_admin_or_administrator(actor)
    _assert_company_scope(actor, company_id)
    rows = leave_repo.list_balance_adjustments(
        db, company_id=company_id, user_id=user_id, leave_year=leave_year
    )
    return [
        LeaveBalanceAdjustmentResponse(
            id=r.id,
            company_id=r.company_id,
            user_id=r.user_id,
            leave_year=r.leave_year,
            adjustment_days=Decimal(str(r.adjustment_days)),
            reason=r.reason,
            created_by_user_id=r.created_by_user_id,
            created_at=r.created_at,
        )
        for r in rows
    ]


def week_leave_rows(
    db: Session,
    actor: User,
    *,
    company_id: uuid.UUID,
    week_start: date,
    week_end: date,
    user_id: uuid.UUID | None,
) -> list[WeekLeaveRow]:
    """week_end inclusive calendar date (typically week_start + 6)."""
    if actor.system_role == SystemRole.EMPLOYEE:
        if actor.company_id != company_id:
            raise LeavePermissionError("You cannot view leave for this company.")
        if user_id is not None and user_id != actor.id:
            raise LeavePermissionError("You cannot view another employee's leave.")
    else:
        _assert_company_scope(actor, company_id)
    rows = leave_repo.list_leave_overlapping_week(
        db,
        company_id=company_id,
        week_start=week_start,
        week_end=week_end,
        statuses=("approved", "pending"),
        user_id=user_id,
    )
    out: list[WeekLeaveRow] = []
    for r in rows:
        if actor.system_role == SystemRole.EMPLOYEE and r.user_id != actor.id:
            continue
        out.append(
            WeekLeaveRow(
                request_id=r.id,
                user_id=r.user_id,
                leave_type=r.leave_type,
                status=r.status,
                date_from=r.date_from,
                date_to=r.date_to,
                total_days=Decimal(str(r.total_days)),
                start_half_day=r.start_half_day,
                end_half_day=r.end_half_day,
            )
        )
    return out
