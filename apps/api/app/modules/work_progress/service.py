import io
import csv
import threading
import uuid
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path, PurePosixPath

from sqlalchemy.orm import Session

from app.core.export_csv import safe_export_filename, truncate_plain_text
from app.core.storage.factory import get_storage_backend
from app.modules.audit.models import AuditEvent
from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.work_progress.classification import (
    CLASSIFIED_PROGRESS_STATUS,
    ELEVATION_CUSTOM,
    ELEVATION_CUSTOM_MAX_LEN,
    ELEVATION_LABELS,
    ELEVATION_VALUES,
    LEVEL_MAX,
    LEVEL_MIN,
    WORK_CATEGORY_LABELS,
    WORK_CATEGORY_VALUES,
)
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id
from app.modules.work_progress.models import WorkProgressAttachment, WorkProgressEntry
from app.modules.work_progress.image_processing import (
    PROCESSING_VERSION,
    ImageProcessingError,
    detect_magic_file_kind,
    process_site_progress_photo,
)
from app.modules.work_progress.thumbnail_sync import work_progress_image_processing_semaphore
from app.modules.work_progress.repository import (
    count_attachments_for_entry,
    count_attachments_for_entry_ids,
    count_review_attachments,
    delete_attachments_many,
    get_attachment_by_client_upload_id,
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
    list_review_entries_for_export,
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
MAX_ATTACHMENTS_PER_ENTRY = 30
MAX_ZIP_ATTACHMENT_IDS = 48
MAX_ZIP_TOTAL_BYTES = 64 * 1024 * 1024
MAX_BULK_ATTACHMENT_IDS = 200
_ZIP_GENERATION_SEMAPHORE = threading.BoundedSemaphore(1)

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
STATUS_ARCHIVED = "archived"

STORED_JPEG_MEDIA = "image/jpeg"


def _format_level_display(level: int | None) -> str | None:
    if level is None:
        return None
    return f"{level:02d}"


def _elevation_display(elevation: str | None, elevation_custom: str | None) -> str | None:
    if elevation is None:
        return None
    if elevation == ELEVATION_CUSTOM:
        custom = (elevation_custom or "").strip()
        return custom or None
    return ELEVATION_LABELS.get(elevation)


def _classification_fields(row: WorkProgressEntry) -> dict[str, object]:
    category = getattr(row, "work_category", None)
    elevation = getattr(row, "elevation", None)
    elevation_custom = getattr(row, "elevation_custom", None)
    level = getattr(row, "level", None)
    return {
        "work_category": category,
        "elevation": elevation,
        "elevation_custom": elevation_custom,
        "level": level,
        "work_category_label": WORK_CATEGORY_LABELS.get(category) if category else None,
        "elevation_display": _elevation_display(elevation, elevation_custom),
        "level_display": _format_level_display(level),
    }


def _validate_classification(body: WorkProgressCreateRequest) -> tuple[str, str, str | None, int]:
    category = body.work_category.strip()
    elevation = body.elevation.strip()
    if category not in WORK_CATEGORY_VALUES:
        raise WorkProgressValidationError("Invalid work category.")
    if elevation not in ELEVATION_VALUES:
        raise WorkProgressValidationError("Invalid elevation.")
    if body.level < LEVEL_MIN or body.level > LEVEL_MAX:
        raise WorkProgressValidationError("Level must be between 0 and 20.")
    custom: str | None = None
    if elevation == ELEVATION_CUSTOM:
        custom = (body.elevation_custom or "").strip()
        if not custom:
            raise WorkProgressValidationError("Elevation name is required for Custom / site-defined.")
        if len(custom) > ELEVATION_CUSTOM_MAX_LEN:
            raise WorkProgressValidationError(
                f"Elevation name must be at most {ELEVATION_CUSTOM_MAX_LEN} characters."
            )
    elif body.elevation_custom and body.elevation_custom.strip():
        raise WorkProgressValidationError("Elevation name is only allowed for Custom / site-defined.")
    return category, elevation, custom, body.level


def _normalize_review_classification_filters(
    *,
    work_category: str | None,
    elevation: str | None,
    level: int | None,
) -> tuple[str | None, str | None, int | None]:
    category = work_category.strip() if work_category and work_category.strip() else None
    elev = elevation.strip() if elevation and elevation.strip() else None
    if category is not None and category not in WORK_CATEGORY_VALUES:
        raise WorkProgressValidationError("Invalid work category filter.")
    if elev is not None and elev not in ELEVATION_VALUES:
        raise WorkProgressValidationError("Invalid elevation filter.")
    if level is not None and (level < LEVEL_MIN or level > LEVEL_MAX):
        raise WorkProgressValidationError("Level filter must be between 0 and 20.")
    return category, elev, level


def _actor_can_manage_company_work_progress(actor: User, entry: WorkProgressEntry) -> bool:
    """Review/delete scope: Administrator any; company Admin any entry in their company.

    Aligns with review list visibility (company-wide). Does not use can_manage_user so
    Admin-authored Site Progress submissions remain deletable by company Admin.
    """
    if actor.system_role == SystemRole.ADMINISTRATOR:
        return True
    if actor.system_role == SystemRole.ADMIN:
        return actor.company_id is not None and entry.company_id == actor.company_id
    return False


def _actor_can_access_work_progress_entry(actor: User, entry: WorkProgressEntry, owner: User) -> bool:
    if actor.id == owner.id:
        return True
    return _actor_can_manage_company_work_progress(actor, entry)


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


class WorkProgressZipLimitError(WorkProgressError):
    """ZIP request rejected for count or total size limits."""

    def __init__(self, *, code: str, message: str, http_status: int, extra: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status
        self.extra = extra or {}


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
        with work_progress_image_processing_semaphore():
            processed, w, h = process_site_progress_photo(file_bytes)
    except ImageProcessingError as exc:
        code = str(exc)
        if code == "too_many_pixels" or code == "dimension_too_large":
            raise WorkProgressValidationError(
                "Image dimensions are too large to process safely. Try a lower-resolution photo."
            ) from exc
        if code == "decompression_bomb":
            raise WorkProgressValidationError("Image file is too large to decode safely.") from exc
        raise WorkProgressValidationError("Failed to process image. Try a different photo.") from exc
    except Exception:
        raise WorkProgressValidationError("Failed to process image. Try a different photo.") from None

    if len(processed) > MAX_STORED_JPEG_BYTES:
        raise WorkProgressValidationError("Failed to produce a reasonably sized image. Try a different photo.")

    return processed, len(file_bytes), w, h


def _delete_storage_path(relative_path: str) -> None:
    backend = get_storage_backend()
    try:
        backend.delete_file(relative_path)
    except OSError:
        pass


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
        **_classification_fields(row),
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
        **_classification_fields(row),
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


def _assert_persisted_classification(
    row: WorkProgressEntry,
    *,
    category: str,
    elevation: str,
    elevation_custom: str | None,
    level: int,
) -> None:
    """Fail closed if classification did not land in work_progress_entries.

    Level must use identity checks so integer 0 (Level 00) is never treated as missing.
    """
    errors: list[str] = []
    if row.work_category != category:
        errors.append("work_category")
    if row.elevation != elevation:
        errors.append("elevation")
    if (row.elevation_custom or None) != (elevation_custom or None):
        errors.append("elevation_custom")
    if row.level is None or row.level != level:
        errors.append("level")
    if errors:
        raise WorkProgressValidationError(
            "Site Progress classification failed to persist (" + ", ".join(errors) + "). "
            "Please retry. If this continues, contact support before submitting again."
        )


def create_my_entry(
    db_session: Session,
    user: User,
    body: WorkProgressCreateRequest,
) -> WorkProgressEntryDetailResponse:
    if user.company_id is None:
        raise WorkProgressValidationError("Your account is not assigned to a company.")
    category, elevation, elevation_custom, level = _validate_classification(body)
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

    now = _utc_now()
    row = WorkProgressEntry(
        user_id=user.id,
        company_id=user.company_id,
        workplace_id=workplace_id,
        location_id=body.location_id,
        work_date=body.work_date,
        title="",
        progress_status=CLASSIFIED_PROGRESS_STATUS,
        notes=body.notes.strip() if body.notes else None,
        percent_complete=None,
        status=STATUS_SUBMITTED,
        reviewed_at=None,
        reviewed_by_user_id=None,
        review_note=None,
        created_at=now,
        updated_at=now,
    )
    # Assign classification after construction so mapper state is unambiguously dirty,
    # including level=0 (Level 00) which must never be skipped by truthiness checks.
    row.work_category = category
    row.elevation = elevation
    row.elevation_custom = elevation_custom
    row.level = level
    db_session.add(row)
    try:
        db_session.flush()
        db_session.commit()
    except Exception:
        db_session.rollback()
        raise

    persisted = get_entry_by_id(db_session, row.id)
    if persisted is None:
        raise WorkProgressValidationError("Site Progress submission could not be reloaded after save.")
    try:
        _assert_persisted_classification(
            persisted,
            category=category,
            elevation=elevation,
            elevation_custom=elevation_custom,
            level=level,
        )
    except WorkProgressValidationError:
        # Leave the incomplete row for support inspection; do not write a misleading submit audit.
        raise

    audit_details: dict[str, object] = {
        "work_date": str(persisted.work_date),
        "location_id": str(persisted.location_id),
        "work_category": persisted.work_category,
        "elevation": persisted.elevation,
        "level": persisted.level,
    }
    if persisted.elevation_custom:
        audit_details["elevation_custom"] = persisted.elevation_custom

    create_internal_audit_event(
        db_session=db_session,
        actor=user,
        action="work_progress.submitted",
        entity_type="work_progress_entry",
        entity_id=str(persisted.id),
        company_id=persisted.company_id,
        details=audit_details,
    )
    return _build_detail(db_session, persisted, [])


def upload_my_entry_file(
    db_session: Session,
    user: User,
    entry_id: uuid.UUID,
    *,
    original_filename: str,
    content_type: str,
    file_bytes: bytes,
    client_upload_id: uuid.UUID | None = None,
) -> WorkProgressEntryDetailResponse:
    del content_type  # Declared MIME is not trusted for allowlisting; magic bytes are authoritative.
    row = get_entry_by_id(db_session, entry_id)
    if row is None or row.user_id != user.id:
        raise WorkProgressNotFoundError()

    if client_upload_id is not None:
        existing = get_attachment_by_client_upload_id(db_session, row.id, client_upload_id)
        if existing is not None:
            atts = list_attachments_for_entry(db_session, row.id)
            return _build_detail(db_session, row, atts)

    if count_attachments_for_entry(db_session, row.id) >= MAX_ATTACHMENTS_PER_ENTRY:
        raise WorkProgressValidationError(
            f"Maximum number of photos reached for this entry ({MAX_ATTACHMENTS_PER_ENTRY})."
        )

    processed, original_len, img_w, img_h = _validate_and_process_new_progress_photo(file_bytes)
    del file_bytes

    rel_path = f"work-progress-files/{user.id}/{row.id}/file-{uuid.uuid4().hex}.jpg"
    _write_binary_file(rel_path, processed)
    stored_len = len(processed)
    del processed

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
        client_upload_id=client_upload_id,
        created_at=_utc_now(),
    )
    try:
        save_attachment(db_session, att)
    except Exception:
        _delete_storage_path(rel_path)
        raise

    create_internal_audit_event(
        db_session=db_session,
        actor=user,
        action="work_progress.file_uploaded",
        entity_type="work_progress_attachment",
        entity_id=str(att.id),
        company_id=row.company_id,
        details={"entry_id": str(row.id), "filename": att.original_filename},
    )

    # Thumbnails are generated lazily on first gallery/thumbnail request under the shared semaphore.

    atts = list_attachments_for_entry(db_session, row.id)
    return _build_detail(db_session, row, atts)


def resolve_file_download(
    db_session: Session,
    actor: User,
    file_id: uuid.UUID,
) -> tuple[bytes, WorkProgressAttachment, WorkProgressEntry, User]:
    att, entry, owner = resolve_attachment_access(db_session, actor, file_id)

    backend = get_storage_backend()
    if not backend.exists(att.storage_path):
        raise WorkProgressNotFoundError()
    try:
        data = backend.read_bytes(att.storage_path)
    except FileNotFoundError:
        raise WorkProgressNotFoundError() from None
    return data, att, entry, owner


def resolve_attachment_access(
    db_session: Session,
    actor: User,
    file_id: uuid.UUID,
) -> tuple[WorkProgressAttachment, WorkProgressEntry, User]:
    """Authorize attachment access without reading storage body."""
    att = get_attachment_by_id(db_session, file_id)
    if att is None:
        raise WorkProgressNotFoundError()
    entry = get_entry_by_id(db_session, att.entry_id)
    if entry is None:
        raise WorkProgressNotFoundError()
    owner = get_user_by_id(db_session, entry.user_id)
    if owner is None:
        raise WorkProgressNotFoundError()

    if actor.id != owner.id and not _actor_can_access_work_progress_entry(actor, entry, owner):
        raise WorkProgressPermissionError()
    return att, entry, owner


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


def download_work_progress_thumbnail(
    db_session: Session,
    actor: User,
    file_id: uuid.UUID,
) -> bytes:
    """Protected thumbnail bytes. No file-download audit event."""
    from app.modules.work_progress.thumbnail import ThumbnailProcessingError, ensure_thumbnail_bytes

    try:
        att, entry, _owner = resolve_attachment_access(db_session, actor, file_id)
    except WorkProgressPermissionError:
        raise WorkProgressNotFoundError() from None

    media = work_progress_attachment_response_media_type(att)
    if not media.lower().startswith("image/"):
        raise WorkProgressNotFoundError()

    try:
        return ensure_thumbnail_bytes(
            attachment=att,
            max_source_bytes=MAX_STORED_JPEG_BYTES,
            company_id=entry.company_id,
        )
    except FileNotFoundError as exc:
        raise WorkProgressNotFoundError() from exc
    except ThumbnailProcessingError as exc:
        raise WorkProgressNotFoundError() from exc


def _assert_review_access(db_session: Session, actor: User, entry_id: uuid.UUID) -> tuple[WorkProgressEntry, User]:
    pair = get_entry_with_owner(db_session, entry_id)
    if pair is None:
        raise WorkProgressNotFoundError()
    entry, owner = pair
    if not _actor_can_manage_company_work_progress(actor, entry):
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
    include_archived: bool,
    date_from: date | None,
    date_to: date | None,
    title_search: str | None,
    limit: int,
    offset: int,
    work_category: str | None = None,
    elevation: str | None = None,
    level: int | None = None,
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
    category, elev, lvl = _normalize_review_classification_filters(
        work_category=work_category,
        elevation=elevation,
        level=level,
    )

    rows, total = list_review_entries(
        db_session,
        company_id_filter=company_filter,
        user_id_filter=user_id,
        location_id_filter=location_id,
        status_filter=status_f,
        include_archived=include_archived,
        date_from=d_from,
        date_to=d_to,
        title_search=title_search,
        limit=limit,
        offset=offset,
        work_category=category,
        elevation=elev,
        level=lvl,
    )

    attachment_counts = count_attachments_for_entry_ids(db_session, [row.id for row in rows])
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
                attachment_count=attachment_counts.get(row.id, 0),
                created_at=row.created_at,
                **_classification_fields(row),
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
    include_archived: bool,
    entry_id: uuid.UUID | None,
    date_from: date | None,
    date_to: date | None,
    title_search: str | None,
    limit: int,
    offset: int,
    work_category: str | None = None,
    elevation: str | None = None,
    level: int | None = None,
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
    category, elev, lvl = _normalize_review_classification_filters(
        work_category=work_category,
        elevation=elevation,
        level=level,
    )

    if entry_id is not None:
        try:
            entry, _owner = _assert_review_access(db_session, actor, entry_id)
        except WorkProgressPermissionError:
            raise WorkProgressNotFoundError() from None
        if company_filter is not None and entry.company_id != company_filter:
            raise WorkProgressNotFoundError()

    total = count_review_attachments(
        db_session,
        company_id_filter=company_filter,
        user_id_filter=uid,
        location_id_filter=loc_id,
        status_filter=status_f,
        include_archived=include_archived,
        entry_id_filter=entry_id,
        date_from=d_from,
        date_to=d_to,
        title_search=title_search,
        work_category=category,
        elevation=elev,
        level=lvl,
    )
    page = list_review_attachments_page(
        db_session,
        company_id_filter=company_filter,
        user_id_filter=uid,
        location_id_filter=loc_id,
        status_filter=status_f,
        include_archived=include_archived,
        entry_id_filter=entry_id,
        date_from=d_from,
        date_to=d_to,
        title_search=title_search,
        limit=limit,
        offset=offset,
        work_category=category,
        elevation=elev,
        level=lvl,
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
    *,
    require_all: bool = True,
) -> list[tuple[WorkProgressAttachment, WorkProgressEntry]]:
    unique_ids = list(dict.fromkeys(file_ids))
    want = set(unique_ids)
    rows = list_attachments_by_ids_with_entries(db_session, list(want))
    found = {att.id for att, _ in rows}
    if require_all and (found != want or len(rows) != len(want)):
        raise WorkProgressNotFoundError()
    by_id = {att.id: (att, ent) for att, ent in rows}
    return [by_id[fid] for fid in unique_ids if fid in by_id]


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
        if not _actor_can_manage_company_work_progress(actor, entry):
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

    unique_ids = list(dict.fromkeys(file_ids))
    if len(unique_ids) > MAX_ZIP_ATTACHMENT_IDS:
        raise WorkProgressZipLimitError(
            code="work_progress_zip_too_many_files",
            message="ZIP download is limited to 48 pictures. Reduce the selection or delete in bulk instead.",
            http_status=400,
            extra={"max_files": MAX_ZIP_ATTACHMENT_IDS},
        )

    ordered = _ordered_bulk_attachment_rows(db_session, unique_ids)
    triples = _assert_bulk_attachment_scope(db_session, actor, ordered)

    backend = get_storage_backend()
    sizes: list[int] = []
    for att, _entry, _owner in triples:
        try:
            sizes.append(backend.object_byte_size(att.storage_path))
        except FileNotFoundError as exc:
            raise WorkProgressNotFoundError() from exc
    total_size = sum(sizes)
    if total_size > MAX_ZIP_TOTAL_BYTES:
        raise WorkProgressZipLimitError(
            code="work_progress_zip_too_large",
            message="Selected pictures exceed the 64 MB ZIP limit. Select fewer pictures and try again.",
            http_status=413,
            extra={"max_total_bytes": MAX_ZIP_TOTAL_BYTES},
        )

    from app.modules.work_progress.zip_export import build_work_progress_zip_arcname

    _ZIP_GENERATION_SEMAPHORE.acquire()
    try:
        actual_total = 0
        used_arcnames: set[str] = set()
        with io.BytesIO() as buf:
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                for att, entry, owner in triples:
                    if not backend.exists(att.storage_path):
                        raise WorkProgressNotFoundError()
                    try:
                        raw = backend.read_bytes(att.storage_path)
                    except FileNotFoundError:
                        raise WorkProgressNotFoundError() from None
                    actual_total += len(raw)
                    if actual_total > MAX_ZIP_TOTAL_BYTES:
                        raise WorkProgressZipLimitError(
                            code="work_progress_zip_too_large",
                            message="Selected pictures exceed the 64 MB ZIP limit. Select fewer pictures and try again.",
                            http_status=413,
                            extra={"max_total_bytes": MAX_ZIP_TOTAL_BYTES},
                        )
                    profile = get_employee_profile_by_user_id(db_session, entry.user_id)
                    arcname = build_work_progress_zip_arcname(
                        site_name=_location_name(db_session, entry.location_id),
                        work_category=getattr(entry, "work_category", None),
                        elevation=getattr(entry, "elevation", None),
                        elevation_custom=getattr(entry, "elevation_custom", None),
                        level=getattr(entry, "level", None),
                        legacy_title=getattr(entry, "title", None),
                        employee_name=_display_name(profile),
                        employee_email=owner.email if owner else None,
                        work_date=entry.work_date,
                        original_filename=att.original_filename,
                        used_arcnames=used_arcnames,
                    )
                    # ZIP-slip final guard: refuse absolute / parent paths.
                    if ".." in PurePosixPath(arcname).parts or PurePosixPath(arcname).is_absolute():
                        raise WorkProgressValidationError("Unsafe ZIP member path blocked.")
                    zf.writestr(arcname, raw)
                    del raw
            zip_bytes = buf.getvalue()
    finally:
        _ZIP_GENERATION_SEMAPHORE.release()

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
    return zip_bytes


def _delete_storage_key_counted(backend, relative_path: str) -> str:
    """Return 'ok', 'missing', or 'failed'."""
    try:
        if not backend.exists(relative_path):
            return "missing"
        backend.delete_file(relative_path)
        return "ok"
    except Exception:
        return "failed"


def bulk_delete_review_attachments(
    db_session: Session,
    actor: User,
    file_ids: list[uuid.UUID],
) -> dict[str, object]:
    import logging

    from app.modules.work_progress.thumbnail import safe_storage_key_hash, thumb_storage_key

    logger = logging.getLogger(__name__)

    if actor.system_role not in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        raise WorkProgressPermissionError()

    unique_ids = list(dict.fromkeys(file_ids))
    if len(unique_ids) > MAX_BULK_ATTACHMENT_IDS:
        raise WorkProgressValidationError(
            f"Bulk deletion is limited to {MAX_BULK_ATTACHMENT_IDS} pictures."
        )

    # Missing/stale attachment IDs are treated as already deleted (idempotent retry).
    ordered = _ordered_bulk_attachment_rows(db_session, unique_ids, require_all=False)
    if not ordered:
        return {
            "deleted_count": 0,
            "storage_cleanup_ok": 0,
            "storage_cleanup_failed": 0,
            "warning": None,
        }
    triples = _assert_bulk_attachment_scope(db_session, actor, ordered)

    attachments = [att for att, _, _ in triples]
    paths = [(att.id, att.storage_path, entry.company_id) for att, entry, _ in triples]

    # Stage deletes + audit, then one commit before any storage mutation.
    for att in attachments:
        db_session.delete(att)

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

    backend = get_storage_backend()
    cleanup_ok = 0
    cleanup_failed = 0
    for att_id, storage_path, company_id in paths:
        original_result = _delete_storage_key_counted(backend, storage_path)
        thumb_result = _delete_storage_key_counted(backend, thumb_storage_key(storage_path))

        attachment_failed = original_result == "failed" or thumb_result == "failed"
        if original_result == "failed":
            logger.error(
                "work_progress.storage_cleanup_failed kind=original attachment_id=%s company_id=%s backend=%s key_hash=%s",
                att_id,
                company_id,
                backend.get_backend_name(),
                safe_storage_key_hash(storage_path),
            )

        if thumb_result == "failed":
            logger.error(
                "work_progress.storage_cleanup_failed kind=thumbnail attachment_id=%s company_id=%s backend=%s key_hash=%s",
                att_id,
                company_id,
                backend.get_backend_name(),
                safe_storage_key_hash(storage_path),
            )
        if attachment_failed:
            cleanup_failed += 1
        else:
            cleanup_ok += 1

    warning = None
    if cleanup_failed > 0:
        warning = (
            "Some files could not be removed from storage. Database records were deleted. "
            "Support has been notified via logs."
        )

    return {
        "deleted_count": len(attachments),
        "storage_cleanup_ok": cleanup_ok,
        "storage_cleanup_failed": cleanup_failed,
        "warning": warning,
    }


def archive_review_entry(
    db_session: Session,
    actor: User,
    entry_id: uuid.UUID,
) -> None:
    if actor.system_role not in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        raise WorkProgressPermissionError()
    try:
        entry, owner = _assert_review_access(db_session, actor, entry_id)
    except WorkProgressPermissionError:
        raise WorkProgressNotFoundError() from None

    if entry.status == STATUS_ARCHIVED:
        return
    previous_status = entry.status
    entry.status = STATUS_ARCHIVED
    save_entry(db_session, entry)

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="work_progress.archived",
        entity_type="work_progress_entry",
        entity_id=str(entry.id),
        company_id=entry.company_id,
        details={
            "owner_user_id": str(owner.id),
            "previous_status": previous_status,
        },
    )


