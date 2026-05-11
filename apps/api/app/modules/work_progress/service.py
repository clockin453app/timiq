import uuid
from datetime import date, datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.storage.factory import get_storage_backend
from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.auth.service import can_manage_user
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id
from app.modules.work_progress.models import WorkProgressAttachment, WorkProgressEntry
from app.modules.work_progress.repository import (
    count_attachments_for_entry,
    get_attachment_by_id,
    get_company_by_id,
    get_entry_by_id,
    get_entry_with_owner,
    get_location_by_id,
    get_workplace_by_id,
    get_user_by_id,
    list_attachments_for_entry,
    list_entries_for_user,
    list_location_ids_for_user_site_access,
    list_review_entries,
    save_attachment,
    save_entry,
)
from app.modules.work_progress.schemas import (
    WorkProgressAttachmentPublic,
    WorkProgressCreateRequest,
    WorkProgressEntryDetailResponse,
    WorkProgressEntryListItem,
    WorkProgressMeListResponse,
    WorkProgressMeOptionsResponse,
    WorkProgressReviewDetailResponse,
    WorkProgressReviewListItem,
    WorkProgressReviewListResponse,
    WorkProgressLocationOption,
)

MAX_WORK_PROGRESS_FILE_BYTES = 10 * 1024 * 1024
MAX_ATTACHMENTS_PER_ENTRY = 8

ALLOWED_PROGRESS_STATUSES = frozenset(
    {
        "in_progress",
        "blocked",
        "delayed",
        "complete",
        "on_hold",
    }
)

STATUS_SUBMITTED = "submitted"
STATUS_REVIEWED = "reviewed"

ALLOWED_DOCUMENT_MEDIA = frozenset(
    {
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
    }
)

EXTENSION_BY_MEDIA: dict[str, str] = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


class WorkProgressError(ValueError):
    pass


class WorkProgressNotFoundError(WorkProgressError):
    pass


class WorkProgressPermissionError(WorkProgressError):
    pass


class WorkProgressValidationError(WorkProgressError):
    pass


class WorkProgressStateError(WorkProgressError):
    pass


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_media_type(content_type: str) -> str:
    return (content_type or "").split(";")[0].strip().lower()


def _normalize_uploaded_file(content_type: str, file_bytes: bytes) -> tuple[str, str]:
    if len(file_bytes) == 0:
        raise WorkProgressValidationError("Uploaded file is empty.")
    if len(file_bytes) > MAX_WORK_PROGRESS_FILE_BYTES:
        raise WorkProgressValidationError("Uploaded file is too large (max 10 MB).")
    media = _normalize_media_type(content_type)
    if media == "application/octet-stream" and file_bytes[:4] == b"%PDF":
        media = "application/pdf"
    if media == "application/octet-stream" and len(file_bytes) >= 3 and file_bytes[:3] == b"\xff\xd8\xff":
        media = "image/jpeg"
    if media == "application/octet-stream" and len(file_bytes) >= 8 and file_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        media = "image/png"
    if (
        media == "application/octet-stream"
        and len(file_bytes) >= 12
        and file_bytes[:4] == b"RIFF"
        and file_bytes[8:12] == b"WEBP"
    ):
        media = "image/webp"
    if media not in ALLOWED_DOCUMENT_MEDIA:
        raise WorkProgressValidationError("Only PDF, JPEG, PNG, or WebP files are allowed.")
    ext = EXTENSION_BY_MEDIA.get(media)
    if ext is None:
        raise WorkProgressValidationError("Only PDF, JPEG, PNG, or WebP files are allowed.")
    return media, ext


def _write_binary_file(relative_path: str, file_bytes: bytes) -> Path:
    backend = get_storage_backend()
    absolute_path = backend.build_path(relative_path)
    absolute_path.parent.mkdir(parents=True, exist_ok=True)
    absolute_path.write_bytes(file_bytes)
    return absolute_path


def _allowed_location_ids(db_session: Session, user: User) -> set[uuid.UUID]:
    if user.company_id is None:
        return set()
    ids = list_location_ids_for_user_site_access(db_session, user.id)
    allowed: set[uuid.UUID] = set()
    for loc_id in ids:
        loc = get_location_by_id(db_session, loc_id)
        if loc is None or not loc.is_active:
            continue
        if loc.company_id != user.company_id:
            continue
        allowed.add(loc_id)
    return allowed


