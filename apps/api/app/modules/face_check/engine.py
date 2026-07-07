"""Pluggable face match engine (server-side, no external biometric APIs)."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import settings
from app.modules.face_check.constants import (
    FACE_CHECK_NEEDS_REVIEW,
    FACE_CHECK_PASSED,
    FACE_CHECK_UNAVAILABLE,
    REASON_IMAGE_DECODE_FAILED,
    REASON_MATCHING_ENGINE_ERROR,
    REASON_MATCHING_ENGINE_NOT_CONFIGURED,
    REASON_MULTIPLE_FACES_DETECTED,
    REASON_NO_FACE_DETECTED,
    REASON_NO_SELFIE,
)


@dataclass(frozen=True)
class FaceMatchResult:
    """Outcome of comparing a reference image to a clock selfie."""

    status: str
    confidence: float | None = None
    reason: str | None = None


def face_check_match_threshold() -> float:
    return max(0.30, min(0.95, float(settings.face_check_match_threshold)))


def compare_reference_to_selfie(reference_bytes: bytes, selfie_bytes: bytes) -> FaceMatchResult:
    if not selfie_bytes:
        return FaceMatchResult(
            status=FACE_CHECK_UNAVAILABLE,
            confidence=None,
            reason=REASON_NO_SELFIE,
        )
    if not reference_bytes:
        return FaceMatchResult(
            status=FACE_CHECK_UNAVAILABLE,
            confidence=None,
            reason=REASON_IMAGE_DECODE_FAILED,
        )

    try:
        import cv2  # noqa: F401
    except ImportError:
        return FaceMatchResult(
            status=FACE_CHECK_UNAVAILABLE,
            confidence=None,
            reason=REASON_MATCHING_ENGINE_NOT_CONFIGURED,
        )

    from app.modules.face_check.opencv_matcher import compare_faces

    try:
        return compare_faces(reference_bytes, selfie_bytes, face_check_match_threshold())
    except Exception:
        return FaceMatchResult(
            status=FACE_CHECK_UNAVAILABLE,
            confidence=None,
            reason=REASON_MATCHING_ENGINE_ERROR,
        )


def classify_confidence(confidence: float, threshold: float) -> FaceMatchResult:
    if confidence >= threshold:
        return FaceMatchResult(status=FACE_CHECK_PASSED, confidence=confidence, reason=None)
    return FaceMatchResult(status=FACE_CHECK_NEEDS_REVIEW, confidence=confidence, reason=None)
