"""Detect image types by magic bytes and optimise site progress photos for storage."""

from __future__ import annotations

import io
import warnings
from typing import Literal

from PIL import Image, ImageOps

FileKind = Literal["jpeg", "png", "webp", "pdf"]

MAX_LONG_EDGE = 1600
JPEG_QUALITY = 82
PROCESSING_VERSION = "2"
# 12 MP keeps a single RGB decode under ~36 MB — safe with one-at-a-time processing on 512 MB Render.
MAX_DECODED_PIXELS = 12_000_000
MAX_IMAGE_DIMENSION = 8192


class ImageProcessingError(Exception):
    """Image cannot be processed safely."""


def detect_magic_file_kind(data: bytes) -> FileKind | None:
    """Identify file kind from leading bytes only (not extension or declared MIME)."""
    if len(data) >= 4 and data[:4] == b"%PDF":
        return "pdf"
    if len(data) >= 3 and data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def _close_image(img: Image.Image | None) -> None:
    if img is None:
        return
    try:
        img.close()
    except Exception:
        pass


def _flatten_to_rgb(img: Image.Image) -> Image.Image:
    if img.mode in ("RGBA", "LA"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        _close_image(img)
        return bg
    if img.mode == "P":
        if "transparency" in img.info:
            rgba = img.convert("RGBA")
            _close_image(img)
            bg = Image.new("RGB", rgba.size, (255, 255, 255))
            bg.paste(rgba, mask=rgba.split()[3])
            _close_image(rgba)
            return bg
        converted = img.convert("RGB")
        if converted is not img:
            _close_image(img)
        return converted
    if img.mode != "RGB":
        converted = img.convert("RGB")
        if converted is not img:
            _close_image(img)
        return converted
    return img


def _validate_header_dimensions(width: int, height: int) -> None:
    if width <= 0 or height <= 0:
        raise ImageProcessingError("invalid_size")
    if max(width, height) > MAX_IMAGE_DIMENSION:
        raise ImageProcessingError("dimension_too_large")
    if width * height > MAX_DECODED_PIXELS:
        raise ImageProcessingError("too_many_pixels")


def process_site_progress_photo(file_bytes: bytes) -> tuple[bytes, int, int]:
    """
    Auto-orient (EXIF), resize longest edge to max 1600px, convert to JPEG (q≈82),
    strip metadata, flatten transparency onto white. Returns (jpeg_bytes, width, height).
  Caller must hold the shared work-progress image-processing semaphore.
    """
    if not file_bytes:
        raise ImageProcessingError("empty")

    stream = io.BytesIO(file_bytes)
    img: Image.Image | None = None
    oriented: Image.Image | None = None
    working: Image.Image | None = None
    resized: Image.Image | None = None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            try:
                img = Image.open(stream)
                w, h = img.size
                _validate_header_dimensions(w, h)
                img.load()
            except Image.DecompressionBombError as exc:
                raise ImageProcessingError("decompression_bomb") from exc
            except Image.DecompressionBombWarning as exc:
                raise ImageProcessingError("decompression_bomb") from exc
            except ImageProcessingError:
                raise
            except Exception as exc:
                raise ImageProcessingError("corrupt") from exc

        try:
            oriented = ImageOps.exif_transpose(img)
        except Exception as exc:
            raise ImageProcessingError("orient") from exc
        if oriented is not img:
            _close_image(img)
            img = None
        else:
            oriented = img
            img = None

        ow, oh = oriented.size
        _validate_header_dimensions(ow, oh)

        working = _flatten_to_rgb(oriented)
        if working is not oriented:
            _close_image(oriented)
            oriented = None
        else:
            oriented = None

        w, h = working.size
        longest = max(w, h)
        if longest > MAX_LONG_EDGE:
            scale = MAX_LONG_EDGE / float(longest)
            nw = max(1, int(round(w * scale)))
            nh = max(1, int(round(h * scale)))
            resized = working.resize((nw, nh), Image.Resampling.LANCZOS)
            if resized is not working:
                _close_image(working)
                working = None
            w, h = resized.size
        else:
            resized = working
            working = None

        with io.BytesIO() as out:
            try:
                resized.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True, exif=b"")
            except TypeError:
                resized.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
            return out.getvalue(), w, h
    finally:
        _close_image(resized)
        _close_image(working)
        _close_image(oriented)
        _close_image(img)
        stream.close()
