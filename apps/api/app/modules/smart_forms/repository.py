from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.modules.smart_forms.models import SmartFormSubmission, SmartFormTemplate


def get_template(db: Session, template_id: uuid.UUID) -> SmartFormTemplate | None:
    return db.get(SmartFormTemplate, template_id)


def list_templates_for_company_scope(
    db: Session,
    *,
    company_id: uuid.UUID | None,
    include_global: bool,
    statuses: list[str] | None = None,
) -> list[SmartFormTemplate]:
    stmt: Select[SmartFormTemplate] = select(SmartFormTemplate).order_by(
        SmartFormTemplate.updated_at.desc(),
    )
    conditions = []
    if company_id is not None:
        if include_global:
            from sqlalchemy import or_

            conditions.append(
                or_(
                    SmartFormTemplate.company_id == company_id,
                    SmartFormTemplate.company_id.is_(None),
                ),
            )
        else:
            conditions.append(SmartFormTemplate.company_id == company_id)
    else:
        conditions.append(SmartFormTemplate.company_id.is_(None))
    if statuses:
        conditions.append(SmartFormTemplate.status.in_(statuses))
    if conditions:
        stmt = stmt.where(*conditions)
    return list(db.scalars(stmt).all())


def list_all_templates_administrator(db: Session) -> list[SmartFormTemplate]:
    stmt = select(SmartFormTemplate).order_by(SmartFormTemplate.updated_at.desc())
    return list(db.scalars(stmt).all())


def save_template(db: Session, row: SmartFormTemplate) -> SmartFormTemplate:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_submission(db: Session, submission_id: uuid.UUID) -> SmartFormSubmission | None:
    return db.get(SmartFormSubmission, submission_id)


def count_submissions_for_template(db: Session, template_id: uuid.UUID) -> int:
    stmt = (
        select(func.count())
        .select_from(SmartFormSubmission)
        .where(SmartFormSubmission.template_id == template_id)
    )
    return int(db.scalar(stmt) or 0)


def delete_template_row(db: Session, row: SmartFormTemplate) -> None:
    db.delete(row)
    db.commit()


def list_submissions_for_user(db: Session, user_id: uuid.UUID) -> list[SmartFormSubmission]:
    stmt = (
        select(SmartFormSubmission)
        .where(SmartFormSubmission.submitted_by_user_id == user_id)
        .order_by(SmartFormSubmission.updated_at.desc())
    )
    return list(db.scalars(stmt).all())


def list_submissions_for_review(
    db: Session,
    *,
    company_id: uuid.UUID | None,
    status_filter: str | None,
) -> list[SmartFormSubmission]:
    stmt = select(SmartFormSubmission).order_by(SmartFormSubmission.updated_at.desc())
    if company_id is not None:
        stmt = stmt.where(SmartFormSubmission.company_id == company_id)
    if status_filter:
        stmt = stmt.where(SmartFormSubmission.status == status_filter)
    return list(db.scalars(stmt).all())


def count_submissions_for_review(
    db: Session,
    *,
    company_id: uuid.UUID,
    status_filter: str,
) -> int:
    stmt = (
        select(func.count())
        .select_from(SmartFormSubmission)
        .where(SmartFormSubmission.company_id == company_id)
        .where(SmartFormSubmission.status == status_filter)
    )
    return int(db.scalar(stmt) or 0)


def count_submissions_by_status_global(db: Session, *, status_filter: str) -> int:
    stmt = select(func.count()).select_from(SmartFormSubmission).where(SmartFormSubmission.status == status_filter)
    return int(db.scalar(stmt) or 0)


def save_submission(db: Session, row: SmartFormSubmission) -> SmartFormSubmission:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def touch_now() -> datetime:
    return datetime.now(timezone.utc)