_PERMANENT_DELETE_STORAGE_WARNING = (
    "The submission was deleted, but some stored files could not be removed. "
    "Support has been notified via logs."
)


def permanently_delete_review_entry(
    db_session: Session,
    actor: User,
    entry_id: uuid.UUID,
) -> dict[str, object]:
    """Permanently delete a submission + attachments; clean storage only after one commit."""
    import logging

    from app.modules.work_progress.thumbnail import safe_storage_key_hash, thumb_storage_key

    logger = logging.getLogger(__name__)

    if actor.system_role not in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        raise WorkProgressPermissionError()
    try:
        entry, owner = _assert_review_access(db_session, actor, entry_id)
    except WorkProgressPermissionError:
        raise WorkProgressNotFoundError() from None

    attachments = list_attachments_for_entry(db_session, entry.id)
    for att in attachments:
        if att.entry_id != entry.id:
            raise WorkProgressValidationError("Attachment relationship validation failed.")

    cleanup_snapshot = [(att.id, att.storage_path, entry.company_id) for att in attachments]
    deleted_submission_id = entry.id
    deleted_attachment_count = len(attachments)
    previous_status = entry.status
    work_date_iso = entry.work_date.isoformat()
    title_short = truncate_plain_text(entry.title, 80)
    owner_user_id = owner.id
    company_id = entry.company_id
    audit_company_id = (
        company_id if actor.system_role == SystemRole.ADMINISTRATOR else actor.company_id
    )

    try:
        for att in attachments:
            db_session.delete(att)
        db_session.delete(entry)
        db_session.add(
            AuditEvent(
                actor_user_id=actor.id,
                company_id=audit_company_id,
                action="work_progress.submission_permanently_deleted",
                entity_type="work_progress_entry",
                entity_id=str(deleted_submission_id),
                details={
                    "owner_user_id": str(owner_user_id),
                    "work_date": work_date_iso,
                    "previous_status": previous_status,
                    "attachment_count": deleted_attachment_count,
                    "title": title_short,
                },
            )
        )
        db_session.commit()
    except Exception:
        db_session.rollback()
        raise

    backend = get_storage_backend()
    cleanup_ok = 0
    cleanup_failed = 0
    for att_id, storage_path, att_company_id in cleanup_snapshot:
        original_result = _delete_storage_key_counted(backend, storage_path)
        thumb_result = _delete_storage_key_counted(backend, thumb_storage_key(storage_path))
        attachment_failed = original_result == "failed" or thumb_result == "failed"
        if original_result == "failed":
            logger.error(
                "work_progress.storage_cleanup_failed kind=original attachment_id=%s company_id=%s backend=%s key_hash=%s",
                att_id,
                att_company_id,
                backend.get_backend_name(),
                safe_storage_key_hash(storage_path),
            )
        if thumb_result == "failed":
            logger.error(
                "work_progress.storage_cleanup_failed kind=thumbnail attachment_id=%s company_id=%s backend=%s key_hash=%s",
                att_id,
                att_company_id,
                backend.get_backend_name(),
                safe_storage_key_hash(storage_path),
            )
        if attachment_failed:
            cleanup_failed += 1
        else:
            cleanup_ok += 1

    warning = _PERMANENT_DELETE_STORAGE_WARNING if cleanup_failed > 0 else None
    return {
        "deleted_submission_id": deleted_submission_id,
        "deleted_attachment_count": deleted_attachment_count,
        "storage_cleanup_ok": cleanup_ok,
        "storage_cleanup_failed": cleanup_failed,
        "warning": warning,
    }


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


