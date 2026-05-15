"""Face check status values exposed to API and UI."""

from __future__ import annotations

FACE_CHECK_NOT_ENROLLED = "not_enrolled"
FACE_CHECK_NOT_CHECKED = "not_checked"
FACE_CHECK_UNAVAILABLE = "unavailable"
FACE_CHECK_PASSED = "passed"
FACE_CHECK_NEEDS_REVIEW = "needs_review"

REASON_NO_REFERENCE = "no_reference"
REASON_NO_SELFIE = "no_selfie"
REASON_NO_FACE_DETECTED = "no_face_detected"
REASON_MULTIPLE_FACES_DETECTED = "multiple_faces_detected"
REASON_IMAGE_DECODE_FAILED = "image_decode_failed"
REASON_MATCHING_ENGINE_NOT_CONFIGURED = "matching_engine_not_configured"
REASON_MATCHING_ENGINE_ERROR = "matching_engine_error"

# Legacy foundation reason (kept for backwards compatibility in stored rows).
MATCHING_ENGINE_NOT_ENABLED_REASON = "matching_engine_not_enabled"
