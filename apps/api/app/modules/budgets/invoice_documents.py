"""Protected invoice document upload/download for budget customer invoices."""

from __future__ import annotations

import hashlib
import io
import re
import uuid
import warnings
from datetime import datetime, timezone
from pathlib import PurePosixPath

from fastapi import HTTPException, status
from PIL import Image
from sqlalchemy.orm import Session

from app.core.storage.factory import get_storage_backend
from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import User
from app.modules.budgets.billing import _invoice_response, _load_invoice
from app.modules.budgets.models import BudgetInvoiceDocument
from app.modules.budgets.repository import (
    get_current_invoice_document,
    next_invoice_document_version,
    save_invoice_document,
)
from app.modules.budgets.schemas import InvoiceResponse
from app.modules.work_progress.image_processing import (
    MAX_DECODED_PIXELS,
    MAX_IMAGE_DIMENSION,
    detect_magic_file_kind,
)

# Same limit as uploaded RAMS PDFs.
MAX_INVOICE_DOCUMENT_BYTES = 25 * 1024 * 1024

_UNSAFE_NAME_RE = re.compile(r"[^\w.\- ()\[\]]+", re.UNICODE)
_ALLOWED_KINDS = frozenset({"pdf", "jpeg", "png"})
_KIND_TO_CONTENT_TYPE = {
    "pdf": "application/pdf",
    "jpeg": "image/jpeg",
    "png": "image/png",
}
_CONTENT_TYPE_ALIASES = {
    "application/pdf": "pdf",
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
    "image/png": "png",
}


def sanitize_invoice_document_filename(original: str | None, kind: str) -> str:
    raw = (original or "").strip() or f"invoice.{'pdf' if kind == 'pdf' else kind}"
    name = PurePosixPath(raw.replace("\\", "/")).name
    if ".." in name or "/" in name or "\\" in name:
        name = name.replace("..", "_").replace("/", "_").replace("\\", "_")
    name = _UNSAFE_NAME_RE.sub("_", name).strip(" ._")
    lower = name.lower()
    if kind == "pdf" and not lower.endswith(".pdf"):
        name = f"{name or 'invoice'}.pdf"
    elif kind == "jpeg" and not (lower.endswith(".jpg") or lower.endswith(".jpeg")):
        name = f"{name or 'invoice'}.jpg"
    elif kind == "png" and not lower.endswith(".png"):
        name = f"{name or 'invoice'}.png"
    safe = name[:200] or ("invoice.pdf" if kind == "pdf" else f"invoice.{kind}")
    if ".." in safe or safe.startswith(".") and safe.count(".") == len(safe):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid filename.",
        )
    return safe


def build_invoice_document_storage_key(
    *,
    company_id: uuid.UUID,
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
    version: int,
    safe_name: str,
) -> str:
    return (
        f"companies/{company_id}/budgets/{budget_id}/invoices/{invoice_id}/"
        f"v{version}_{safe_name}"
    )


def _validate_image_decode(file_bytes: bytes) -> None:
    stream = io.BytesIO(file_bytes)
    img: Image.Image | None = None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            try:
                img = Image.open(stream)
                width, height = img.size
                if width <= 0 or height <= 0:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail="Invalid image dimensions.",
                    )
                if max(width, height) > MAX_IMAGE_DIMENSION:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail="Image dimensions are too large.",
                    )
                if width * height > MAX_DECODED_PIXELS:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail="Image has too many pixels to process safely.",
                    )
                img.load()
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Image file could not be decoded.",
                ) from exc
    finally:
        if img is not None:
            try:
                img.close()
            except Exception:
                pass
        stream.close()


