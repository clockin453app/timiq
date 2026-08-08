"""Shared onboarding export document model for print HTML and PDF."""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.modules.onboarding.field_labels import (
    DOCUMENT_TITLE,
    doc_type_label,
    ordered_form_rows,
)
from app.modules.onboarding.models import OnboardingDocument, OnboardingSubmission


@dataclass(frozen=True)
class OnboardingExportDocRow:
    doc_type: str
    doc_type_label: str
    original_filename: str
    content_type: str
    file_size_bytes: int


@dataclass(frozen=True)
class OnboardingExportDocument:
    """Server-authoritative onboarding snapshot for print + PDF (no storage paths)."""

    document_title: str
    company_name: str
    employee_name: str
    employee_email: str
    submission_id: str
    status: str
    submitted_display: str
    generated_display: str
    contract_accepted: str
    contract_version: str
    signature_mode: str
    signatory_name: str
    signature_image_bytes: bytes | None
    signature_media_type: str | None
    signature_error: str | None
    documents: tuple[OnboardingExportDocRow, ...]
    form_rows: tuple[tuple[str, str, str], ...]  # key, label, value


def _signature_bytes(signature_path: str | None, read_bytes) -> tuple[bytes | None, str | None, str | None]:
    """Return (bytes, media_type, error). Never returns storage paths."""
    if not signature_path:
        return None, None, None
    try:
        data = read_bytes(signature_path)
    except Exception:
        return None, None, "Signature file unavailable"
    if data is None:
        return None, None, "Signature file unavailable"
    if len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return data, "image/png", None
    if len(data) >= 3 and data[:3] == b"\xff\xd8\xff":
        return data, "image/jpeg", None
    return None, None, "Signature file unavailable"


def signature_data_url(image_bytes: bytes | None, media_type: str | None) -> str | None:
    if not image_bytes or not media_type:
        return None
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{media_type};base64,{encoded}"


def build_onboarding_export_document(
    *,
    submission: OnboardingSubmission,
    company_name: str,
    employee_name: str,
    employee_email: str,
    documents: list[OnboardingDocument],
    generated_at: datetime,
    format_datetime,
    contract_accepted_display: str,
    contract_version_display: str,
    read_signature_bytes,
) -> OnboardingExportDocument:
    form = dict(submission.form_payload or {})
    sig_bytes, sig_media, sig_error = _signature_bytes(
        submission.signature_image_path,
        read_signature_bytes,
    )
    typed = (submission.signature_typed_text or "").strip() or str(form.get("signature_name", "")).strip()
    doc_rows = tuple(
        OnboardingExportDocRow(
            doc_type=d.doc_type,
            doc_type_label=doc_type_label(d.doc_type),
            original_filename=d.original_filename or "—",
            content_type=d.content_type or "—",
            file_size_bytes=int(d.file_size_bytes or 0),
        )
        for d in documents
    )
    return OnboardingExportDocument(
        document_title=DOCUMENT_TITLE,
        company_name=company_name or "Company",
        employee_name=employee_name or "Employee",
        employee_email=(employee_email or "").strip(),
        submission_id=str(submission.id),
        status=str(submission.status or "—"),
        submitted_display=format_datetime(submission.submitted_at),
        generated_display=format_datetime(generated_at),
        contract_accepted=contract_accepted_display,
        contract_version=contract_version_display,
        signature_mode=(submission.signature_mode or "").strip() or "—",
        signatory_name=typed,
        signature_image_bytes=sig_bytes,
        signature_media_type=sig_media,
        signature_error=sig_error,
        documents=doc_rows,
        form_rows=tuple(ordered_form_rows(form)),
    )


def format_file_size(num: int) -> str:
    if num < 1024:
        return f"{num} B"
    if num < 1024 * 1024:
        return f"{num / 1024:.1f} KB"
    return f"{num / (1024 * 1024):.1f} MB"
