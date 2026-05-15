"""Validate reference/clock selfie uploads (no recognition)."""

from __future__ import annotations

MAX_FACE_IMAGE_BYTES = 6 * 1024 * 1024
ALLOWED_FACE_IMAGE_MEDIA_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
EXTENSION_BY_MEDIA = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


class FaceImageValidationError(ValueError):
    pass


def normalize_face_image(content_type: str, file_bytes: bytes) -> tuple[str, str]:
    if not file_bytes:
        raise FaceImageValidationError("Image file is empty.")
    if len(file_bytes) > MAX_FACE_IMAGE_BYTES:
        raise FaceImageValidationError("Image file is too large.")

    media_type = (content_type or "").split(";")[0].strip().lower()
    if media_type not in ALLOWED_FACE_IMAGE_MEDIA_TYPES:
        raise FaceImageValidationError("Image must be JPEG, PNG, or WebP.")

    extension = EXTENSION_BY_MEDIA.get(media_type)
    if extension is None:
        raise FaceImageValidationError("Unsupported image type.")

    return media_type, extension
