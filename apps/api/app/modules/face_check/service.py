"""Face check foundation rules (no matching engine)."""

from __future__ import annotations

from datetime import datetime, timezone

from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.face_check.constants import (
    FACE_CHECK_NOT_ENROLLED,
    FACE_CHECK_UNAVAILABLE,
    MATCHING_ENGINE_NOT_ENABLED_REASON,
)
from app.modules.time_clock.models import TimeShift


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def face_reference_configured(profile: EmployeeProfile | None) -> bool:
    if profile is None:
        return False
    if profile.face_check_consent_at is None:
        return False
    return bool((profile.face_reference_storage_path or "").strip())


def apply_face_check_to_shift(
    shift: TimeShift,
    profile: EmployeeProfile | None,
    *,
    selfie_captured: bool,
) -> None:
    if not selfie_captured:
        shift.face_check_status = None
        shift.face_match_confidence = None
        shift.face_check_reason = None
        return

    if not face_reference_configured(profile):
        shift.face_check_status = FACE_CHECK_NOT_ENROLLED
        shift.face_match_confidence = None
        shift.face_check_reason = None
        return

    shift.face_check_status = FACE_CHECK_UNAVAILABLE
    shift.face_match_confidence = None
    shift.face_check_reason = MATCHING_ENGINE_NOT_ENABLED_REASON


def face_check_fields_for_shift(shift: TimeShift) -> dict[str, str | float | None]:
    return {
        "face_check_status": shift.face_check_status,
        "face_match_confidence": shift.face_match_confidence,
        "face_check_reason": shift.face_check_reason,
    }
