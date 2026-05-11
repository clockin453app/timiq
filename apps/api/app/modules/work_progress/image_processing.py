"""Detect image types by magic bytes and optimise site progress photos for storage."""

from __future__ import annotations

import io
from typing import Literal

from PIL import Image, ImageOps

FileKind = Literal["jpeg", "png", "webp", "pdf"]

MAX_LONG_EDGE = 1600
JPEG_QUALITY = 82
PROCESSING_VERSION = "2"


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


def process_site_progress_photo(file_bytes: bytes) -> tuple[bytes, int, int]:
    """
    Auto-orient (EXIF), resize longest edge to max 1600px, convert to JPEG (q≈82),
    strip metadata, flatten transparency onto white. Returns (jpeg_bytes, width, height).
    """
    img = Image.open(io.BytesIO(file_bytes))
    img = ImageOps.exif_transpose(img)

    if img.mode in ("RGBA", "LA"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    elif img.mode == "P":
        if "transparency" in img.info:
            rgba = img.convert("RGBA")
            bg = Image.new("RGB", rgba.size, (255, 255, 255))
            bg.paste(rgba, mask=rgba.split()[3])
            img = bg
        else:
            img = img.convert("RGB")
    else:
        img = img.convert("RGB")

    w, h = img.size
    longest = max(w, h)
    if longest > MAX_LONG_EDGE:
        scale = MAX_LONG_EDGE / float(longest)
        nw = max(1, int(round(w * scale)))
        nh = max(1, int(round(h * scale)))
        img = img.resize((nw, nh), Image.Resampling.LANCZOS)
        w, h = img.size

    out = io.BytesIO()
    # Strip EXIF and other APP segments from output JPEG (metadata must not be stored).
    try:
        img.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True, exif=b"")
    except TypeError:
        img.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    data = out.getvalue()
    return data, w, h
