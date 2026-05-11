import uuid
from datetime import date, datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.auth.models import User
from app.modules.companies.models import Company
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.locations.models import Location
from app.modules.site_access.models import EmployeeLocationAccess
from app.modules.work_progress.models import WorkProgressAttachment, WorkProgressEntry
from app.modules.workplaces.models import Workplace


def get_entry_by_id(db_session: Session, entry_id: uuid.UUID) -> WorkProgressEntry | None:
    stmt = select(WorkProgressEntry).where(WorkProgressEntry.id == entry_id)
    return db_session.scalar(stmt)


def get_attachment_by_id(db_session: Session, attachment_id: uuid.UUID) -> WorkProgressAttachment | None:
    stmt = select(WorkProgressAttachment).where(WorkProgressAttachment.id == attachment_id)
    return db_session.scalar(stmt)


def count_attachments_for_entry(db_session: Session, entry_id: uuid.UUID) -> int:
    stmt = select(func.count()).select_from(WorkProgressAttachment).where(
        WorkProgressAttachment.entry_id == entry_id
    )
    return int(db_session.scalar(stmt) or 0)


def list_attachments_for_entry(
    db_session: Session,
    entry_id: uuid.UUID,
) -> list[WorkProgressAttachment]:
    stmt = (
        select(WorkProgressAttachment)
        .where(WorkProgressAttachment.entry_id == entry_id)
        .order_by(WorkProgressAttachment.created_at.asc())
    )
    return list(db_session.scalars(stmt).all())


def list_entries_for_user(
    db_session: Session,
    user_id: uuid.UUID,
    limit: int,
    offset: int,
) -> tuple[list[WorkProgressEntry], int]:
    count_stmt = select(func.count()).select_from(WorkProgressEntry).where(WorkProgressEntry.user_id == user_id)
    total = int(db_session.scalar(count_stmt) or 0)
    stmt = (
        select(WorkProgressEntry)
        .where(WorkProgressEntry.user_id == user_id)
        .order_by(WorkProgressEntry.work_date.desc(), WorkProgressEntry.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = list(db_session.scalars(stmt).all())
    return rows, total


def list_review_entries(
    db_session: Session,
    *,
    company_id_filter: uuid.UUID | None,
    user_id_filter: uuid.UUID | None,
    location_id_filter: uuid.UUID | None,
    status_filter: str | None,
    date_from: date | None,
    date_to: date | None,
    limit: int,
    offset: int,
) -> tuple[list[WorkProgressEntry], int]:
    def apply_filters(stmt):
        if company_id_filter is not None:
            stmt = stmt.where(WorkProgressEntry.company_id == company_id_filter)
        if user_id_filter is not None:
            stmt = stmt.where(WorkProgressEntry.user_id == user_id_filter)
        if location_id_filter is not None:
            stmt = stmt.where(WorkProgressEntry.location_id == location_id_filter)
        if status_filter is not None:
            stmt = stmt.where(WorkProgressEntry.status == status_filter)
        if date_from is not None:
            stmt = stmt.where(WorkProgressEntry.work_date >= date_from)
        if date_to is not None:
            stmt = stmt.where(WorkProgressEntry.work_date <= date_to)
        return stmt

    count_stmt = apply_filters(select(func.count()).select_from(WorkProgressEntry))
    total = int(db_session.scalar(count_stmt) or 0)

    stmt = apply_filters(select(WorkProgressEntry))
    stmt = stmt.order_by(WorkProgressEntry.work_date.desc(), WorkProgressEntry.created_at.desc()).limit(
        limit
    ).offset(offset)
    rows = list(db_session.scalars(stmt).all())
    return rows, total


def save_entry(db_session: Session, row: WorkProgressEntry) -> WorkProgressEntry:
    row.updated_at = datetime.now(timezone.utc)
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def save_attachment(db_session: Session, row: WorkProgressAttachment) -> WorkProgressAttachment:
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def get_entry_with_owner(
    db_session: Session,
    entry_id: uuid.UUID,
) -> tuple[WorkProgressEntry, User] | None:
    stmt = (
        select(WorkProgressEntry, User)
        .join(User, User.id == WorkProgressEntry.user_id)
        .where(WorkProgressEntry.id == entry_id)
    )
    row = db_session.execute(stmt).first()
    if row is None:
        return None
    return row[0], row[1]


def list_location_ids_for_user_site_access(
    db_session: Session,
    user_id: uuid.UUID,
) -> list[uuid.UUID]:
    stmt = select(EmployeeLocationAccess.location_id).where(EmployeeLocationAccess.user_id == user_id)
    return list(db_session.scalars(stmt).all())


def get_location_by_id(db_session: Session, location_id: uuid.UUID) -> Location | None:
    return db_session.scalar(select(Location).where(Location.id == location_id))


def get_workplace_by_id(db_session: Session, workplace_id: uuid.UUID) -> Workplace | None:
    return db_session.scalar(select(Workplace).where(Workplace.id == workplace_id))


def get_company_by_id(db_session: Session, company_id: uuid.UUID) -> Company | None:
    return db_session.scalar(select(Company).where(Company.id == company_id))


def get_user_by_id(db_session: Session, user_id: uuid.UUID) -> User | None:
    return db_session.scalar(select(User).where(User.id == user_id))


def get_employee_profile_for_user(
    db_session: Session,
    user_id: uuid.UUID,
) -> EmployeeProfile | None:
    stmt = select(EmployeeProfile).where(EmployeeProfile.user_id == user_id)
    return db_session.scalar(stmt)
