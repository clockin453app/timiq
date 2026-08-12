import re
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.modules.auth.models import User
from app.modules.companies.models import Company
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.locations.models import Location
from app.modules.site_access.models import EmployeeLocationAccess
from app.modules.work_progress.classification import (
    ELEVATION_OPTIONS,
    LEVEL_MAX,
    LEVEL_MIN,
    WORK_CATEGORY_OPTIONS,
)
from app.modules.work_progress.models import WorkProgressAttachment, WorkProgressEntry
from app.modules.workplaces.models import Workplace


def get_entry_by_id(db_session: Session, entry_id: uuid.UUID) -> WorkProgressEntry | None:
    stmt = select(WorkProgressEntry).where(WorkProgressEntry.id == entry_id)
    return db_session.scalar(stmt)


def get_attachment_by_id(db_session: Session, attachment_id: uuid.UUID) -> WorkProgressAttachment | None:
    stmt = select(WorkProgressAttachment).where(WorkProgressAttachment.id == attachment_id)
    return db_session.scalar(stmt)


def get_attachment_by_client_upload_id(
    db_session: Session,
    entry_id: uuid.UUID,
    client_upload_id: uuid.UUID,
) -> WorkProgressAttachment | None:
    stmt = select(WorkProgressAttachment).where(
        WorkProgressAttachment.entry_id == entry_id,
        WorkProgressAttachment.client_upload_id == client_upload_id,
    )
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


