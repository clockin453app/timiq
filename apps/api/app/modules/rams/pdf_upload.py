"""Validation helpers for uploaded primary RAMS PDF documents."""

from __future__ import annotations

import hashlib
import re
import uuid
from pathlib import PurePosixPath

from app.modules.rams.constants import MAX_UPLOADED_RAMS_PDF_BYTES

_UNSAFE_NAME_RE = re.compile(r"[^\w.\- ()\[\]]+", re.UNICODE)


class UploadedRamsPdfValidationError(ValueError):
    pass


def sanitize_rams_pdf_filename(original: str | None) -> str:
    raw = (original or "").strip() or "rams.pdf"
    name = PurePosixPath(raw.replace("\\", "/")).name
    name = _UNSAFE_NAME_RE.sub("_", name).strip(" ._")
    if not name.lower().endswith(".pdf"):
        name = f"{name or 'rams'}.pdf"
    return name[:200] or "rams.pdf"


def validate_uploaded_rams_pdf(*, filename: str | None, content_type: str | None, file_bytes: bytes) -> tuple[str, str, str]:
    """Return (sanitised_filename, content_type, sha256_hex)."""
    if not file_bytes:
        raise UploadedRamsPdfValidationError("Uploaded file is empty.")
    if len(file_bytes) > MAX_UPLOADED_RAMS_PDF_BYTES:
        raise UploadedRamsPdfValidationError("PDF must be 25 MB or smaller.")
    media = (content_type or "").split(";")[0].strip().lower()
    if media in ("", "application/octet-stream"):
        media = "application/pdf" if file_bytes[:4] == b"%PDF" else media
    if media != "application/pdf":
        raise UploadedRamsPdfValidationError("Only PDF files are allowed.")
    if file_bytes[:4] != b"%PDF":
        raise UploadedRamsPdfValidationError("File content is not a valid PDF.")
    safe_name = sanitize_rams_pdf_filename(filename)
    if not safe_name.lower().endswith(".pdf"):
        raise UploadedRamsPdfValidationError("Only PDF files are allowed.")
    digest = hashlib.sha256(file_bytes).hexdigest()
    return safe_name, "application/pdf", digest


def build_uploaded_rams_storage_key(*, company_id: uuid.UUID, assessment_id: uuid.UUID, version: int) -> str:
    return f"rams-documents/{company_id}/{assessment_id}/v{version}-{uuid.uuid4().hex}.pdf"
