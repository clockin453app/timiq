from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.modules.onboarding.models import OnboardingDocument, OnboardingSubmission
from app.modules.payroll.models import PayrollItem
from app.modules.privacy.models import PrivacyPolicyAcknowledgement, PrivacyRequest
from app.modules.time_clock.models import ClockSelfie, TimeShift, TimeShiftBreak
from app.modules.work_progress.models import WorkProgressAttachment, WorkProgressEntry


def save_ack(db_session: Session, row: PrivacyPolicyAcknowledgement) -> PrivacyPolicyAcknowledgement:
    db_session.add(row)
    db_session.flush()
    return row


def get_latest_ack_for_user(db_session: Session, user_id: uuid.UUID) -> PrivacyPolicyAcknowledgement | None:
    stmt: Select[tuple[PrivacyPolicyAcknowledgement]] = (
        select(PrivacyPolicyAcknowledgement)
        .where(PrivacyPolicyAcknowledgement.user_id == user_id)
        .order_by(PrivacyPolicyAcknowledgement.acknowledged_at.desc())
        .limit(1)
    )
    return db_session.scalars(stmt).first()


def save_privacy_request(db_session: Session, row: PrivacyRequest) -> PrivacyRequest:
    db_session.add(row)
    db_session.flush()
    return row


def get_privacy_request(db_session: Session, request_id: uuid.UUID) -> PrivacyRequest | None:
    return db_session.get(PrivacyRequest, request_id)


def list_privacy_requests_for_user(
    db_session: Session,
    *,
    user_id: uuid.UUID,
    limit: int,
    offset: int,
) -> list[PrivacyRequest]:
    stmt = (
        select(PrivacyRequest)
        .where(PrivacyRequest.user_id == user_id)
        .order_by(PrivacyRequest.submitted_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(db_session.scalars(stmt).unique().all())


def list_privacy_requests_for_management(
    db_session: Session,
    *,
    company_id: uuid.UUID | None,
    include_all_companies: bool,
    limit: int,
    offset: int,
) -> list[PrivacyRequest]:
    stmt = select(PrivacyRequest).order_by(PrivacyRequest.submitted_at.desc())
    if not include_all_companies:
        if company_id is None:
            return []
        stmt = stmt.where(PrivacyRequest.company_id == company_id)
    elif company_id is not None:
        stmt = stmt.where(PrivacyRequest.company_id == company_id)
    stmt = stmt.limit(limit).offset(offset)
    return list(db_session.scalars(stmt).unique().all())


def count_time_shifts_for_user(db_session: Session, user_id: uuid.UUID) -> int:
    stmt = select(func.count()).select_from(TimeShift).where(TimeShift.user_id == user_id)
    return int(db_session.scalar(stmt) or 0)


def count_clock_selfies_for_user(db_session: Session, user_id: uuid.UUID) -> int:
    stmt = (
        select(func.count())
        .select_from(ClockSelfie)
        .join(TimeShift, ClockSelfie.time_shift_id == TimeShift.id)
        .where(TimeShift.user_id == user_id)
    )
    return int(db_session.scalar(stmt) or 0)


def count_shift_breaks_for_user(db_session: Session, user_id: uuid.UUID) -> int:
    stmt = (
        select(func.count())
        .select_from(TimeShiftBreak)
        .join(TimeShift, TimeShiftBreak.time_shift_id == TimeShift.id)
        .where(TimeShift.user_id == user_id)
    )
    return int(db_session.scalar(stmt) or 0)


def count_onboarding_documents_for_user(db_session: Session, user_id: uuid.UUID) -> int:
    stmt = (
        select(func.count())
        .select_from(OnboardingDocument)
        .join(OnboardingSubmission, OnboardingDocument.submission_id == OnboardingSubmission.id)
        .where(OnboardingSubmission.user_id == user_id)
    )
    return int(db_session.scalar(stmt) or 0)


def count_work_progress_attachments_for_user(db_session: Session, user_id: uuid.UUID) -> int:
    stmt = (
        select(func.count())
        .select_from(WorkProgressAttachment)
        .join(WorkProgressEntry, WorkProgressAttachment.entry_id == WorkProgressEntry.id)
        .where(WorkProgressEntry.user_id == user_id)
    )
    return int(db_session.scalar(stmt) or 0)


def count_payroll_items_for_user(db_session: Session, user_id: uuid.UUID) -> int:
    stmt = select(func.count()).select_from(PayrollItem).where(PayrollItem.user_id == user_id)
    return int(db_session.scalar(stmt) or 0)


def count_paid_payroll_items_for_user(db_session: Session, user_id: uuid.UUID) -> int:
    stmt = select(func.count()).select_from(PayrollItem).where(
        PayrollItem.user_id == user_id,
        PayrollItem.paid_at.isnot(None),
    )
    return int(db_session.scalar(stmt) or 0)
