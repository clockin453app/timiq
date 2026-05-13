import io
import uuid
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.storage.factory import get_storage_backend
from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.auth.service import can_manage_user
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id
from app.modules.work_progress.models import WorkProgressAttachment, WorkProgressEntry
from app.modules.work_progress.image_processing import (
    PROCESSING_VERSION,
    detect_magic_file_kind,
    process_site_progress_photo,
)
from app.modules.work_progress.repository import (
    count_attachments_for_entry,
    count_review_attachments,
    delete_attachments_many,
    get_attachment_by_id,
    get_company_by_id,
    get_entry_by_id,
    get_entry_with_owner,
    get_location_by_id,
    get_workplace_by_id,
    get_user_by_id,
    list_attachments_by_ids_with_entries,
    list_attachments_for_entry,
    list_attachments_for_entry_ids,
    list_entries_for_user,
    list_location_ids_for_user_site_access,
    list_review_attachments_page,
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
    WorkProgressReviewAttachmentGalleryItem,
    WorkProgressReviewAttachmentGalleryResponse,
    WorkProgressReviewDetailResponse,
    WorkProgressReviewListItem,
    WorkProgressReviewListResponse,
    WorkProgressLocationOption,
)

# Original upload ceiling (before server-side resize/compress). Large phone photos are accepted then optimised.
MAX_ORIGINAL_PHOTO_BYTES = 25 * 1024 * 1024
# Safety ceiling for processed JPEG output (long edge 1600, q≈82 — normally far smaller).
MAX_STORED_JPEG_BYTES = 10 * 1024 * 1024
MAX_ATTACHMENTS_PER_ENTRY = 20

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

STORED_JPEG_MEDIA = "image/jpeg"


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


def _validate_and_process_new_progress_photo(file_bytes: bytes) -> tuple[bytes, int, int, int]:
    """Validate magic bytes (JPEG/PNG/WebP only), optimise to JPEG. Returns (jpeg_bytes, orig_len, w, h)."""
    if len(file_bytes) == 0:
        raise WorkProgressValidationError("Uploaded file is empty.")
    if len(file_bytes) > MAX_ORIGINAL_PHOTO_BYTES:
        max_mb = MAX_ORIGINAL_PHOTO_BYTES // (1024 * 1024)
        raise WorkProgressValidationError(
            f"Image file is too large before optimisation (max {max_mb} MB per original photo)."
        )

    kind = detect_magic_file_kind(file_bytes)
    if kind == "pdf":
        raise WorkProgressValidationError("PDF uploads are not allowed for site progress photos.")
    if kind not in ("jpeg", "png", "webp"):
        raise WorkProgressValidationError("Unsupported image type. Only JPEG, PNG, or WebP are allowed.")

    try:
        processed, w, h = process_site_progress_photo(file_bytes)
    except Exception:
        raise WorkProgressValidationError("Failed to process image. Try a different photo.") from None

    if len(processed) > MAX_STORED_JPEG_BYTES:
        raise WorkProgressValidationError("Failed to produce a reasonably sized image. Try a different photo.")

    return processed, len(file_bytes), w, h


def _remove_storage_file(att: WorkProgressAttachment) -> None:
    backend = get_storage_backend()
    try:
        backend.delete_file(att.storage_path)
    except OSError as exc:
        raise WorkProgressValidationError(
            "The file could not be removed from storage. No database changes were made."
        ) from exc


def _download_media_type(att: WorkProgressAttachment) -> str:
    return att.stored_content_type or att.content_type


def _download_filename(att: WorkProgressAttachment) -> str:
    name = att.original_filename or "download"
    media = _download_media_type(att)
    if media == STORED_JPEG_MEDIA:
        stem = Path(name).stem
        lower = name.lower()
        if lower.endswith((".jpg", ".jpeg")):
            return name
        return f"{stem}.jpg"
    return name


def work_progress_attachment_response_media_type(att: WorkProgressAttachment) -> str:
    return _download_media_type(att)


def work_progress_attachment_response_filename(att: WorkProgressAttachment) -> str:
    return _download_filename(att)


def _write_binary_file(relative_path: str, file_bytes: bytes) -> None:
    get_storage_backend().write_bytes(relative_path, file_bytes)


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
        return WorkProgressMeOptionsResponse(
            locations=[],
            max_attachments_per_entry=MAX_ATTACHMENTS_PER_ENTRY,
            max_original_image_bytes=MAX_ORIGINAL_PHOTO_BYTES,
        )
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
    return WorkProgressMeOptionsResponse(
        locations=locations,
        max_attachments_per_entry=MAX_ATTACHMENTS_PER_ENTRY,
        max_original_image_bytes=MAX_ORIGINAL_PHOTO_BYTES,
    )


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


