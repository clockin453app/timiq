import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.storage.factory import get_storage_backend
from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id
from app.modules.face_check.engine import FaceMatchResult
from app.modules.face_check.service import apply_face_check_to_shift
from app.modules.locations.models import Location
from app.modules.locations.repository import get_location_by_id
from app.modules.time_clock.geofence import haversine_distance_meters, is_inside_geofence
from app.modules.time_clock.models import ClockSelfie, TimeShift, TimeShiftBreak
from app.modules.time_clock.permissions import can_view_shift_owner_selfies
from app.modules.time_clock.repository import (
    get_clock_selfie_and_shift_by_id,
    get_clock_selfie_for_shift_phase,
    get_open_break_for_shift,
    get_open_shift_for_user,
    has_completed_shift_for_user_on_utc_day,
    list_active_assigned_locations_for_user,
    list_breaks_for_shift,
    list_clock_selfie_review_rows,
    list_clock_selfies_with_shifts_for_user,
    save_break,
    save_clock_selfie,
    save_shift,
    update_break,
)
from app.modules.time_clock.schemas import ClockSelfieMetadataResponse, ClockSelfieReviewItemResponse

MAX_GPS_ACCURACY_METERS = 100.0
MAX_GPS_AGE_SECONDS = 120
MAX_SELFIE_BYTES = 6 * 1024 * 1024
ALLOWED_SELFIE_MEDIA_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
SELFIE_EXTENSION_BY_MEDIA = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


class TimeClockError(ValueError):
    pass


class LocationAccessError(TimeClockError):
    pass


class GeofenceValidationError(TimeClockError):
    pass


class ClockStateError(TimeClockError):
    pass


class ClockSelfieAccessDeniedError(TimeClockError):
    """Missing storage row, unauthorized viewer, or missing file (respond as 404)."""


DEFAULT_SELFIE_LIST_LIMIT = 50
MAX_SELFIE_LIST_LIMIT = 100


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_day_window(timestamp_utc: datetime) -> tuple[datetime, datetime]:
    day_start = datetime(
        year=timestamp_utc.year,
        month=timestamp_utc.month,
        day=timestamp_utc.day,
        tzinfo=timezone.utc,
    )
    return day_start, day_start + timedelta(days=1)


def _validate_gps(timestamp_utc: datetime, accuracy_meters: float) -> None:
    now = _utc_now()
    age_seconds = abs((now - timestamp_utc).total_seconds())
    if age_seconds > MAX_GPS_AGE_SECONDS:
        raise GeofenceValidationError("GPS timestamp is stale. Refresh your location and try again.")

    if accuracy_meters > MAX_GPS_ACCURACY_METERS:
        raise GeofenceValidationError("GPS accuracy is too low. Move to open sky and try again.")


def _resolve_assigned_geofenced_location(
    db_session: Session,
    actor: User,
    latitude: float,
    longitude: float,
) -> tuple[Location, float]:
    assigned_locations = list_active_assigned_locations_for_user(db_session, actor.id)
    if not assigned_locations:
        raise LocationAccessError("No active assigned locations found for this user.")

    best_match: tuple[Location, float] | None = None
    for location in assigned_locations:
        distance_meters = haversine_distance_meters(
            latitude,
            longitude,
            location.latitude,
            location.longitude,
        )
        if is_inside_geofence(distance_meters, location.geofence_radius_meters):
            if best_match is None or distance_meters < best_match[1]:
                best_match = (location, distance_meters)

    if best_match is None:
        raise GeofenceValidationError("You are outside all assigned active location geofences.")

    return best_match


