"""Decode drawn-signature PNG data URLs for compliance uploads (never store raw base64 in DB)."""

from __future__ import annotations

import base64
import io
import re

from PIL import Image

_MAX_SIGNATURE_BYTES = 450_000
_PNG_DATA_URL = re.compile(r"^data:image/png;base64,([A-Za-z0-9+/=\s]+)$", re.IGNORECASE | re.DOTALL)


class SignatureDataUrlError(ValueError):
    """Invalid or oversized signature payload."""


def decode_png_data_url(data_url: str) -> bytes:
    if not data_url or not isinstance(data_url, str):
        raise SignatureDataUrlError("Missing signature image.")
    compact = "".join(data_url.strip().split())
    m = _PNG_DATA_URL.match(compact)
    if not m:
        raise SignatureDataUrlError("Signature must be a PNG data URL (data:image/png;base64,...).")
    try:
        raw = base64.b64decode(m.group(1), validate=True)
    except Exception as exc:
        raise SignatureDataUrlError("Invalid base64 in signature data URL.") from exc
    if len(raw) == 0 or len(raw) > _MAX_SIGNATURE_BYTES:
        raise SignatureDataUrlError("Signature image is empty or too large.")
    try:
        with Image.open(io.BytesIO(raw)) as im:
            im.verify()
    except Exception as exc:
        raise SignatureDataUrlError("Signature must be a valid PNG image.") from exc
    return raw