def validate_invoice_document(
    *,
    filename: str | None,
    content_type: str | None,
    file_bytes: bytes,
) -> tuple[str, str, str]:
    """Return (safe_filename, content_type, sha256_hex)."""
    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Uploaded file is empty.")
    if len(file_bytes) > MAX_INVOICE_DOCUMENT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Document must be 25 MB or smaller.",
        )

    kind = detect_magic_file_kind(file_bytes)
    if kind not in _ALLOWED_KINDS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only PDF, JPEG, or PNG documents are allowed.",
        )

    declared = (content_type or "").split(";")[0].strip().lower()
    if declared in ("", "application/octet-stream"):
        declared_kind = kind
    else:
        declared_kind = _CONTENT_TYPE_ALIASES.get(declared)
        if declared_kind is None or declared_kind != kind:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Content-Type does not match file contents.",
            )

    if kind == "pdf":
        if file_bytes[:4] != b"%PDF":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="File content is not a valid PDF.",
            )
    else:
        _validate_image_decode(file_bytes)

    safe_name = sanitize_invoice_document_filename(filename, kind)
    media = _KIND_TO_CONTENT_TYPE[kind]
    digest = hashlib.sha256(file_bytes).hexdigest()
    return safe_name, media, digest


def upload_invoice_document(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
    *,
    file_bytes: bytes,
    filename: str | None,
    content_type: str | None,
) -> InvoiceResponse:
    project, invoice = _load_invoice(db_session, actor, budget_id, invoice_id)
    if invoice.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Documents can only be uploaded or replaced on draft invoices.",
        )

    safe_name, media, digest = validate_invoice_document(
        filename=filename,
        content_type=content_type,
        file_bytes=file_bytes,
    )
    version = next_invoice_document_version(db_session, invoice.id)
    storage_key = build_invoice_document_storage_key(
        company_id=project.company_id,
        budget_id=project.id,
        invoice_id=invoice.id,
        version=version,
        safe_name=safe_name,
    )
    # Path traversal protection: storage key must stay under expected prefix.
    expected_prefix = f"companies/{project.company_id}/budgets/{project.id}/invoices/{invoice.id}/"
    if ".." in storage_key or not storage_key.startswith(expected_prefix):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid storage path.",
        )

    storage = get_storage_backend()
    storage.write_bytes(storage_key, file_bytes)

    previous = get_current_invoice_document(db_session, invoice.id)
    now = datetime.now(timezone.utc)
    row = BudgetInvoiceDocument(
        company_id=project.company_id,
        budget_id=project.id,
        invoice_id=invoice.id,
        version=version,
        is_current=True,
        storage_path=storage_key,
        original_filename=safe_name,
        content_type=media,
        size_bytes=len(file_bytes),
        checksum_sha256=digest,
        created_by_user_id=actor.id,
        created_at=now,
    )

    try:
        if previous is not None:
            previous.is_current = False
            previous.replaced_at = now
            db_session.add(previous)
        db_session.add(row)
        db_session.commit()
        db_session.refresh(row)
    except Exception:
        db_session.rollback()
        try:
            storage.delete_file(storage_key)
        except OSError:
            pass
        # Keep previous current if replacement failed.
        if previous is not None:
            previous.is_current = True
            previous.replaced_at = None
            try:
                db_session.add(previous)
                db_session.commit()
            except Exception:
                db_session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save invoice document.",
        ) from None

    action = "budget.invoice_document_replaced" if previous is not None else "budget.invoice_document_uploaded"
    create_internal_audit_event(
        db_session,
        actor,
        action=action,
        entity_type="budget_invoice",
        entity_id=str(invoice.id),
        company_id=project.company_id,
        details={
            "budget_id": str(project.id),
            "invoice_id": str(invoice.id),
            "document_id": str(row.id),
            "version": version,
            "filename": safe_name,
            "content_type": media,
            "size_bytes": len(file_bytes),
            "checksum_sha256": digest,
        },
    )
    return _invoice_response(db_session, invoice)


def download_invoice_document(
    db_session: Session,
    actor: User,
    budget_id: uuid.UUID,
    invoice_id: uuid.UUID,
) -> tuple[bytes, str, str]:
    _project, invoice = _load_invoice(db_session, actor, budget_id, invoice_id)
    doc = get_current_invoice_document(db_session, invoice.id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice document not found.")
    storage = get_storage_backend()
    if not storage.exists(doc.storage_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice document not found.")
    try:
        body = storage.read_bytes(doc.storage_path)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invoice document not found.",
        ) from exc
    return body, doc.original_filename, doc.content_type
