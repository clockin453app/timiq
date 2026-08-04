"""Work Progress gallery thumbnails: 320x320 JPEG with strict memory limits."""

from __future__ import annotations

import hashlib
import io
import logging
import warnings
from typing import TYPE_CHECKING

from PIL import Image, ImageOps

from app.core.storage.factory import get_storage_backend
from app.modules.work_progress.thumbnail_sync import (
    clear_thumb_failure,
    mark_thumb_failure,
    thumb_failure_hot,
    thumb_stripe_lock,
    work_progress_image_processing_semaphore,
)

if TYPE_CHECKING:
    from app.modules.work_progress.models import WorkProgressAttachment

logger = logging.getLogger(__name__)

THUMB_LONG_EDGE = 320
THUMB_JPEG_QUALITY = 70
THUMB_SUFFIX = ".thumb-v1.jpg"
MAX_DECODED_PIXELS = 8_000_000


class ThumbnailProcessingError(Exception):
    """Thumbnail cannot be produced from the original."""


def thumb_storage_key(original_storage_path: str) -> str:
    return f"{original_storage_path}{THUMB_SUFFIX}"


def safe_storage_key_hash(storage_key: str) -> str:
    return hashlib.sha256(storage_key.encode("utf-8")).hexdigest()[:16]


def _close_image(img: Image.Image | None) -> None:
    if img is None:
        return
    try:
        img.close()
    except Exception:
        pass


def build_thumbnail_jpeg_bytes(source: bytes) -> bytes:
    """Decode, EXIF-orient, centre-crop square, resize to 320, encode JPEG q70."""
    if len(source) == 0:
        raise ThumbnailProcessingError("empty")

    img: Image.Image | None = None
    oriented: Image.Image | None = None
    cropped: Image.Image | None = None
    resized: Image.Image | None = None
    stream = io.BytesIO(source)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            try:
                img = Image.open(stream)
            except Image.DecompressionBombError as exc:
                raise ThumbnailProcessingError("decompression_bomb") from exc
            except Image.DecompressionBombWarning as exc:
                raise ThumbnailProcessingError("decompression_bomb") from exc
            except Exception as exc:
                raise ThumbnailProcessingError("corrupt") from exc

            width, height = img.size
            if width <= 0 or height <= 0:
                raise ThumbnailProcessingError("invalid_size")
            if width * height > MAX_DECODED_PIXELS:
                raise ThumbnailProcessingError("too_many_pixels")

            try:
                img.load()
            except Image.DecompressionBombError as exc:
                raise ThumbnailProcessingError("decompression_bomb") from exc
            except Image.DecompressionBombWarning as exc:
                raise ThumbnailProcessingError("decompression_bomb") from exc
            except Exception as exc:
                raise ThumbnailProcessingError("corrupt") from exc

        try:
            oriented = ImageOps.exif_transpose(img)
        except Exception as exc:
            raise ThumbnailProcessingError("orient") from exc
        if oriented is not img:
            _close_image(img)
            img = None
        else:
            # exif_transpose returned same object; keep as oriented
            oriented = img
            img = None

        ow, oh = oriented.size
        if ow * oh > MAX_DECODED_PIXELS:
            raise ThumbnailProcessingError("too_many_pixels")

        side = min(ow, oh)
        left = (ow - side) // 2
        top = (oh - side) // 2
        cropped = oriented.crop((left, top, left + side, top + side))
        if cropped is not oriented:
            _close_image(oriented)
            oriented = None
        else:
            oriented = None

        if cropped.mode not in ("RGB", "L"):
            if cropped.mode in ("RGBA", "LA"):
                bg = Image.new("RGB", cropped.size, (255, 255, 255))
                bg.paste(cropped, mask=cropped.split()[-1])
                _close_image(cropped)
                cropped = bg
            else:
                converted = cropped.convert("RGB")
                if converted is not cropped:
                    _close_image(cropped)
                cropped = converted
        elif cropped.mode == "L":
            converted = cropped.convert("RGB")
            if converted is not cropped:
                _close_image(cropped)
            cropped = converted

        resized = cropped.resize((THUMB_LONG_EDGE, THUMB_LONG_EDGE), Image.Resampling.LANCZOS)
        if resized is not cropped:
            _close_image(cropped)
            cropped = None

        with io.BytesIO() as out:
            try:
                resized.save(out, format="JPEG", quality=THUMB_JPEG_QUALITY, optimize=True, exif=b"")
            except TypeError:
                resized.save(out, format="JPEG", quality=THUMB_JPEG_QUALITY, optimize=True)
            return out.getvalue()
    finally:
        _close_image(resized)
        _close_image(cropped)
        _close_image(oriented)
        _close_image(img)
        stream.close()