def export_review_entries_csv(
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
    work_category: str | None = None,
    elevation: str | None = None,
    level: int | None = None,
) -> tuple[str, str]:
    if actor.system_role not in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        raise WorkProgressPermissionError("You do not have permission to export work progress reviews.")

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
    category, elev, lvl = _normalize_review_classification_filters(
        work_category=work_category,
        elevation=elevation,
        level=level,
    )
    entries = list_review_entries_for_export(
        db_session,
        company_id_filter=company_filter,
        user_id_filter=uid,
        location_id_filter=loc_id,
        status_filter=status_f,
        date_from=d_from,
        date_to=d_to,
        title_search=title_search,
        work_category=category,
        elevation=elev,
        level=lvl,
    )
    entry_ids = [e.id for e in entries]
    att_counts = count_attachments_for_entry_ids(db_session, entry_ids)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "work_date",
            "employee_name",
            "employee_email",
            "company_name",
            "location_name",
            "title",
            "progress_status",
            "percent_complete",
            "entry_status",
            "notes_excerpt",
            "attachment_count",
            "reviewed_at",
            "reviewer_email",
            "review_note_excerpt",
        ],
    )
    for entry in entries:
        owner = get_user_by_id(db_session, entry.user_id)
        profile = get_employee_profile_by_user_id(db_session, entry.user_id)
        company = get_company_by_id(db_session, entry.company_id)
        reviewer = get_user_by_id(db_session, entry.reviewed_by_user_id) if entry.reviewed_by_user_id else None
        writer.writerow(
            [
                str(entry.work_date),
                _display_name(profile),
                owner.email if owner else "",
                company.name if company else "",
                _location_name(db_session, entry.location_id),
                entry.title,
                entry.progress_status,
                entry.percent_complete if entry.percent_complete is not None else "",
                entry.status,
                truncate_plain_text(entry.notes, 240),
                att_counts.get(entry.id, 0),
                entry.reviewed_at.isoformat() if entry.reviewed_at else "",
                reviewer.email if reviewer else "",
                truncate_plain_text(entry.review_note, 240),
            ],
        )

    audit_company = company_filter or (entries[0].company_id if entries else actor.company_id)
    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="work_progress.report_exported",
        entity_type="work_progress_review_export",
        entity_id=None,
        company_id=audit_company,
        details={
            "export_type": "review_csv",
            "row_count": len(entries),
            "filters": {
                "has_company_filter": company_filter is not None,
                "has_user_filter": uid is not None,
                "has_location_filter": loc_id is not None,
                "has_status_filter": status_f is not None,
                "has_date_from": d_from is not None,
                "has_date_to": d_to is not None,
                "has_title_search": bool(title_search and title_search.strip()),
            },
        },
    )
    fname = safe_export_filename("work-progress-review", str(audit_company or "export")) + ".csv"
    return buf.getvalue(), fname