def get_me_options(db_session: Session, user: User) -> WorkProgressMeOptionsResponse:
    if user.company_id is None:
        return WorkProgressMeOptionsResponse(locations=[])
    allowed_ids = _allowed_location_ids(db_session, user)
    locations: list[WorkProgressLocationOption] = []
    for loc_id in sorted(allowed_ids, key=lambda x: str(x)):
        loc = get_location_by_id(db_session, loc_id)
        if loc is None:
            continue
        locations.append(
            WorkProgressLocationOption(
                id=loc.id,
                name=loc.name,
                address=loc.address,
            )
        )
    locations.sort(key=lambda o: o.name.lower())
    return WorkProgressMeOptionsResponse(locations=locations)


def _display_name(profile) -> str | None:
    if profile is None:
        return None
    parts = [profile.first_name or "", profile.last_name or ""]
    name = " ".join(p for p in parts if p).strip()
    return name or None


def _location_name(db_session: Session, location_id: uuid.UUID) -> str:
    loc = get_location_by_id(db_session, location_id)
    return loc.name if loc else "Unknown"


def _workplace_name(db_session: Session, workplace_id: uuid.UUID | None) -> str | None:
    if workplace_id is None:
        return None
    wp = get_workplace_by_id(db_session, workplace_id)
    return wp.name if wp else None


