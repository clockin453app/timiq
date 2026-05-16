from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.notifications.repository import create_notification_record_once


def list_active_company_admin_ids(db: Session, *, company_id: uuid.UUID) -> list[uuid.UUID]:
    stmt = (
        select(User.id)
        .where(User.company_id == company_id)
        .where(User.system_role == SystemRole.ADMIN)
        .where(User.is_active.is_(True))
        .order_by(User.email.asc())
    )
    return list(db.scalars(stmt).all())


def record_message_received(
    db: Session,
    *,
    company_id: uuid.UUID,
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    sender_user_id: uuid.UUID,
    sender_display_name: str,
    recipient_user_ids: list[uuid.UUID],
) -> int:
    title_name = sender_display_name.strip()[:80]
    title = f"New message from {title_name}" if title_name else "New message"
    created = 0
    for recipient_id in dict.fromkeys(recipient_user_ids):
        if recipient_id == sender_user_id:
            continue
        if create_notification_record_once(
            db,
            recipient_user_id=recipient_id,
            company_id=company_id,
            kind="message_received",
            dedupe_key=f"message:{conversation_id}:{message_id}:{recipient_id}",
            title=title,
            description="You have a new message in TimIQ.",
            href=f"/messages?tab=messages&conversation={conversation_id}",
            priority="normal",
            category="messages",
            source_rule_type="message_received",
            subject_user_id=sender_user_id,
        ):
            created += 1
    return created


def record_announcement_published(
    db: Session,
    *,
    announcement_id: uuid.UUID,
    company_id: uuid.UUID | None,
    actor_user_id: uuid.UUID,
    recipient_user_ids: list[uuid.UUID],
    priority: str,
) -> int:
    created = 0
    pr = "high" if priority in ("urgent", "important") else "normal"
    for recipient_id in dict.fromkeys(recipient_user_ids):
        if recipient_id == actor_user_id:
            continue
        if create_notification_record_once(
            db,
            recipient_user_id=recipient_id,
            company_id=company_id,
            kind="announcement_published",
            dedupe_key=f"announcement:{announcement_id}:{recipient_id}",
            title="New announcement",
            description="A new TimIQ announcement is available.",
            href="/messages?tab=news",
            priority=pr,
            category="messages",
            source_rule_type="announcement_published",
        ):
            created += 1
    return created


def record_leave_request_submitted(
    db: Session,
    *,
    company_id: uuid.UUID,
    request_id: uuid.UUID,
    employee_user_id: uuid.UUID,
    recipient_user_ids: list[uuid.UUID],
) -> int:
    created = 0
    for recipient_id in dict.fromkeys(recipient_user_ids):
        if recipient_id == employee_user_id:
            continue
        if create_notification_record_once(
            db,
            recipient_user_id=recipient_id,
            company_id=company_id,
            kind="leave_request_submitted",
            dedupe_key=f"leave:submitted:{request_id}:{recipient_id}",
            title="Leave request submitted",
            description="A leave request is waiting for review.",
            href="/leave/manage",
            priority="normal",
            category="leave",
            source_rule_type="leave_request_submitted",
            subject_user_id=employee_user_id,
        ):
            created += 1
    return created


def record_leave_decision(
    db: Session,
    *,
    company_id: uuid.UUID,
    request_id: uuid.UUID,
    employee_user_id: uuid.UUID,
    approved: bool,
) -> bool:
    kind = "leave_request_approved" if approved else "leave_request_rejected"
    return create_notification_record_once(
        db,
        recipient_user_id=employee_user_id,
        company_id=company_id,
        kind=kind,
        dedupe_key=f"leave:{'approved' if approved else 'rejected'}:{request_id}:{employee_user_id}",
        title="Leave approved" if approved else "Leave update",
        description="Your leave request was approved." if approved else "Your leave request was not approved.",
        href="/leave",
        priority="normal",
        category="leave",
        source_rule_type=kind,
    )


def record_rams_ack_required(
    db: Session,
    *,
    company_id: uuid.UUID,
    assessment_id: uuid.UUID,
    recipient_user_id: uuid.UUID,
) -> bool:
    return create_notification_record_once(
        db,
        recipient_user_id=recipient_user_id,
        company_id=company_id,
        kind="rams_ack_required",
        dedupe_key=f"rams:ack_required:{assessment_id}:{recipient_user_id}",
        title="RAMS acknowledgement required",
        description="A RAMS assessment is waiting for your acknowledgement.",
        href="/rams",
        priority="high",
        category="safety",
        source_rule_type="rams_ack_required",
    )


def record_toolbox_sign_required(
    db: Session,
    *,
    company_id: uuid.UUID,
    talk_id: uuid.UUID,
    recipient_user_id: uuid.UUID,
) -> bool:
    return create_notification_record_once(
        db,
        recipient_user_id=recipient_user_id,
        company_id=company_id,
        kind="toolbox_sign_required",
        dedupe_key=f"toolbox:sign_required:{talk_id}:{recipient_user_id}",
        title="Toolbox talk sign-off required",
        description="A toolbox talk is waiting for your sign-off.",
        href="/toolbox-talks",
        priority="high",
        category="safety",
        source_rule_type="toolbox_sign_required",
    )


def record_form_submitted(
    db: Session,
    *,
    company_id: uuid.UUID,
    submission_id: uuid.UUID,
    submitter_user_id: uuid.UUID,
    recipient_user_ids: list[uuid.UUID],
) -> int:
    created = 0
    for recipient_id in dict.fromkeys(recipient_user_ids):
        if recipient_id == submitter_user_id:
            continue
        if create_notification_record_once(
            db,
            recipient_user_id=recipient_id,
            company_id=company_id,
            kind="form_submitted",
            dedupe_key=f"form:submitted:{submission_id}:{recipient_id}",
            title="Form submitted",
            description="A submitted form is waiting for review.",
            href="/forms/review",
            priority="normal",
            category="admin",
            source_rule_type="form_submitted",
            subject_user_id=submitter_user_id,
        ):
            created += 1
    return created


def record_form_decision(
    db: Session,
    *,
    company_id: uuid.UUID,
    submission_id: uuid.UUID,
    submitter_user_id: uuid.UUID,
    reviewed: bool,
) -> bool:
    kind = "form_reviewed" if reviewed else "form_rejected"
    return create_notification_record_once(
        db,
        recipient_user_id=submitter_user_id,
        company_id=company_id,
        kind=kind,
        dedupe_key=f"form:{'reviewed' if reviewed else 'rejected'}:{submission_id}:{submitter_user_id}",
        title="Form reviewed" if reviewed else "Form update",
        description="Your submitted form was reviewed." if reviewed else "Your submitted form needs attention.",
        href="/forms",
        priority="normal",
        category="admin",
        source_rule_type=kind,
    )


def record_payroll_paid(
    db: Session,
    *,
    company_id: uuid.UUID,
    payroll_item_id: uuid.UUID,
    employee_user_id: uuid.UUID,
) -> bool:
    return create_notification_record_once(
        db,
        recipient_user_id=employee_user_id,
        company_id=company_id,
        kind="payroll_paid",
        dedupe_key=f"payroll:paid:{payroll_item_id}:{employee_user_id}",
        title="Payslip available",
        description="A payroll item is available in your pay history.",
        href="/pay-history",
        priority="normal",
        category="payroll",
        source_rule_type="payroll_paid",
    )