def get_clock_status(db_session: Session, actor: User) -> dict:
    """Clock summary for the authenticated user; assigned_sites are RBAC-scoped to their access rows only."""
    open_shift = get_open_shift_for_user(db_session, actor.id)
    active_locations = list_active_assigned_locations_for_user(db_session, actor.id)
    current_break = (
        get_open_break_for_shift(db_session, open_shift.id) if open_shift is not None else None
    )
    assigned_sites = [
        {
            "id": loc.id,
            "name": loc.name,
            "latitude": loc.latitude,
            "longitude": loc.longitude,
            "geofence_radius_meters": loc.geofence_radius_meters,
        }
        for loc in active_locations
    ]

    now = _utc_now()
    day_start, day_end = _utc_day_window(now)
    completed_today_no_open = (
        open_shift is None
        and has_completed_shift_for_user_on_utc_day(db_session, actor.id, day_start, day_end)
    )
    active_count = len(active_locations)

    if active_count == 0:
        current_status = "no_assigned_sites"
    elif completed_today_no_open:
        current_status = "completed_today"
    elif open_shift is not None and current_break is not None:
        current_status = "open_break"
    elif open_shift is not None:
        current_status = "on_shift"
    else:
        current_status = "not_clocked_in"

    open_shift_location_id: uuid.UUID | None = None
    open_shift_location_name: str | None = None
    if open_shift is not None:
        loc_row = get_location_by_id(db_session, open_shift.location_id)
        if loc_row is not None:
            open_shift_location_id = loc_row.id
            open_shift_location_name = loc_row.name

    can_clock_in = active_count > 0 and open_shift is None and not completed_today_no_open
    can_clock_out = open_shift is not None and current_break is None

    clock_in_blocked_reason: str | None = None
    if not can_clock_in:
        if active_count == 0:
            clock_in_blocked_reason = "No active assigned locations."
        elif open_shift is not None:
            clock_in_blocked_reason = "You are already on shift."
        elif completed_today_no_open:
            clock_in_blocked_reason = "A second shift today is not allowed by current policy."

    clock_out_blocked_reason: str | None = None
    if not can_clock_out:
        if open_shift is None:
            clock_out_blocked_reason = "Clock in first to start a shift."
        elif current_break is not None:
            clock_out_blocked_reason = "End your break before clocking out."

    return {
        "has_open_shift": open_shift is not None,
        "open_shift_id": open_shift.id if open_shift is not None else None,
        "open_shift_clock_in_at": open_shift.clock_in_at if open_shift is not None else None,
        "status": "clocked_in" if open_shift is not None else "clocked_out",
        "active_location_count": active_count,
        "current_break_open": current_break is not None,
        "assigned_sites": assigned_sites,
        "current_status": current_status,
        "has_completed_shift_today": completed_today_no_open,
        "open_break_id": current_break.id if current_break is not None else None,
        "open_shift_location_id": open_shift_location_id,
        "open_shift_location_name": open_shift_location_name,
        "can_clock_in": can_clock_in,
        "can_clock_out": can_clock_out,
        "clock_in_blocked_reason": clock_in_blocked_reason,
        "clock_out_blocked_reason": clock_out_blocked_reason,
    }


def normalize_selfie_list_limit(limit: int | None) -> int:
    if limit is None or limit <= 0:
        return DEFAULT_SELFIE_LIST_LIMIT
    return min(limit, MAX_SELFIE_LIST_LIMIT)


def normalize_selfie_list_offset(offset: int | None) -> int:
    if offset is None or offset < 0:
        return 0
    return offset


def _metadata_from_selfie_and_shift(
    selfie: ClockSelfie,
    shift: TimeShift,
) -> ClockSelfieMetadataResponse:
    return ClockSelfieMetadataResponse(
        id=selfie.id,
        time_shift_id=selfie.time_shift_id,
        phase=selfie.phase,
        content_type=selfie.content_type,
        file_size_bytes=selfie.file_size_bytes,
        captured_at=selfie.captured_at,
        created_at=selfie.created_at,
        clock_in_at=shift.clock_in_at,
        clock_out_at=shift.clock_out_at,
    )


def _employee_display_name(profile: EmployeeProfile | None) -> str | None:
    if profile is None:
        return None
    first = (profile.first_name or "").strip()
    last = (profile.last_name or "").strip()
    if not first and not last:
        return None
    return f"{first} {last}".strip()


def list_clock_selfies_review_metadata(
    db_session: Session,
    actor: User,
    *,
    limit: int | None,
    offset: int | None,
) -> list[ClockSelfieReviewItemResponse]:
    """Admin review feed; caller must restrict to admin/administrator roles."""
    effective_limit = normalize_selfie_list_limit(limit)
    effective_offset = normalize_selfie_list_offset(offset)

    if actor.system_role == SystemRole.ADMIN:
        if actor.company_id is None:
            return []
        rows = list_clock_selfie_review_rows(
            db_session,
            limit=effective_limit,
            offset=effective_offset,
            managed_company_id=actor.company_id,
            restrict_to_managed_company_employees=True,
        )
    elif actor.system_role == SystemRole.ADMINISTRATOR:
        rows = list_clock_selfie_review_rows(
            db_session,
            limit=effective_limit,
            offset=effective_offset,
            managed_company_id=None,
            restrict_to_managed_company_employees=False,
        )
    else:
        return []

    items: list[ClockSelfieReviewItemResponse] = []
    for selfie, shift, owner, company, profile in rows:
        items.append(
            ClockSelfieReviewItemResponse(
                id=selfie.id,
                user_id=owner.id,
                user_email=owner.email,
                employee_name=_employee_display_name(profile),
                company_name=company.name if company is not None else None,
                phase=selfie.phase,
                captured_at=selfie.captured_at,
                clock_in_at=shift.clock_in_at,
                clock_out_at=shift.clock_out_at,
                content_type=selfie.content_type,
                file_size_bytes=selfie.file_size_bytes,
            )
        )
    return items