def _entry_to_list_item(
    db_session: Session,
    row: WorkProgressEntry,
    attachments: list[WorkProgressAttachment] | None = None,
) -> WorkProgressEntryListItem:
    atts = attachments if attachments is not None else []
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
        attachments=[WorkProgressAttachmentPublic.model_validate(a) for a in atts],
    )


def list_my_entries(
    db_session: Session,
    user: User,
    *,
    limit: int,
    offset: int,
) -> WorkProgressMeListResponse:
    rows, total = list_entries_for_user(db_session, user.id, limit, offset)
    grouped = list_attachments_for_entry_ids(db_session, [r.id for r in rows])
    items = [_entry_to_list_item(db_session, r, grouped.get(r.id, [])) for r in rows]
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
    del content_type  # Declared MIME is not trusted for allowlisting; magic bytes are authoritative.
    row = get_entry_by_id(db_session, entry_id)
    if row is None or row.user_id != user.id:
        raise WorkProgressNotFoundError()
    if count_attachments_for_entry(db_session, row.id) >= MAX_ATTACHMENTS_PER_ENTRY:
        raise WorkProgressValidationError(
            f"Maximum number of photos reached for this entry ({MAX_ATTACHMENTS_PER_ENTRY})."
        )

    processed, original_len, img_w, img_h = _validate_and_process_new_progress_photo(file_bytes)
    rel_path = f"work-progress-files/{user.id}/{row.id}/file-{uuid.uuid4().hex}.jpg"
    _write_binary_file(rel_path, processed)
    stored_len = len(processed)

    att = WorkProgressAttachment(
        entry_id=row.id,
        original_filename=original_filename or "upload",
        content_type=STORED_JPEG_MEDIA,
        file_size_bytes=stored_len,
        storage_path=rel_path,
        original_size_bytes=original_len,
        stored_size_bytes=stored_len,
        stored_content_type=STORED_JPEG_MEDIA,
        image_width=img_w,
        image_height=img_h,
        processing_version=PROCESSING_VERSION,
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
) -> tuple[bytes, WorkProgressAttachment, WorkProgressEntry, User]:
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
    if not backend.exists(att.storage_path):
        raise WorkProgressNotFoundError()
    try:
        data = backend.read_bytes(att.storage_path)
    except FileNotFoundError:
        raise WorkProgressNotFoundError() from None
    return data, att, entry, owner


def download_work_progress_file(
    db_session: Session,
    actor: User,
    file_id: uuid.UUID,
) -> tuple[bytes, WorkProgressAttachment]:
    try:
        data, att, entry, owner = resolve_file_download(db_session, actor, file_id)
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
    return data, att


def _assert_review_access(db_session: Session, actor: User, entry_id: uuid.UUID) -> tuple[WorkProgressEntry, User]:
    pair = get_entry_with_owner(db_session, entry_id)
    if pair is None:
        raise WorkProgressNotFoundError()
    entry, owner = pair
    if not can_manage_user(actor, owner):
        raise WorkProgressPermissionError()
    return entry, owner