def _escape_ilike(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _classification_values_matching_search(
    options: tuple[tuple[str, str], ...],
    needle: str,
) -> list[str]:
    """Match controlled values by exact label/value first, else substring on label/value."""
    n = needle.strip().lower()
    if not n:
        return []
    exact = [value for value, label in options if label.lower() == n or value == n]
    if exact:
        return exact
    return [
        value
        for value, label in options
        if n in label.lower() or n in value.replace("_", " ") or n in value
    ]


def _levels_matching_search(needle: str) -> list[int]:
    n = needle.strip().lower()
    if not n:
        return []
    match = re.fullmatch(r"level\s*0*(\d{1,2})", n)
    if match:
        value = int(match.group(1))
        return [value] if LEVEL_MIN <= value <= LEVEL_MAX else []
    if re.fullmatch(r"\d{1,2}", n):
        value = int(n)
        return [value] if LEVEL_MIN <= value <= LEVEL_MAX else []
    # Partial "level 0" style already covered by fullmatch with optional spaces.
    padded = re.fullmatch(r"0*(\d{1,2})", n)
    if padded and n.startswith("0") and len(n) == 2:
        value = int(padded.group(1))
        return [value] if LEVEL_MIN <= value <= LEVEL_MAX else []
    return []


def _apply_review_entry_filters(
    stmt,
    *,
    company_id_filter: uuid.UUID | None,
    user_id_filter: uuid.UUID | None,
    location_id_filter: uuid.UUID | None,
    status_filter: str | None,
    date_from: date | None,
    date_to: date | None,
    title_search: str | None,
    entry_id_filter: uuid.UUID | None = None,
    include_archived: bool = False,
    work_category: str | None = None,
    elevation: str | None = None,
    level: int | None = None,
):
    if entry_id_filter is not None:
        stmt = stmt.where(WorkProgressEntry.id == entry_id_filter)
    if company_id_filter is not None:
        stmt = stmt.where(WorkProgressEntry.company_id == company_id_filter)
    if user_id_filter is not None:
        stmt = stmt.where(WorkProgressEntry.user_id == user_id_filter)
    if location_id_filter is not None:
        stmt = stmt.where(WorkProgressEntry.location_id == location_id_filter)
    if status_filter is not None:
        stmt = stmt.where(WorkProgressEntry.status == status_filter)
    elif not include_archived:
        stmt = stmt.where(WorkProgressEntry.status != "archived")
    if date_from is not None:
        stmt = stmt.where(WorkProgressEntry.work_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(WorkProgressEntry.work_date <= date_to)
    if work_category is not None:
        stmt = stmt.where(WorkProgressEntry.work_category == work_category)
    if elevation is not None:
        stmt = stmt.where(WorkProgressEntry.elevation == elevation)
    if level is not None:
        stmt = stmt.where(WorkProgressEntry.level == level)
    if title_search and title_search.strip():
        raw = title_search.strip()
        term = f"%{_escape_ilike(raw)}%"
        clauses = [
            WorkProgressEntry.title.ilike(term, escape="\\"),
            WorkProgressEntry.elevation_custom.ilike(term, escape="\\"),
            WorkProgressEntry.progress_status.ilike(term, escape="\\"),
        ]
        matching_categories = _classification_values_matching_search(WORK_CATEGORY_OPTIONS, raw)
        if matching_categories:
            clauses.append(WorkProgressEntry.work_category.in_(matching_categories))
        matching_elevations = _classification_values_matching_search(ELEVATION_OPTIONS, raw)
        if matching_elevations:
            clauses.append(WorkProgressEntry.elevation.in_(matching_elevations))
        matching_levels = _levels_matching_search(raw)
        if matching_levels:
            clauses.append(WorkProgressEntry.level.in_(matching_levels))
        stmt = stmt.where(or_(*clauses))
    return stmt


def list_review_entries(
    db_session: Session,
    *,
    company_id_filter: uuid.UUID | None,
    user_id_filter: uuid.UUID | None,
    location_id_filter: uuid.UUID | None,
    status_filter: str | None,
    date_from: date | None,
    date_to: date | None,
    title_search: str | None,
    limit: int,
    offset: int,
    include_archived: bool = False,
    work_category: str | None = None,
    elevation: str | None = None,
    level: int | None = None,
) -> tuple[list[WorkProgressEntry], int]:
    count_stmt = _apply_review_entry_filters(
        select(func.count()).select_from(WorkProgressEntry),
        company_id_filter=company_id_filter,
        user_id_filter=user_id_filter,
        location_id_filter=location_id_filter,
        status_filter=status_filter,
        include_archived=include_archived,
        date_from=date_from,
        date_to=date_to,
        title_search=title_search,
        work_category=work_category,
        elevation=elevation,
        level=level,
    )
    total = int(db_session.scalar(count_stmt) or 0)

    stmt = _apply_review_entry_filters(
        select(WorkProgressEntry),
        company_id_filter=company_id_filter,
        user_id_filter=user_id_filter,
        location_id_filter=location_id_filter,
        status_filter=status_filter,
        include_archived=include_archived,
        date_from=date_from,
        date_to=date_to,
        title_search=title_search,
        work_category=work_category,
        elevation=elevation,
        level=level,
    )
    stmt = stmt.order_by(WorkProgressEntry.work_date.desc(), WorkProgressEntry.created_at.desc()).limit(
        limit
    ).offset(offset)
    rows = list(db_session.scalars(stmt).all())
    return rows, total


MAX_REVIEW_EXPORT_ROWS = 20_000


def list_review_entries_for_export(
    db_session: Session,
    *,
    company_id_filter: uuid.UUID | None,
    user_id_filter: uuid.UUID | None,
    location_id_filter: uuid.UUID | None,
    status_filter: str | None,
    date_from: date | None,
    date_to: date | None,
    title_search: str | None,
    work_category: str | None = None,
    elevation: str | None = None,
    level: int | None = None,
) -> list[WorkProgressEntry]:
    stmt = _apply_review_entry_filters(
        select(WorkProgressEntry),
        company_id_filter=company_id_filter,
        user_id_filter=user_id_filter,
        location_id_filter=location_id_filter,
        status_filter=status_filter,
        date_from=date_from,
        date_to=date_to,
        title_search=title_search,
        work_category=work_category,
        elevation=elevation,
        level=level,
    )
    stmt = stmt.order_by(WorkProgressEntry.work_date.desc(), WorkProgressEntry.created_at.desc()).limit(
        MAX_REVIEW_EXPORT_ROWS,
    )
    return list(db_session.scalars(stmt).all())


def count_attachments_for_entry_ids(
    db_session: Session,
    entry_ids: list[uuid.UUID],
) -> dict[uuid.UUID, int]:
    if not entry_ids:
        return {}
    stmt = (
        select(WorkProgressAttachment.entry_id, func.count())
        .where(WorkProgressAttachment.entry_id.in_(entry_ids))
        .group_by(WorkProgressAttachment.entry_id)
    )
    rows = db_session.execute(stmt).all()
    return {eid: int(n) for eid, n in rows}


def count_review_entries(
    db_session: Session,
    *,
    company_id_filter: uuid.UUID | None,
    status_filter: str | None,
) -> int:
    """Count review-queue entries with the same filters as list_review_entries (no pagination)."""
    stmt = _apply_review_entry_filters(
        select(func.count()).select_from(WorkProgressEntry),
        company_id_filter=company_id_filter,
        user_id_filter=None,
        location_id_filter=None,
        status_filter=status_filter,
        date_from=None,
        date_to=None,
        title_search=None,
    )
    return int(db_session.scalar(stmt) or 0)


def count_review_attachments(
    db_session: Session,
    *,
    company_id_filter: uuid.UUID | None,
    user_id_filter: uuid.UUID | None,
    location_id_filter: uuid.UUID | None,
    status_filter: str | None,
    date_from: date | None,
    date_to: date | None,
    title_search: str | None,
    include_archived: bool = False,
    entry_id_filter: uuid.UUID | None = None,
    work_category: str | None = None,
    elevation: str | None = None,
    level: int | None = None,
) -> int:
    stmt = (
        select(func.count())
        .select_from(WorkProgressAttachment)
        .join(WorkProgressEntry, WorkProgressEntry.id == WorkProgressAttachment.entry_id)
    )
    stmt = _apply_review_entry_filters(
        stmt,
        entry_id_filter=entry_id_filter,
        company_id_filter=company_id_filter,
        user_id_filter=user_id_filter,
        location_id_filter=location_id_filter,
        status_filter=status_filter,
        include_archived=include_archived,
        date_from=date_from,
        date_to=date_to,
        title_search=title_search,
        work_category=work_category,
        elevation=elevation,
        level=level,
    )
    return int(db_session.scalar(stmt) or 0)


def list_review_attachments_page(
    db_session: Session,
    *,
    company_id_filter: uuid.UUID | None,
    user_id_filter: uuid.UUID | None,
    location_id_filter: uuid.UUID | None,
    status_filter: str | None,
    date_from: date | None,
    date_to: date | None,
    title_search: str | None,
    limit: int,
    offset: int,
    include_archived: bool = False,
    entry_id_filter: uuid.UUID | None = None,
    work_category: str | None = None,
    elevation: str | None = None,
    level: int | None = None,
) -> list[tuple[WorkProgressAttachment, WorkProgressEntry]]:
    stmt = (
        select(WorkProgressAttachment, WorkProgressEntry)
        .join(WorkProgressEntry, WorkProgressEntry.id == WorkProgressAttachment.entry_id)
    )
    stmt = _apply_review_entry_filters(
        stmt,
        entry_id_filter=entry_id_filter,
        company_id_filter=company_id_filter,
        user_id_filter=user_id_filter,
        location_id_filter=location_id_filter,
        status_filter=status_filter,
        include_archived=include_archived,
        date_from=date_from,
        date_to=date_to,
        title_search=title_search,
        work_category=work_category,
        elevation=elevation,
        level=level,
    )
    stmt = stmt.order_by(WorkProgressAttachment.created_at.desc()).limit(limit).offset(offset)
    rows = db_session.execute(stmt).all()
    return [(r[0], r[1]) for r in rows]


def list_attachments_for_entry_ids(
    db_session: Session,
    entry_ids: list[uuid.UUID],
) -> dict[uuid.UUID, list[WorkProgressAttachment]]:
    if not entry_ids:
        return {}
    stmt = (
        select(WorkProgressAttachment)
        .where(WorkProgressAttachment.entry_id.in_(entry_ids))
        .order_by(WorkProgressAttachment.entry_id.asc(), WorkProgressAttachment.created_at.asc())
    )
    rows = list(db_session.scalars(stmt).all())
    out: dict[uuid.UUID, list[WorkProgressAttachment]] = {}
    for r in rows:
        out.setdefault(r.entry_id, []).append(r)
    return out


def list_attachments_by_ids_with_entries(
    db_session: Session,
    file_ids: list[uuid.UUID],
) -> list[tuple[WorkProgressAttachment, WorkProgressEntry]]:
    if not file_ids:
        return []
    stmt = (
        select(WorkProgressAttachment, WorkProgressEntry)
        .join(WorkProgressEntry, WorkProgressEntry.id == WorkProgressAttachment.entry_id)
        .where(WorkProgressAttachment.id.in_(file_ids))
    )
    rows = db_session.execute(stmt).all()
    return [(r[0], r[1]) for r in rows]


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


def delete_attachment_row(db_session: Session, row: WorkProgressAttachment) -> None:
    db_session.delete(row)
    db_session.commit()


def delete_attachments_many(db_session: Session, rows: list[WorkProgressAttachment]) -> None:
    for row in rows:
        db_session.delete(row)
    db_session.commit()


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
