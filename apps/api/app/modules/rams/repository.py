from __future__ import annotations

import uuid
from datetime import date, datetime, time, timezone

from sqlalchemy import Select, and_, func, select
from sqlalchemy.orm import Session

from app.modules.rams.models import RamsAcknowledgement, RamsAssessment, RamsHazard


def get_assessment(db: Session, assessment_id: uuid.UUID) -> RamsAssessment | None:
    return db.get(RamsAssessment, assessment_id)


def save_assessment(db: Session, row: RamsAssessment) -> RamsAssessment:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_assessments_admin(
    db: Session,
    *,
    company_id: uuid.UUID | None,
    status: str | None,
    location_id: uuid.UUID | None,
    risk_level: str | None,
    date_from: date | None,
    date_to: date | None,
) -> list[RamsAssessment]:
    stmt: Select[RamsAssessment] = select(RamsAssessment).order_by(RamsAssessment.updated_at.desc())
    conditions = []
    if company_id is not None:
        conditions.append(RamsAssessment.company_id == company_id)
    if status:
        conditions.append(RamsAssessment.status == status)
    if location_id is not None:
        conditions.append(RamsAssessment.location_id == location_id)
    if risk_level:
        conditions.append(RamsAssessment.risk_level == risk_level)
    if date_from is not None:
        dt_from = datetime.combine(date_from, time.min, tzinfo=timezone.utc)
        conditions.append(RamsAssessment.updated_at >= dt_from)
    if date_to is not None:
        dt_to = datetime.combine(date_to, time.max, tzinfo=timezone.utc)
        conditions.append(RamsAssessment.updated_at <= dt_to)
    if conditions:
        stmt = stmt.where(and_(*conditions))
    return list(db.scalars(stmt).all())


def list_me_assessment_rows(
    db: Session, user_id: uuid.UUID
) -> list[tuple[RamsAssessment, RamsAcknowledgement]]:
    stmt = (
        select(RamsAssessment, RamsAcknowledgement)
        .join(RamsAcknowledgement, RamsAcknowledgement.assessment_id == RamsAssessment.id)
        .where(RamsAcknowledgement.user_id == user_id)
        .where(RamsAssessment.status.in_(("published", "reviewed", "archived")))
        .order_by(RamsAssessment.updated_at.desc())
    )
    rows = db.execute(stmt).all()
    return [(a, ack) for a, ack in rows]


def count_hazards(db: Session, assessment_id: uuid.UUID) -> int:
    stmt = select(func.count()).select_from(RamsHazard).where(RamsHazard.assessment_id == assessment_id)
    return int(db.scalar(stmt) or 0)


def list_hazards(db: Session, assessment_id: uuid.UUID) -> list[RamsHazard]:
    stmt = (
        select(RamsHazard)
        .where(RamsHazard.assessment_id == assessment_id)
        .order_by(RamsHazard.sort_order.asc(), RamsHazard.created_at.asc())
    )
    return list(db.scalars(stmt).all())


def get_hazard(db: Session, hazard_id: uuid.UUID) -> RamsHazard | None:
    return db.get(RamsHazard, hazard_id)


def max_hazard_sort_order(db: Session, assessment_id: uuid.UUID) -> int:
    stmt = select(func.coalesce(func.max(RamsHazard.sort_order), -1)).where(RamsHazard.assessment_id == assessment_id)
    return int(db.scalar(stmt) or -1)


def save_hazard(db: Session, row: RamsHazard) -> RamsHazard:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_hazard(db: Session, row: RamsHazard) -> None:
    db.delete(row)
    db.commit()


def get_acknowledgement(db: Session, assessment_id: uuid.UUID, user_id: uuid.UUID) -> RamsAcknowledgement | None:
    stmt = (
        select(RamsAcknowledgement)
        .where(RamsAcknowledgement.assessment_id == assessment_id)
        .where(RamsAcknowledgement.user_id == user_id)
    )
    return db.scalar(stmt)


def list_acknowledgements_for_assessment(db: Session, assessment_id: uuid.UUID) -> list[RamsAcknowledgement]:
    stmt = (
        select(RamsAcknowledgement)
        .where(RamsAcknowledgement.assessment_id == assessment_id)
        .order_by(RamsAcknowledgement.created_at.asc())
    )
    return list(db.scalars(stmt).all())


def count_acknowledgements(db: Session, assessment_id: uuid.UUID) -> int:
    stmt = select(func.count()).select_from(RamsAcknowledgement).where(
        RamsAcknowledgement.assessment_id == assessment_id
    )
    return int(db.scalar(stmt) or 0)


def save_acknowledgement(db: Session, row: RamsAcknowledgement) -> RamsAcknowledgement:
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
