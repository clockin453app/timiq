"""OpenCV Haar-cascade face crop + histogram correlation (local only, no external APIs)."""

from __future__ import annotations

import cv2
import numpy as np

from app.modules.face_check.constants import (
    FACE_CHECK_UNAVAILABLE,
    REASON_IMAGE_DECODE_FAILED,
    REASON_MULTIPLE_FACES_DETECTED,
    REASON_NO_FACE_DETECTED,
)
from app.modules.face_check.engine import FaceMatchResult, classify_confidence

_FACE_CASCADE = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml",
)
_FACE_SIZE = (128, 128)


def _decode_image(file_bytes: bytes) -> np.ndarray | None:
    buffer = np.frombuffer(file_bytes, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if image is None or image.size == 0:
        return None
    return image


def _extract_face_patch(image: np.ndarray) -> tuple[np.ndarray | None, str | None]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)
    faces = _FACE_CASCADE.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(48, 48),
    )
    if faces is None or len(faces) == 0:
        return None, REASON_NO_FACE_DETECTED

    areas = [int(w * h) for (_, _, w, h) in faces]
    order = sorted(range(len(areas)), key=lambda i: areas[i], reverse=True)
    if len(order) > 1 and areas[order[1]] >= areas[order[0]] * 0.35:
        return None, REASON_MULTIPLE_FACES_DETECTED

    idx = order[0]
    x, y, w, h = (int(faces[idx][0]), int(faces[idx][1]), int(faces[idx][2]), int(faces[idx][3]))
    crop = gray[y : y + h, x : x + w]
    if crop.size == 0:
        return None, REASON_NO_FACE_DETECTED
    return cv2.resize(crop, _FACE_SIZE, interpolation=cv2.INTER_AREA), None


def _histogram_correlation(a: np.ndarray, b: np.ndarray) -> float:
    hist_a = cv2.calcHist([a], [0], None, [64], [0, 256])
    hist_b = cv2.calcHist([b], [0], None, [64], [0, 256])
    cv2.normalize(hist_a, hist_a)
    cv2.normalize(hist_b, hist_b)
    score = float(cv2.compareHist(hist_a, hist_b, cv2.HISTCMP_CORREL))
    return max(0.0, min(1.0, score))


def compare_faces(reference_bytes: bytes, selfie_bytes: bytes, threshold: float) -> FaceMatchResult:
    reference_img = _decode_image(reference_bytes)
    selfie_img = _decode_image(selfie_bytes)
    if reference_img is None or selfie_img is None:
        return FaceMatchResult(
            status=FACE_CHECK_UNAVAILABLE,
            confidence=None,
            reason=REASON_IMAGE_DECODE_FAILED,
        )

    ref_patch, ref_reason = _extract_face_patch(reference_img)
    if ref_patch is None:
        return FaceMatchResult(
            status=FACE_CHECK_UNAVAILABLE,
            confidence=None,
            reason=ref_reason or REASON_NO_FACE_DETECTED,
        )

    selfie_patch, selfie_reason = _extract_face_patch(selfie_img)
    if selfie_patch is None:
        return FaceMatchResult(
            status=FACE_CHECK_UNAVAILABLE,
            confidence=None,
            reason=selfie_reason or REASON_NO_FACE_DETECTED,
        )

    confidence = _histogram_correlation(ref_patch, selfie_patch)
    return classify_confidence(confidence, threshold)
