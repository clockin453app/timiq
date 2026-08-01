"""Server-side page counting for uploaded RAMS PDFs."""

from __future__ import annotations

import hashlib
import io

from pypdf import PdfReader
from pypdf.errors import PdfReadError


class RamsPdfPageCountError(Exception):
    """Raised when the stored RAMS PDF cannot be counted authoritatively."""


def count_pdf_pages(file_bytes: bytes) -> int:
    if not file_bytes:
        raise RamsPdfPageCountError("The RAMS PDF is empty and cannot be read.")
    try:
        reader = PdfReader(io.BytesIO(file_bytes), strict=False)
        total = len(reader.pages)
    except PdfReadError as exc:
        raise RamsPdfPageCountError("The RAMS PDF cannot be read.") from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise RamsPdfPageCountError("The RAMS PDF cannot be read.") from exc
    if total < 1:
        raise RamsPdfPageCountError("The RAMS PDF has zero pages.")
    return int(total)


def sha256_hex(file_bytes: bytes) -> str:
    return hashlib.sha256(file_bytes).hexdigest()