def authorize_selfie_subject_user(
    db_session: Session,
    actor: User,
    subject_user_id: uuid.UUID,
) -> User:
    """Resolve subject user or raise ClockSelfieAccessDeniedError."""
    subject = get_user_by_id(db_session, subject_user_id)
    if subject is None:
        raise ClockSelfieAccessDeniedError("Clock selfie subject was not found.")

    if not can_view_shift_owner_selfies(actor, subject):
        raise ClockSelfieAccessDeniedError("Clock selfie subject was not found.")

    return subject


def list_user_clock_selfies_metadata(
    db_session: Session,
    actor: User,
    subject_user_id: uuid.UUID,
    *,
    limit: int | None,
    offset: int | None,
) -> list[ClockSelfieMetadataResponse]:
    authorize_selfie_subject_user(db_session, actor, subject_user_id)
    effective_limit = normalize_selfie_list_limit(limit)
    effective_offset = normalize_selfie_list_offset(offset)
    rows = list_clock_selfies_with_shifts_for_user(
        db_session,
        subject_user_id,
        limit=effective_limit,
        offset=effective_offset,
    )
    return [_metadata_from_selfie_and_shift(selfie, shift) for selfie, shift in rows]


def resolve_clock_selfie_file_download(
    db_session: Session,
    actor: User,
    selfie_id: uuid.UUID,
) -> tuple[bytes, ClockSelfie, TimeShift, User]:
    row = get_clock_selfie_and_shift_by_id(db_session, selfie_id)
    if row is None:
        raise ClockSelfieAccessDeniedError("Clock selfie was not found.")

    selfie, shift = row
    owner = get_user_by_id(db_session, shift.user_id)
    if owner is None:
        raise ClockSelfieAccessDeniedError("Clock selfie was not found.")

    if not can_view_shift_owner_selfies(actor, owner):
        raise ClockSelfieAccessDeniedError("Clock selfie was not found.")

    storage_backend = get_storage_backend()
    if not storage_backend.exists(selfie.storage_path):
        raise ClockSelfieAccessDeniedError("Clock selfie was not found.")
    try:
        data = storage_backend.read_bytes(selfie.storage_path)
    except FileNotFoundError:
        raise ClockSelfieAccessDeniedError("Clock selfie was not found.") from None

    return data, selfie, shift, owner


def parse_timestamp_utc(value: str) -> datetime:
    cleaned = value.strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(cleaned)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _normalize_selfie_media(content_type: str, file_bytes: bytes) -> tuple[str, str]:
    if len(file_bytes) == 0:
        raise ClockStateError("Selfie image is empty.")

    if len(file_bytes) > MAX_SELFIE_BYTES:
        raise ClockStateError("Selfie image is too large.")

    media_type = (content_type or "").split(";")[0].strip().lower()
    if media_type == "application/octet-stream" and len(file_bytes) >= 3 and file_bytes[:3] == b"\xff\xd8\xff":
        media_type = "image/jpeg"
    if (
        media_type == "application/octet-stream"
        and len(file_bytes) >= 8
        and file_bytes[:8] == b"\x89PNG\r\n\x1a\n"
    ):
        media_type = "image/png"

    if media_type not in ALLOWED_SELFIE_MEDIA_TYPES:
        raise ClockStateError("Selfie must be a JPEG, PNG, or WebP image.")

    extension = SELFIE_EXTENSION_BY_MEDIA.get(media_type)
    if extension is None:
        raise ClockStateError("Selfie must be a JPEG, PNG, or WebP image.")

    return media_type, extension


