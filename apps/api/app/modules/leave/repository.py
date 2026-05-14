from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.orm import Session

from app.modules.leave.models import LeaveBalanceAdjustment, LeavePolicy, LeaveRequest


def get_policy_by_company(db: Session, company_id: uuid.UUID) -> LeavePolicy | None:
    return db.scalar(select(LeavePolicy).where(LeavePolicy.company_id == company_id))


def upsert_policy(db: Session, policy: LeavePolicy) -> LeavePolicy:
    db.add(policy)
    db.commit()
    db.refresh(policy)
    return policy


def create_policy_defaults(db: Session, company_id: uuid.UUID) -> LeavePolicy:
    p = LeavePolicy(company_id=company_id)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def get_request(db: Session, request_id: uuid.UUID) -> LeaveRequest | None:
    return db.get(LeaveRequest, request_id)


def save_request(db: Session, row: LeaveRequest) -> LeaveRequest:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_requests_filtered(
    db: Session,
    *,
    company_id: uuid.UUID,
    status: str | None = None,
    user_id: uuid.UUID | None = None,
    leave_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[LeaveRequest]:
    stmt: Select[tuple[LeaveRequest]] = select(LeaveRequest).where(LeaveRequest.company_id == company_id)
    if status:
        stmt = stmt.where(LeaveRequest.status == status)
    if user_id:
        stmt = stmt.where(LeaveRequest.user_id == user_id)
    if leave_type:
        stmt = stmt.where(LeaveRequest.leave_type == leave_type)
    if date_from is not None:
        stmt = stmt.where(LeaveRequest.date_to >= date_from)
    if date_to is not None:
        stmt = stmt.where(LeaveRequest.date_from <= date_to)
    stmt = stmt.order_by(LeaveRequest.created_at.desc())
    return list(db.scalars(stmt).all())


def list_my_requests(db: Session, user_id: uuid.UUID) -> list[LeaveRequest]:
    stmt = (
        select(LeaveRequest)
        .where(LeaveRequest.user_id == user_id)
        .order_by(LeaveRequest.created_at.desc())
    )
    return list(db.scalars(stmt).all())


def count_overlapping_requests(
    db: Session,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    date_from: date,
    date_to: date,
    exclude_request_id: uuid.UUID | None = None,
) -> int:
    stmt = (
        select(func.count())
        .select_from(LeaveRequest)
        .where(LeaveRequest.company_id == company_id)
        .where(LeaveRequest.user_id == user_id)
        .where(LeaveRequest.status.in_(("pending", "approved")))
        .where(LeaveRequest.date_from <= date_to)
        .where(LeaveRequest.date_to >= date_from)
    )
    if exclude_request_id is not None:
        stmt = stmt.where(LeaveRequest.id != exclude_request_id)
    return int(db.scalar(stmt) or 0)


def sum_annual_leave_days(
    db: Session,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    status: str,
    range_start: date,
    range_end: date,
) -> Decimal:
    stmt = select(func.coalesce(func.sum(LeaveRequest.total_days), 0)).where(
        LeaveRequest.company_id == company_id,
        LeaveRequest.user_id == user_id,
        LeaveRequest.leave_type == "annual_leave",
        LeaveRequest.status == status,
        LeaveRequest.date_from <= range_end,
        LeaveRequest.date_to >= range_start,
    )
    raw = db.scalar(stmt)
    return Decimal(str(raw or 0))


def sum_adjustments_days(
    db: Session,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    leave_year: str,
) -> Decimal:
    stmt = select(func.coalesce(func.sum(LeaveBalanceAdjustment.adjustment_days), 0)).where(
        LeaveBalanceAdjustment.company_id == company_id,
        LeaveBalanceAdjustment.user_id == user_id,
        LeaveBalanceAdjustment.leave_year == leave_year,
    )
    raw = db.scalar(stmt)
    return Decimal(str(raw or 0))


def create_balance_adjustment(db: Session, row: LeaveBalanceAdjustment) -> LeaveBalanceAdjustment:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_leave_overlapping_week(
    db: Session,
    *,
    company_id: uuid.UUID,
    week_start: date,
    week_end: date,
    statuses: tuple[str, ...] = ("approved", "pending"),
    user_id: uuid.UUID | None = None,
) -> list[LeaveRequest]:
    stmt = (
        select(LeaveRequest)
        .where(LeaveRequest.company_id == company_id)
        .where(LeaveRequest.status.in_(statuses))
        .where(LeaveRequest.date_from <= week_end)
        .where(LeaveRequest.date_to >= week_start)
    )
    if user_id is not None:
        stmt = stmt.where(LeaveRequest.user_id == user_id)
    stmt = stmt.order_by(LeaveRequest.user_id, LeaveRequest.date_from)
    return list(db.scalars(stmt).all())


def count_pending_leave_for_company(db: Session, company_id: uuid.UUID) -> int:
    stmt = (
        select(func.count())
        .select_from(LeaveRequest)
        .where(LeaveRequest.company_id == company_id, LeaveRequest.status == "pending")
    )
    return int(db.scalar(stmt) or 0)


def count_recent_leave_decisions_for_user(
    db: Session,
    *,
    user_id: uuid.UUID,
    since: datetime,
) -> int:
    stmt = (
        select(func.count())
        .select_from(LeaveRequest)
        .where(LeaveRequest.user_id == user_id)
        .where(
            or_(
                and_(LeaveRequest.status == "approved", LeaveRequest.approved_at >= since),
                and_(LeaveRequest.status == "rejected", LeaveRequest.rejected_at >= since),
            )
        )
    )
    return int(db.scalar(stmt) or 0)


def list_balance_adjustments(
    db: Session,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID | None = None,
    leave_year: str | None = None,
) -> list[LeaveBalanceAdjustment]:
    stmt = select(LeaveBalanceAdjustment).where(LeaveBalanceAdjustment.company_id == company_id)
    if user_id is not None:
        stmt = stmt.where(LeaveBalanceAdjustment.user_id == user_id)
    if leave_year is not None:
        stmt = stmt.where(LeaveBalanceAdjustment.leave_year == leave_year)
    stmt = stmt.order_by(LeaveBalanceAdjustment.created_at.desc())
    return list(db.scalars(stmt).all())


def count_user_leave_status_since(
    db: Session,
    *,
    user_id: uuid.UUID,
    status: str,
    since: datetime,
) -> int:
    if status == "approved":
        col = LeaveRequest.approved_at
    elif status == "rejected":
        col = LeaveRequest.rejected_at
    else:
        return 0
    stmt = (
        select(func.count())
        .select_from(LeaveRequest)
        .where(LeaveRequest.user_id == user_id)
        .where(LeaveRequest.status == status)
        .where(col.is_not(None))
        .where(col >= since)
    )
    return int(db.scalar(stmt) or 0)