def _entry_to_list_item(db_session: Session, row: WorkProgressEntry) -> WorkProgressEntryListItem:
    return WorkProgressEntryListItem(
        id=row.id,
        work_date=row.work_date,
        title=row.title,
        progress_status=row.progress_status,
        percent_complete=row.percent_complete,
        status=row.status,
        location_name=_location_name(db_session, row.location_id),
        workplace_name=_workplace_name(db_session, row.workplace_id),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def list_my_entries(
    db_session: Session,
    user: User,
    *,
    limit: int,
    offset: int,
) -> WorkProgressMeListResponse:
    rows, total = list_entries_for_user(db_session, user.id, limit, offset)
    items = [_entry_to_list_item(db_session, r) for r in rows]
    return WorkProgressMeListResponse(items=items, total=total)


def _build_detail(
    db_session: Session,
    row: WorkProgressEntry,
    attachments: list[WorkProgressAttachment],
) -> WorkProgressEntryDetailResponse:
    return WorkProgressEntryDetailResponse(
        id=row.id,
        user_id=row.user_id,
        company_id=row.company_id,
        workplace_id=row.workplace_id,
        workplace_name=_workplace_name(db_session, row.workplace_id),
        location_id=row.location_id,
        location_name=_location_name(db_session, row.location_id),
        work_date=row.work_date,
        title=row.title,
        progress_status=row.progress_status,
        notes=row.notes,
        percent_complete=row.percent_complete,
        status=row.status,
        reviewed_at=row.reviewed_at,
        review_note=row.review_note,
        attachments=[WorkProgressAttachmentPublic.model_validate(a) for a in attachments],
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _review_detail_response(
    db_session: Session,
    entry: WorkProgressEntry,
    owner: User,
) -> WorkProgressReviewDetailResponse:
    profile = get_employee_profile_by_user_id(db_session, owner.id)
    atts = list_attachments_for_entry(db_session, entry.id)
    base = _build_detail(db_session, entry, atts)
    return WorkProgressReviewDetailResponse(
        **base.model_dump(),
        user_email=owner.email,
        employee_name=_display_name(profile),
    )


def get_my_entry_detail(db_session: Session, user: User, entry_id: uuid.UUID) -> WorkProgressEntryDetailResponse:
    row = get_entry_by_id(db_session, entry_id)
    if row is None or row.user_id != user.id:
        raise WorkProgressNotFoundError()
    atts = list_attachments_for_entry(db_session, row.id)
    return _build_detail(db_session, row, atts)


def create_my_entry(
    db_session: Session,
    user: User,
    body: WorkProgressCreateRequest,
) -> WorkProgressEntryDetailResponse:
    if user.company_id is None:
        raise WorkProgressValidationError("Your account is not assigned to a company.")
    if body.progress_status not in ALLOWED_PROGRESS_STATUSES:
        raise WorkProgressValidationError("Invalid progress status.")
    allowed = _allowed_location_ids(db_session, user)
    if body.location_id not in allowed:
        raise WorkProgressValidationError("That location is not available for your account.")
    loc = get_location_by_id(db_session, body.location_id)
    if loc is None:
        raise WorkProgressValidationError("Location not found.")

    workplace_id = body.workplace_id
    if workplace_id is not None:
        wp = get_workplace_by_id(db_session, workplace_id)
        if wp is None or not wp.is_active:
            raise WorkProgressValidationError("Workplace not found.")
        if wp.company_id != user.company_id:
            raise WorkProgressValidationError("Workplace is not valid for your company.")

    row = WorkProgressEntry(
        user_id=user.id,
        company_id=user.company_id,
        workplace_id=workplace_id,
        location_id=body.location_id,
        work_date=body.work_date,
        title=body.title.strip(),
        progress_status=body.progress_status,
        notes=body.notes.strip() if body.notes else None,
        percent_complete=body.percent_complete,
        status=STATUS_SUBMITTED,
        reviewed_at=None,
        reviewed_by_user_id=None,
        review_note=None,
        created_at=_utc_now(),
        updated_at=_utc_now(),
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)

    create_internal_audit_event(
        db_session=db_session,
        actor=user,
        action="work_progress.submitted",
        entity_type="work_progress_entry",
        entity_id=str(row.id),
        company_id=row.company_id,
        details={
            "work_date": str(row.work_date),
            "location_id": str(row.location_id),
            "title": row.title,
        },
    )
    return _build_detail(db_session, row, [])


def upload_my_entry_file(
    db_session: Session,
    user: User,
    entry_id: uuid.UUID,
    *,
    original_filename: str,
    content_type: str,
    file_bytes: bytes,
) -> WorkProgressEntryDetailResponse:
    row = get_entry_by_id(db_session, entry_id)
    if row is None or row.user_id != user.id:
        raise WorkProgressNotFoundError()
    if count_attachments_for_entry(db_session, row.id) >= MAX_ATTACHMENTS_PER_ENTRY:
        raise WorkProgressValidationError(f"You can upload at most {MAX_ATTACHMENTS_PER_ENTRY} files per entry.")

    media, ext = _normalize_uploaded_file(content_type, file_bytes)
    rel_path = f"work-progress-files/{user.id}/{row.id}/file-{uuid.uuid4().hex}{ext}"
    _write_binary_file(rel_path, file_bytes)

    att = WorkProgressAttachment(
        entry_id=row.id,
        original_filename=original_filename or "upload",
        content_type=media,
        file_size_bytes=len(file_bytes),
        storage_path=rel_path,
        created_at=_utc_now(),
    )
    save_attachment(db_session, att)

    create_internal_audit_event(
        db_session=db_session,
        actor=user,
        action="work_progress.file_uploaded",
        entity_type="work_progress_attachment",
        entity_id=str(att.id),
        company_id=row.company_id,
        details={"entry_id": str(row.id), "filename": att.original_filename},
    )

    atts = list_attachments_for_entry(db_session, row.id)
    return _build_detail(db_session, row, atts)


def resolve_file_download(
    db_session: Session,
    actor: User,
    file_id: uuid.UUID,
) -> tuple[Path, WorkProgressAttachment, WorkProgressEntry, User]:
    att = get_attachment_by_id(db_session, file_id)
    if att is None:
        raise WorkProgressNotFoundError()
    entry = get_entry_by_id(db_session, att.entry_id)
    if entry is None:
        raise WorkProgressNotFoundError()
    owner = get_user_by_id(db_session, entry.user_id)
    if owner is None:
        raise WorkProgressNotFoundError()

    if actor.id != owner.id and not can_manage_user(actor, owner):
        raise WorkProgressPermissionError()

    backend = get_storage_backend()
    path = backend.build_path(att.storage_path)
    if not path.is_file():
        raise WorkProgressNotFoundError()
    return path, att, entry, owner


def download_work_progress_file(
    db_session: Session,
    actor: User,
    file_id: uuid.UUID,
) -> tuple[Path, WorkProgressAttachment]:
    try:
        path, att, entry, owner = resolve_file_download(db_session, actor, file_id)
    except WorkProgressPermissionError:
        raise WorkProgressNotFoundError() from None

    is_admin_view = actor.id != owner.id
    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="work_progress.file_downloaded",
        entity_type="work_progress_attachment",
        entity_id=str(att.id),
        company_id=entry.company_id,
        details={
            "entry_id": str(entry.id),
            "owner_user_id": str(owner.id),
            "as_admin": is_admin_view,
        },
    )
    return path, att


def _assert_review_access(db_session: Session, actor: User, entry_id: uuid.UUID) -> tuple[WorkProgressEntry, User]:
    pair = get_entry_with_owner(db_session, entry_id)
    if pair is None:
        raise WorkProgressNotFoundError()
    entry, owner = pair
    if not can_manage_user(actor, owner):
        raise WorkProgressPermissionError()
    return entry, owner


def list_review(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
    location_id: uuid.UUID | None,
    status_filter: str | None,
    date_from: date | None,
    date_to: date | None,
    limit: int,
    offset: int,
) -> WorkProgressReviewListResponse:
    if actor.system_role not in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        raise WorkProgressPermissionError("You do not have permission to list work progress reviews.")

    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            raise WorkProgressPermissionError("Your admin account is not assigned to a company.")
        company_filter = actor.company_id
        if company_id is not None:
            raise WorkProgressPermissionError("Company filter is only available to an Administrator.")
    else:
        company_filter = company_id

    if user_id is not None:
        target = get_user_by_id(db_session, user_id)
        if target is None:
            raise WorkProgressValidationError("User not found.")
        if actor.system_role == SystemRole.ADMIN:
            if target.company_id != actor.company_id or target.system_role != SystemRole.EMPLOYEE:
                raise WorkProgressPermissionError("You cannot filter by that employee.")

    if location_id is not None:
        loc = get_location_by_id(db_session, location_id)
        if loc is None:
            raise WorkProgressValidationError("Location not found.")
        if actor.system_role == SystemRole.ADMIN and loc.company_id != actor.company_id:
            raise WorkProgressPermissionError("You cannot filter by that location.")
        if actor.system_role == SystemRole.ADMINISTRATOR and company_filter is not None:
            if loc.company_id != company_filter:
                raise WorkProgressPermissionError("Location does not belong to the selected company.")

    rows, total = list_review_entries(
        db_session,
        company_id_filter=company_filter,
        user_id_filter=user_id,
        location_id_filter=location_id,
        status_filter=status_filter,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )

    items: list[WorkProgressReviewListItem] = []
    for row in rows:
        owner = get_user_by_id(db_session, row.user_id)
        profile = get_employee_profile_by_user_id(db_session, row.user_id)
        company = get_company_by_id(db_session, row.company_id)
        items.append(
            WorkProgressReviewListItem(
                id=row.id,
                user_id=row.user_id,
                user_email=owner.email if owner else "",
                employee_name=_display_name(profile),
                company_id=row.company_id,
                company_name=company.name if company else None,
                location_id=row.location_id,
                location_name=_location_name(db_session, row.location_id),
                work_date=row.work_date,
                title=row.title,
                progress_status=row.progress_status,
                status=row.status,
                created_at=row.created_at,
            )
        )
    return WorkProgressReviewListResponse(items=items, total=total)


def get_review_detail(db_session: Session, actor: User, entry_id: uuid.UUID) -> WorkProgressReviewDetailResponse:
    try:
        entry, owner = _assert_review_access(db_session, actor, entry_id)
    except WorkProgressPermissionError:
        raise WorkProgressNotFoundError() from None

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="work_progress.review_detail_viewed",
        entity_type="work_progress_entry",
        entity_id=str(entry.id),
        company_id=entry.company_id,
        details={"owner_user_id": str(owner.id)},
    )

    return _review_detail_response(db_session, entry, owner)


