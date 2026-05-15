"""Face check: enrolment rules and shift status from reference vs selfie match."""

from __future__ import annotations

from app.core.storage.factory import get_storage_backend
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.face_check.constants import FACE_CHECK_NOT_ENROLLED
from app.modules.face_check.engine import FaceMatchResult, compare_reference_to_selfie
from app.modules.time_clock.models import TimeShift


def face_reference_configured(profile: EmployeeProfile | None) -> bool:
    if profile is None:
        return False
    if profile.face_check_consent_at is None:
        return False
    return bool((profile.face_reference_storage_path or "").strip())


def _read_storage_bytes(relative_path: str | None) -> bytes | None:
    key = (relative_path or "").strip()
    if not key:
        return None
    try:
        return get_storage_backend().read_bytes(key)
    except OSError:
        return None


def apply_face_check_to_shift(
    shift: TimeShift,
    profile: EmployeeProfile | None,
    *,
    selfie_captured: bool,
    selfie_bytes: bytes | None = None,
) -> FaceMatchResult | None:
    if not selfie_captured:
        shift.face_check_status = None
        shift.face_match_confidence = None
        shift.face_check_reason = None
        return None

    if not face_reference_configured(profile):
        shift.face_check_status = FACE_CHECK_NOT_ENROLLED
        shift.face_match_confidence = None
        shift.face_check_reason = None
        return FaceMatchResult(status=FACE_CHECK_NOT_ENROLLED, confidence=None, reason=None)

    assert profile is not None
    reference_bytes = _read_storage_bytes(profile.face_reference_storage_path)
    result = compare_reference_to_selfie(reference_bytes or b"", selfie_bytes or b"")
    shift.face_check_status = result.status
    shift.face_match_confidence = result.confidence
    shift.face_check_reason = result.reason
    return result


def face_check_fields_for_shift(shift: TimeShift) -> dict[str, str | float | None]:
    return {
        "face_check_status": shift.face_check_status,
        "face_match_confidence": shift.face_match_confidence,
        "face_check_reason": shift.face_check_reason,
    }