def ensure_thumbnail_bytes(
    *,
    attachment: WorkProgressAttachment,
    max_source_bytes: int,
    company_id: object | None = None,
) -> bytes:
    """Return cached or newly generated thumbnail JPEG bytes. Raises ThumbnailProcessingError / FileNotFoundError."""
    backend = get_storage_backend()
    original_key = attachment.storage_path
    thumb_key = thumb_storage_key(original_key)

    if thumb_failure_hot(original_key):
        raise ThumbnailProcessingError("recent_failure")

    stripe = thumb_stripe_lock(original_key)
    with stripe:
        if backend.exists(thumb_key):
            data = backend.read_bytes(thumb_key)
            if len(data) > max_source_bytes:
                raise ThumbnailProcessingError("thumb_too_large")
            clear_thumb_failure(original_key)
            return data

        with work_progress_image_processing_semaphore():
            if backend.exists(thumb_key):
                data = backend.read_bytes(thumb_key)
                if len(data) > max_source_bytes:
                    raise ThumbnailProcessingError("thumb_too_large")
                clear_thumb_failure(original_key)
                return data

            try:
                size = backend.object_byte_size(original_key)
            except FileNotFoundError:
                mark_thumb_failure(original_key)
                raise
            if size > max_source_bytes:
                mark_thumb_failure(original_key)
                logger.warning(
                    "work_progress.thumb_source_too_large attachment_id=%s company_id=%s backend=%s key_hash=%s size=%s",
                    attachment.id,
                    company_id,
                    backend.get_backend_name(),
                    safe_storage_key_hash(original_key),
                    size,
                )
                raise ThumbnailProcessingError("source_too_large")

            try:
                source = backend.read_bytes(original_key)
            except FileNotFoundError:
                mark_thumb_failure(original_key)
                raise
            if len(source) > max_source_bytes:
                mark_thumb_failure(original_key)
                raise ThumbnailProcessingError("source_too_large")

            try:
                jpeg = build_thumbnail_jpeg_bytes(source)
            except ThumbnailProcessingError:
                mark_thumb_failure(original_key)
                logger.warning(
                    "work_progress.thumb_processing_failed attachment_id=%s company_id=%s backend=%s key_hash=%s",
                    attachment.id,
                    company_id,
                    backend.get_backend_name(),
                    safe_storage_key_hash(original_key),
                )
                raise
            finally:
                del source

            try:
                backend.write_bytes_replace(thumb_key, jpeg)
            except Exception:
                mark_thumb_failure(original_key)
                logger.warning(
                    "work_progress.thumb_write_failed attachment_id=%s company_id=%s backend=%s key_hash=%s",
                    attachment.id,
                    company_id,
                    backend.get_backend_name(),
                    safe_storage_key_hash(original_key),
                    exc_info=True,
                )
                raise ThumbnailProcessingError("write_failed") from None

            clear_thumb_failure(original_key)
            return jpeg


def generate_work_progress_thumbnail_best_effort(
    *,
    attachment_id: object,
    storage_path: str,
    max_source_bytes: int,
    company_id: object | None = None,
) -> None:
    """Best-effort generation after upload; never raises to callers that wrap it."""
    from types import SimpleNamespace

    try:
        att = SimpleNamespace(id=attachment_id, storage_path=storage_path)
        ensure_thumbnail_bytes(attachment=att, max_source_bytes=max_source_bytes, company_id=company_id)  # type: ignore[arg-type]
    except Exception:
        logger.warning(
            "work_progress.thumb_best_effort_failed attachment_id=%s company_id=%s key_hash=%s",
            attachment_id,
            company_id,
            safe_storage_key_hash(storage_path),
            exc_info=True,
        )
