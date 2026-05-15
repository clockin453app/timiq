"""Employee face reference enrolment (private storage, no matching engine)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.storage.factory import get_storage_backend
from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.limited_access import has_limited_access
from app.modules.auth.models import User
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.employee_profiles.repository import (
    get_employee_profile_by_user_id,
    update_employee_profile,
)
from app.modules.employee_profiles.service import get_or_create_profile_for_user
from app.modules.face_check.image_validation import (
    FaceImageValidationError,
    normalize_face_image,
)
from app.modules.face_check.service import face_reference_configured


class FaceReferenceError(ValueError):
    pass


class FaceReferencePermissionError(FaceReferenceError):
    pass


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _assert_can_manage_face_reference(actor: User) -> None:
    if not actor.is_active:
        raise FaceReferencePermissionError("Your account is deactivated.")
    if has_limited_access(actor):
        raise FaceReferencePermissionError(
            "Face reference enrolment is not available for deactivated accounts.",
        )


def _delete_storage_file(relative_path: str | None) -> None:
    if not relative_path or not relative_path.strip():
        return
    try:
        get_storage_backend().delete_file(relative_path.strip())
    except OSError:
        pass


def _write_reference_file(actor_id: uuid.UUID, extension: str, file_bytes: bytes) -> str:
    relative_path = f"face-references/{actor_id}/{uuid.uuid4().hex}{extension}"
    get_storage_backend().write_bytes(relative_path, file_bytes)
    return relative_path


def enroll_face_reference(
    db_session: Session,
    actor: User,
    *,
    consent: bool,
    content_type: str,
    file_bytes: bytes,
) -> EmployeeProfile:
    _assert_can_manage_face_reference(actor)
    if not consent:
        raise FaceReferenceError("Consent is required to enrol a face reference photo.")

    _media_type, extension = normalize_face_image(content_type, file_bytes)
    profile = get_or_create_profile_for_user(db_session, actor)
    now = _utc_now()
    was_configured = face_reference_configured(profile)
    previous_path = profile.face_reference_storage_path

    new_path = _write_reference_file(actor.id, extension, file_bytes)
    try:
        profile.face_check_consent_at = now
        profile.face_reference_storage_path = new_path
        if profile.face_reference_enrolled_at is None:
            profile.face_reference_enrolled_at = now
        profile.face_reference_updated_at = now
        update_employee_profile(db_session, profile)
        if previous_path and previous_path != new_path:
            _delete_storage_file(previous_path)
    except Exception:
        _delete_storage_file(new_path)
        raise

    create_internal_audit_event(
        db_session,
        actor,
        action="face_reference.updated" if was_configured else "face_reference.enrolled",
        entity_type="employee_profile",
        entity_id=str(profile.id),
        company_id=actor.company_id,
        details={
            "actor_user_id": str(actor.id),
            "user_id": str(actor.id),
            "configured": True,
        },
    )
    return profile


def remove_face_reference(db_session: Session, actor: User) -> EmployeeProfile:
    _assert_can_manage_face_reference(actor)
    profile = get_employee_profile_by_user_id(db_session, actor.id)
    if profile is None:
        profile = get_or_create_profile_for_user(db_session, actor)

    previous_path = profile.face_reference_storage_path
    profile.face_check_consent_at = None
    profile.face_reference_storage_path = None
    profile.face_reference_enrolled_at = None
    profile.face_reference_updated_at = _utc_now()
    update_employee_profile(db_session, profile)
    _delete_storage_file(previous_path)

    create_internal_audit_event(
        db_session,
        actor,
        action="face_reference.removed",
        entity_type="employee_profile",
        entity_id=str(profile.id),
        company_id=actor.company_id,
        details={
            "actor_user_id": str(actor.id),
            "user_id": str(actor.id),
            "configured": False,
        },
    )
    return profile