def _audit_face_match_checked(
    *,
    db_session: Session,
    actor: User,
    shift: TimeShift,
    result: FaceMatchResult,
) -> None:
    details: dict[str, object] = {
        "user_id": str(actor.id),
        "shift_id": str(shift.id),
        "status": result.status,
    }
    if result.confidence is not None:
        details["confidence"] = round(result.confidence, 4)
    if result.reason:
        details["reason"] = result.reason
    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="face_match.checked",
        entity_type="time_shift",
        entity_id=str(shift.id),
        company_id=actor.company_id,
        details=details,
    )


def _write_selfie_file(
    actor_id: uuid.UUID,
    shift_id: uuid.UUID,
    phase: str,
    extension: str,
    file_bytes: bytes,
) -> str:
    storage_backend = get_storage_backend()
    relative_path = (
        f"clock-selfies/{actor_id}/{shift_id}/{phase}-{uuid.uuid4().hex}{extension}"
    )
    storage_backend.write_bytes(relative_path, file_bytes)
    return relative_path


def clock_in(
    db_session: Session,
    actor: User,
    latitude: float,
    longitude: float,
    accuracy_meters: float,
    timestamp_utc: datetime,
    selfie_content_type: str,
    selfie_bytes: bytes,
) -> TimeShift:
    _validate_gps(timestamp_utc, accuracy_meters)

    existing_open_shift = get_open_shift_for_user(db_session, actor.id)
    if existing_open_shift is not None:
        raise ClockStateError("You already have an open shift.")

    day_start, day_end = _utc_day_window(timestamp_utc)
    if has_completed_shift_for_user_on_utc_day(db_session, actor.id, day_start, day_end):
        raise ClockStateError("You already have a completed shift for this UTC day.")

    matched_location, distance_meters = _resolve_assigned_geofenced_location(
        db_session=db_session,
        actor=actor,
        latitude=latitude,
        longitude=longitude,
    )

    shift = TimeShift(
        user_id=actor.id,
        company_id=actor.company_id,
        location_id=matched_location.id,
        status="open",
        clock_source="employee",
        clock_in_at=_utc_now(),
        clock_in_latitude=latitude,
        clock_in_longitude=longitude,
        clock_in_accuracy_meters=accuracy_meters,
        clock_in_distance_to_site_meters=distance_meters,
    )

    media_type, extension = _normalize_selfie_media(selfie_content_type, selfie_bytes)
    relative_storage_path: str | None = None
    face_result: FaceMatchResult | None = None
    try:
        save_shift(db_session, shift, commit=False)
        relative_storage_path = _write_selfie_file(
            actor.id,
            shift.id,
            "clock_in",
            extension,
            selfie_bytes,
        )
        selfie_row = ClockSelfie(
            time_shift_id=shift.id,
            phase="clock_in",
            storage_path=relative_storage_path,
            content_type=media_type,
            file_size_bytes=len(selfie_bytes),
            captured_at=_utc_now(),
        )
        save_clock_selfie(db_session, selfie_row, commit=False)
        profile = get_employee_profile_by_user_id(db_session, actor.id)
        face_result = apply_face_check_to_shift(
            shift,
            profile,
            selfie_captured=True,
            selfie_bytes=selfie_bytes,
        )
        save_shift(db_session, shift, commit=False)
        db_session.commit()
    except Exception:
        db_session.rollback()
        if relative_storage_path is not None:
            get_storage_backend().delete_file(relative_storage_path)
        raise

    db_session.refresh(shift)

    if face_result is not None:
        _audit_face_match_checked(
            db_session=db_session,
            actor=actor,
            shift=shift,
            result=face_result,
        )

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="time_clock.clock_in",
        entity_type="time_shift",
        entity_id=str(shift.id),
        details={
            "location_id": str(shift.location_id),
            "distance_meters": round(distance_meters, 2),
            "selfie_phase": "clock_in",
        },
    )
    return shift