def list_employee_filter_options(
    db_session: Session,
    actor: User,
    *,
    company_id: uuid.UUID | None,
) -> list[dict[str, object]]:
    """Company-scoped employees (incl. inactive) for the review employee filter."""
    from app.core.company_scope import CompanyScopeError, resolve_operational_company_id
    from app.modules.auth.repository import list_users_visible_to_user_with_profile_names

    if actor.system_role not in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        raise WorkProgressPermissionError()

    try:
        scoped = resolve_operational_company_id(db_session, actor, company_id)
    except CompanyScopeError as exc:
        raise WorkProgressPermissionError(str(exc)) from exc

    filter_company_id = scoped if actor.system_role == SystemRole.ADMINISTRATOR else None
    rows = list_users_visible_to_user_with_profile_names(
        db_session,
        actor,
        company_id=filter_company_id,
    )
    items: list[dict[str, object]] = []
    for user, first_name, last_name, _job, *_rest in rows:
        if user.system_role != SystemRole.EMPLOYEE:
            continue
        if actor.system_role == SystemRole.ADMINISTRATOR and user.company_id != scoped:
            continue
        if actor.system_role == SystemRole.ADMIN and user.company_id != actor.company_id:
            continue
        # Reuse table display-name logic via a tiny profile-like namespace.
        from types import SimpleNamespace

        profile = SimpleNamespace(first_name=first_name, last_name=last_name)
        items.append(
            {
                "user_id": user.id,
                "display_name": _display_name(profile),
                "email": user.email,
                "is_active": bool(user.is_active),
            }
        )
    items.sort(
        key=lambda row: (
            (str(row["display_name"] or "") or str(row["email"])).lower(),
            str(row["email"]).lower(),
        )
    )
    return items
