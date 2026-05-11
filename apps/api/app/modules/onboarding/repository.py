import uuid
from datetime import datetime, timezone

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.modules.auth.models import SystemRole, User
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.onboarding.models import OnboardingDocument, OnboardingSubmission


def get_submission_by_user_id(
    db_session: Session,
    user_id: uuid.UUID,
) -> OnboardingSubmission | None:
    stmt = select(OnboardingSubmission).where(OnboardingSubmission.user_id == user_id)
    return db_session.scalar(stmt)


def get_approved_onboarding_national_insurance_number(
    db_session: Session,
    user_id: uuid.UUID,
    *,
    max_len: int = 32,
) -> str | None:
    """Return sanitized NI from approved submission only; never exposes full form_payload."""
    row = get_submission_by_user_id(db_session, user_id)
    if row is None or row.status != "approved":
        return None
    payload = row.form_payload if isinstance(row.form_payload, dict) else {}
    raw = payload.get("national_insurance_number")
    if raw is None:
        return None
    if not isinstance(raw, str):
        return None
    cleaned = "".join(ch for ch in raw.strip().upper() if ch.isalnum() or ch in " ")
    cleaned = " ".join(cleaned.split())
    if not cleaned:
        return None
    return cleaned[:max_len]


def get_submission_by_id(
    db_session: Session,
    submission_id: uuid.UUID,
) -> OnboardingSubmission | None:
    stmt = select(OnboardingSubmission).where(OnboardingSubmission.id == submission_id)
    return db_session.scalar(stmt)


def get_document_by_id(
    db_session: Session,
    document_id: uuid.UUID,
) -> OnboardingDocument | None:
    stmt = select(OnboardingDocument).where(OnboardingDocument.id == document_id)
    return db_session.scalar(stmt)


def get_document_by_submission_and_type(
    db_session: Session,
    submission_id: uuid.UUID,
    doc_type: str,
) -> OnboardingDocument | None:
    stmt = select(OnboardingDocument).where(
        OnboardingDocument.submission_id == submission_id,
        OnboardingDocument.doc_type == doc_type,
    )
    return db_session.scalar(stmt)


def list_documents_for_submission(
    db_session: Session,
    submission_id: uuid.UUID,
) -> list[OnboardingDocument]:
    stmt = (
        select(OnboardingDocument)
        .where(OnboardingDocument.submission_id == submission_id)
        .order_by(OnboardingDocument.created_at.asc())
    )
    return list(db_session.scalars(stmt).all())


def save_submission(db_session: Session, row: OnboardingSubmission) -> OnboardingSubmission:
    row.updated_at = datetime.now(timezone.utc)
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def save_submission_no_commit(db_session: Session, row: OnboardingSubmission) -> None:
    row.updated_at = datetime.now(timezone.utc)
    db_session.add(row)


def save_document(db_session: Session, row: OnboardingDocument) -> OnboardingDocument:
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def delete_document_row(db_session: Session, row: OnboardingDocument) -> None:
    db_session.delete(row)
    db_session.commit()


def list_reviewable_submissions(
    db_session: Session,
    *,
    actor: User,
    status_filter: str | None,
    company_id: uuid.UUID | None,
    limit: int,
    offset: int,
) -> list[tuple[OnboardingSubmission, User, EmployeeProfile | None]]:
    stmt: Select = (
        select(OnboardingSubmission, User, EmployeeProfile)
        .join(User, User.id == OnboardingSubmission.user_id)
        .outerjoin(EmployeeProfile, EmployeeProfile.user_id == User.id)
        .where(User.system_role == SystemRole.EMPLOYEE)
    )

    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            return []
        stmt = stmt.where(User.company_id == actor.company_id)
    elif actor.system_role == SystemRole.ADMINISTRATOR:
        if company_id is not None:
            stmt = stmt.where(User.company_id == company_id)
    else:
        return []

    if status_filter:
        stmt = stmt.where(OnboardingSubmission.status == status_filter)

    stmt = stmt.order_by(
        OnboardingSubmission.submitted_at.desc().nulls_last(),
        OnboardingSubmission.updated_at.desc(),
    ).limit(limit).offset(offset)

    return list(db_session.execute(stmt).all())


def count_reviewable_submissions(
    db_session: Session,
    *,
    actor: User,
    status_filter: str | None,
    company_id: uuid.UUID | None,
) -> int:
    stmt = (
        select(func.count(OnboardingSubmission.id))
        .select_from(OnboardingSubmission)
        .join(User, User.id == OnboardingSubmission.user_id)
        .where(User.system_role == SystemRole.EMPLOYEE)
    )
    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            return 0
        stmt = stmt.where(User.company_id == actor.company_id)
    elif actor.system_role == SystemRole.ADMINISTRATOR:
        if company_id is not None:
            stmt = stmt.where(User.company_id == company_id)
    else:
        return 0

    if status_filter:
        stmt = stmt.where(OnboardingSubmission.status == status_filter)

    total = db_session.scalar(stmt)
    return int(total or 0)


def get_submission_with_user_and_profile(
    db_session: Session,
    submission_id: uuid.UUID,
) -> tuple[OnboardingSubmission, User, EmployeeProfile | None] | None:
    stmt = (
        select(OnboardingSubmission, User, EmployeeProfile)
        .join(User, User.id == OnboardingSubmission.user_id)
        .outerjoin(EmployeeProfile, EmployeeProfile.user_id == User.id)
        .where(OnboardingSubmission.id == submission_id)
    )
    row = db_session.execute(stmt).first()
    if row is None:
        return None
    return row[0], row[1], row[2]