def clock_out(
    db_session: Session,
    actor: User,
    latitude: float,
    longitude: float,
    accuracy_meters: float,
    timestamp_utc: datetime,
    selfie_content_type: str,
    selfie_bytes: bytes,
) -> TimeShift:
    _validate_gps(timestamp_utc, accuracy_meters)

    open_shift = get_open_shift_for_user(db_session, actor.id)
    if open_shift is None:
        raise ClockStateError("You are not currently clocked in.")

    open_break = get_open_break_for_shift(db_session, open_shift.id)
    if open_break is not None:
        raise ClockStateError("Cannot clock out while a break is open. End your break first.")

    matched_location, distance_meters = _resolve_assigned_geofenced_location(
        db_session=db_session,
        actor=actor,
        latitude=latitude,
        longitude=longitude,
    )

    existing_selfie = get_clock_selfie_for_shift_phase(db_session, open_shift.id, "clock_out")
    if existing_selfie is not None:
        raise ClockStateError("A clock-out selfie already exists for this shift.")

    media_type, extension = _normalize_selfie_media(selfie_content_type, selfie_bytes)

    clock_out_at = _utc_now()
    open_shift.clock_out_at = clock_out_at
    open_shift.clock_out_latitude = latitude
    open_shift.clock_out_longitude = longitude
    open_shift.clock_out_accuracy_meters = accuracy_meters
    open_shift.clock_out_distance_to_site_meters = distance_meters
    open_shift.location_id = matched_location.id
    open_shift.status = "completed"

    breaks = list_breaks_for_shift(db_session, open_shift.id)
    break_seconds = 0
    for item in breaks:
        if item.ended_at is not None:
            break_seconds += int((item.ended_at - item.started_at).total_seconds())

    worked_seconds = int((clock_out_at - open_shift.clock_in_at).total_seconds()) - break_seconds
    open_shift.break_seconds = max(break_seconds, 0)
    open_shift.worked_seconds = max(worked_seconds, 0)
    relative_storage_path: str | None = None
    face_result: FaceMatchResult | None = None
    try:
        relative_storage_path = _write_selfie_file(
            actor.id,
            open_shift.id,
            "clock_out",
            extension,
            selfie_bytes,
        )
        selfie_row = ClockSelfie(
            time_shift_id=open_shift.id,
            phase="clock_out",
            storage_path=relative_storage_path,
            content_type=media_type,
            file_size_bytes=len(selfie_bytes),
            captured_at=_utc_now(),
        )
        save_clock_selfie(db_session, selfie_row, commit=False)
        profile = get_employee_profile_by_user_id(db_session, actor.id)
        face_result = apply_face_check_to_shift(
            open_shift,
            profile,
            selfie_captured=True,
            selfie_bytes=selfie_bytes,
        )
        save_shift(db_session, open_shift, commit=False)
        db_session.commit()
    except Exception:
        db_session.rollback()
        if relative_storage_path is not None:
            get_storage_backend().delete_file(relative_storage_path)
        raise

    db_session.refresh(open_shift)

    if face_result is not None:
        _audit_face_match_checked(
            db_session=db_session,
            actor=actor,
            shift=open_shift,
            result=face_result,
        )

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="time_clock.clock_out",
        entity_type="time_shift",
        entity_id=str(open_shift.id),
        details={
            "location_id": str(open_shift.location_id),
            "worked_seconds": open_shift.worked_seconds,
            "break_seconds": open_shift.break_seconds,
            "distance_meters": round(distance_meters, 2),
            "selfie_phase": "clock_out",
        },
    )
    return open_shift


def break_start(db_session: Session, actor: User) -> TimeShiftBreak:
    open_shift = get_open_shift_for_user(db_session, actor.id)
    if open_shift is None:
        raise ClockStateError("Cannot start break because you are not clocked in.")

    existing_break = get_open_break_for_shift(db_session, open_shift.id)
    if existing_break is not None:
        raise ClockStateError("A break is already in progress.")

    shift_break = TimeShiftBreak(
        time_shift_id=open_shift.id,
        started_at=_utc_now(),
    )
    saved_break = save_break(db_session, shift_break)

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="time_clock.break_start",
        entity_type="time_shift_break",
        entity_id=str(saved_break.id),
        details={"time_shift_id": str(open_shift.id)},
    )
    return saved_break


def break_end(db_session: Session, actor: User) -> TimeShiftBreak:
    open_shift = get_open_shift_for_user(db_session, actor.id)
    if open_shift is None:
        raise ClockStateError("Cannot end break because you are not clocked in.")

    existing_break = get_open_break_for_shift(db_session, open_shift.id)
    if existing_break is None:
        raise ClockStateError("No open break found.")

    existing_break.ended_at = _utc_now()
    updated_break = update_break(db_session, existing_break)

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="time_clock.break_end",
        entity_type="time_shift_break",
        entity_id=str(updated_break.id),
        details={"time_shift_id": str(open_shift.id)},
    )
    return updated_break