def acknowledge_review(
    db_session: Session,
    actor: User,
    entry_id: uuid.UUID,
    note: str | None,
) -> WorkProgressReviewDetailResponse:
    try:
        entry, owner = _assert_review_access(db_session, actor, entry_id)
    except WorkProgressPermissionError:
        raise WorkProgressNotFoundError() from None

    if entry.status != STATUS_SUBMITTED:
        raise WorkProgressStateError("Only submitted entries can be acknowledged.")

    entry.status = STATUS_REVIEWED
    entry.reviewed_at = _utc_now()
    entry.reviewed_by_user_id = actor.id
    if note and note.strip():
        entry.review_note = note.strip()
    save_entry(db_session, entry)

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="work_progress.acknowledged",
        entity_type="work_progress_entry",
        entity_id=str(entry.id),
        company_id=entry.company_id,
        details={"owner_user_id": str(owner.id)},
    )

    return _review_detail_response(db_session, entry, owner)


def add_review_comment(
    db_session: Session,
    actor: User,
    entry_id: uuid.UUID,
    comment: str,
) -> WorkProgressReviewDetailResponse:
    try:
        entry, owner = _assert_review_access(db_session, actor, entry_id)
    except WorkProgressPermissionError:
        raise WorkProgressNotFoundError() from None

    if entry.status != STATUS_REVIEWED:
        raise WorkProgressStateError("Comments can only be added after an entry is reviewed.")

    text = comment.strip()
    if entry.review_note:
        entry.review_note = f"{entry.review_note}\n\n{text}"
    else:
        entry.review_note = text
    save_entry(db_session, entry)

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="work_progress.review_note_added",
        entity_type="work_progress_entry",
        entity_id=str(entry.id),
        company_id=entry.company_id,
        details={"owner_user_id": str(owner.id)},
    )

    return _review_detail_response(db_session, entry, owner)