def _resolve_review_list_filters(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
    location_id: uuid.UUID | None,
    status_filter: str | None,
    date_from: date | None,
    date_to: date | None,
) -> tuple[uuid.UUID | None, uuid.UUID | None, uuid.UUID | None, str | None, date | None, date | None]:
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

    return company_filter, user_id, location_id, status_filter, date_from, date_to


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
    title_search: str | None,
    limit: int,
    offset: int,
) -> WorkProgressReviewListResponse:
    company_filter, user_id, location_id, status_f, d_from, d_to = _resolve_review_list_filters(
        db_session,
        actor,
        company_id=company_id,
        user_id=user_id,
        location_id=location_id,
        status_filter=status_filter,
        date_from=date_from,
        date_to=date_to,
    )

    rows, total = list_review_entries(
        db_session,
        company_id_filter=company_filter,
        user_id_filter=user_id,
        location_id_filter=location_id,
        status_filter=status_f,
        date_from=d_from,
        date_to=d_to,
        title_search=title_search,
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


def list_review_attachment_gallery(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
    location_id: uuid.UUID | None,
    status_filter: str | None,
    date_from: date | None,
    date_to: date | None,
    title_search: str | None,
    limit: int,
    offset: int,
) -> WorkProgressReviewAttachmentGalleryResponse:
    company_filter, uid, loc_id, status_f, d_from, d_to = _resolve_review_list_filters(
        db_session,
        actor,
        company_id=company_id,
        user_id=user_id,
        location_id=location_id,
        status_filter=status_filter,
        date_from=date_from,
        date_to=date_to,
    )

    total = count_review_attachments(
        db_session,
        company_id_filter=company_filter,
        user_id_filter=uid,
        location_id_filter=loc_id,
        status_filter=status_f,
        date_from=d_from,
        date_to=d_to,
        title_search=title_search,
    )
    page = list_review_attachments_page(
        db_session,
        company_id_filter=company_filter,
        user_id_filter=uid,
        location_id_filter=loc_id,
        status_filter=status_f,
        date_from=d_from,
        date_to=d_to,
        title_search=title_search,
        limit=limit,
        offset=offset,
    )

    items: list[WorkProgressReviewAttachmentGalleryItem] = []
    for att, entry in page:
        owner = get_user_by_id(db_session, entry.user_id)
        profile = get_employee_profile_by_user_id(db_session, entry.user_id)
        items.append(
            WorkProgressReviewAttachmentGalleryItem(
                attachment=WorkProgressAttachmentPublic.model_validate(att),
                entry_id=entry.id,
                work_date=entry.work_date,
                title=entry.title,
                location_id=entry.location_id,
                location_name=_location_name(db_session, entry.location_id),
                user_id=entry.user_id,
                user_email=owner.email if owner else "",
                employee_name=_display_name(profile),
            )
        )
    return WorkProgressReviewAttachmentGalleryResponse(items=items, total=total)


def _ordered_bulk_attachment_rows(
    db_session: Session,
    file_ids: list[uuid.UUID],
) -> list[tuple[WorkProgressAttachment, WorkProgressEntry]]:
    unique_ids = list(dict.fromkeys(file_ids))
    want = set(unique_ids)
    rows = list_attachments_by_ids_with_entries(db_session, list(want))
    found = {att.id for att, _ in rows}
    if found != want or len(rows) != len(want):
        raise WorkProgressNotFoundError()
    by_id = {att.id: (att, ent) for att, ent in rows}
    return [by_id[fid] for fid in unique_ids]


def _assert_bulk_attachment_scope(
    db_session: Session,
    actor: User,
    ordered: list[tuple[WorkProgressAttachment, WorkProgressEntry]],
) -> list[tuple[WorkProgressAttachment, WorkProgressEntry, User]]:
    out: list[tuple[WorkProgressAttachment, WorkProgressEntry, User]] = []
    for att, entry in ordered:
        owner = get_user_by_id(db_session, entry.user_id)
        if owner is None:
            raise WorkProgressNotFoundError()
        if not can_manage_user(actor, owner):
            raise WorkProgressNotFoundError()
        out.append((att, entry, owner))
    return out


def bulk_download_review_attachments_zip(
    db_session: Session,
    actor: User,
    file_ids: list[uuid.UUID],
) -> bytes:
    if actor.system_role not in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        raise WorkProgressPermissionError()

    ordered = _ordered_bulk_attachment_rows(db_session, file_ids)
    triples = _assert_bulk_attachment_scope(db_session, actor, ordered)

    backend = get_storage_backend()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for att, entry, _ in triples:
            if not backend.exists(att.storage_path):
                raise WorkProgressNotFoundError()
            try:
                raw = backend.read_bytes(att.storage_path)
            except FileNotFoundError:
                raise WorkProgressNotFoundError() from None
            safe = Path(att.original_filename or "file").name.replace("/", "_").replace("\\", "_")
            arcname = f"{entry.work_date}_{att.id.hex[:8]}_{safe}"
            zf.writestr(arcname, raw)

    company_id_for_audit = triples[0][1].company_id if triples else None
    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="work_progress.attachments_bulk_downloaded",
        entity_type="work_progress_attachment",
        entity_id=None,
        company_id=company_id_for_audit,
        details={
            "file_count": len(triples),
            "attachment_ids": [str(att.id) for att, _, _ in triples],
        },
    )
    return buf.getvalue()


def bulk_delete_review_attachments(
    db_session: Session,
    actor: User,
    file_ids: list[uuid.UUID],
) -> None:
    if actor.system_role not in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        raise WorkProgressPermissionError()

    ordered = _ordered_bulk_attachment_rows(db_session, file_ids)
    triples = _assert_bulk_attachment_scope(db_session, actor, ordered)

    attachments = [att for att, _, _ in triples]
    for att in attachments:
        _remove_storage_file(att)

    delete_attachments_many(db_session, attachments)

    company_id_for_audit = triples[0][1].company_id if triples else None
    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="work_progress.attachments_bulk_deleted",
        entity_type="work_progress_attachment",
        entity_id=None,
        company_id=company_id_for_audit,
        details={"file_count": len(attachments), "attachment_ids": [str(a.id) for a in attachments]},
    )


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
