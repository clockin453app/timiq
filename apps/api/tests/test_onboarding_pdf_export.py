"""Onboarding PDF export — content, permissions helpers, filename safety."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from io import BytesIO

from PIL import Image as PILImage

from app.modules.auth.models import SystemRole
from app.modules.onboarding.constants import ONBOARDING_CONTRACT_VERSION
from app.modules.onboarding.field_labels import field_label, ordered_form_rows
from app.modules.onboarding.models import OnboardingDocument, OnboardingSubmission
from app.modules.onboarding.pdf_export import (
    build_onboarding_submission_pdf,
    count_pdf_pages,
    onboarding_pdf_filename,
    pdf_embedded_image_count,
    pdf_text_haystack,
)
from app.modules.onboarding.presentation import build_onboarding_export_document
from app.modules.onboarding.service import (
    OnboardingPermissionError,
    _assert_can_print_onboarding_submission,
    export_submission_pdf_bytes,
    render_submission_print_html,
)


def _png_bytes() -> bytes:
    buf = BytesIO()
    PILImage.new("RGB", (120, 40), color=(20, 20, 20)).save(buf, format="PNG")
    return buf.getvalue()


PNG_BYTES = _png_bytes()


def _user(*, user_id=None, role=SystemRole.EMPLOYEE, company_id=None, email="employee@timiq.local"):
    return SimpleNamespace(
        id=user_id or uuid.uuid4(),
        email=email,
        system_role=role,
        company_id=company_id or uuid.uuid4(),
    )


def _submission(owner, *, status="submitted", form=None, signature_mode="drawn"):
    now = datetime(2026, 8, 8, 14, 39, tzinfo=timezone.utc)
    payload = {
        "first_name": "Ion",
        "last_name": "Gradina",
        "phone": "07000000000",
        "emergency_contact_name": "Ana",
        "emergency_contact_phone": "07000000001",
        "address_line2": "Flat 2",
        "bank_account_holder": "Ion Gradina",
        "bank_account_number": "12345678",
        "bank_sort_code": "00-00-00",
        "birth_date": "1990-01-02",
        "company_registration_number": "12345678",
        "contract_accepted": "true",
        "contract_version": ONBOARDING_CONTRACT_VERSION,
        "signature_name": "Ion Gradina",
        "empty_optional": "",
    }
    if form:
        payload.update(form)
    return OnboardingSubmission(
        id=uuid.uuid4(),
        user_id=owner.id,
        company_id=owner.company_id,
        status=status,
        form_payload=payload,
        signature_mode=signature_mode,
        signature_typed_text="Ion Gradina" if signature_mode == "typed" else None,
        signature_image_path=(
            f"onboarding-signatures/{owner.id}/signature.png" if signature_mode == "drawn" else None
        ),
        submitted_at=now if status != "draft" else None,
        created_at=now,
        updated_at=now,
    )


def _doc(submission_id, *, doc_type="cscs_card", name="cscs-front.png"):
    return OnboardingDocument(
        id=uuid.uuid4(),
        submission_id=submission_id,
        doc_type=doc_type,
        original_filename=name,
        content_type="image/png",
        file_size_bytes=2048,
        storage_path=f"onboarding-docs/secret/{name}",
        created_at=datetime(2026, 8, 8, tzinfo=timezone.utc),
    )


def _export(submission, owner, docs=None):
    storage = MagicMock()
    storage.exists.return_value = True
    storage.read_bytes.return_value = PNG_BYTES
    profile = SimpleNamespace(first_name="Ion", last_name="Gradina")
    with (
        patch(
            "app.modules.onboarding.service.get_submission_with_user_and_profile",
            return_value=(submission, owner, profile),
        ),
        patch(
            "app.modules.onboarding.service.list_documents_for_submission",
            return_value=docs or [],
        ),
        patch(
            "app.modules.onboarding.service.get_company_by_id",
            return_value=SimpleNamespace(name="Demo Company"),
        ),
        patch("app.modules.onboarding.service.get_storage_backend", return_value=storage),
        patch("app.modules.onboarding.service.create_internal_audit_event") as audit,
    ):
        return export_submission_pdf_bytes(MagicMock(), owner, submission.id), audit, storage


def test_field_labels_are_friendly() -> None:
    assert field_label("bank_account_holder") == "Bank account holder"
    assert field_label("bank_sort_code") == "Sort code"
    assert field_label("birth_date") == "Date of birth"
    rows = ordered_form_rows(
        {
            "bank_account_holder": "Ion Gradina",
            "empty_optional": "",
            "address_line2": "Flat 2",
        },
    )
    labels = [r[1] for r in rows]
    assert "Bank account holder" in labels
    assert "Address line 2" in labels
    assert "empty_optional" not in "".join(labels)


def test_pdf_filename_sanitises_employee_name() -> None:
    when = datetime(2026, 8, 8, tzinfo=timezone.utc)
    assert onboarding_pdf_filename("Ion Gradina", when) == "TimIQ_Onboarding_Ion_Gradina_2026-08-08.pdf"
    unsafe = onboarding_pdf_filename('Ion/Gradina\n"evil"', when)
    assert "/" not in unsafe
    assert "\\" not in unsafe
    assert '"' not in unsafe
    assert "\n" not in unsafe
    assert unsafe.startswith("TimIQ_Onboarding_")
    assert unsafe.endswith(".pdf")


def test_pdf_contains_core_content_and_signature_image() -> None:
    owner = _user()
    submission = _submission(owner)
    docs = [
        _doc(submission.id, doc_type="cscs_card", name="my-cscs.png"),
        _doc(submission.id, doc_type="identity_document", name="passport-scan.pdf"),
    ]
    (pdf, filename), audit, storage = _export(submission, owner, docs=docs)

    assert pdf.startswith(b"%PDF")
    assert filename.startswith("TimIQ_Onboarding_Ion_Gradina_")
    hay = pdf_text_haystack(pdf)
    assert b"Employee onboarding form" in hay
    assert b"Ion Gradina" in hay
    assert b"Demo Company" in hay
    assert b"Bank account holder" in hay
    assert b"Sort code" in hay
    assert b"Date of birth" in hay
    assert b"Address line 2" in hay
    assert b"CSCS card" in hay
    assert b"my-cscs.png" in hay
    assert b"Identity document" in hay
    assert b"Generated by TimIQ" in hay
    assert b"onboarding-signatures/" not in hay
    assert b"onboarding-docs/secret" not in hay
    assert pdf_embedded_image_count(pdf) >= 1
    audit.assert_called()
    assert audit.call_args.kwargs["action"] == "onboarding.submission_pdf_downloaded"
    assert "bank_account_number" not in (audit.call_args.kwargs.get("details") or {})


def test_typed_signature_pdf_has_no_image_but_shows_name() -> None:
    owner = _user()
    submission = _submission(owner, signature_mode="typed")
    (pdf, _filename), _audit, _storage = _export(submission, owner)
    hay = pdf_text_haystack(pdf)
    assert b"Ion Gradina" in hay
    assert b"typed" in hay.lower() or b"Typed" in hay
    assert pdf_embedded_image_count(pdf) == 0


def test_print_and_pdf_share_major_fields() -> None:
    owner = _user()
    submission = _submission(owner)
    docs = [_doc(submission.id)]
    storage = MagicMock()
    storage.exists.return_value = True
    storage.read_bytes.return_value = PNG_BYTES
    profile = SimpleNamespace(first_name="Ion", last_name="Gradina")
    with (
        patch(
            "app.modules.onboarding.service.get_submission_with_user_and_profile",
            return_value=(submission, owner, profile),
        ),
        patch("app.modules.onboarding.service.list_documents_for_submission", return_value=docs),
        patch(
            "app.modules.onboarding.service.get_company_by_id",
            return_value=SimpleNamespace(name="Demo Company"),
        ),
        patch("app.modules.onboarding.service.get_storage_backend", return_value=storage),
        patch("app.modules.onboarding.service.create_internal_audit_event"),
    ):
        html = render_submission_print_html(MagicMock(), owner, submission.id)
        pdf, _fn = export_submission_pdf_bytes(MagicMock(), owner, submission.id)
    hay = pdf_text_haystack(pdf).decode("latin-1", errors="ignore")
    for token in (
        "Employee onboarding form",
        "Ion Gradina",
        "Demo Company",
        "Bank account holder",
        "CSCS card",
        "Employee signature",
    ):
        assert token in html
        assert token in hay


def test_long_form_produces_multiple_pages() -> None:
    owner = _user()
    long_form = {f"extra_field_{i}": ("Long answer line. " * 40) for i in range(40)}
    submission = _submission(owner, form=long_form)
    (pdf, _fn), _audit, _storage = _export(submission, owner)
    assert count_pdf_pages(pdf) >= 2
    assert pdf[0:4] == b"%PDF"


def test_employee_cannot_print_draft() -> None:
    owner = _user()
    submission = _submission(owner, status="draft")
    try:
        _assert_can_print_onboarding_submission(owner, submission, owner)
        raise AssertionError("expected permission error")
    except OnboardingPermissionError:
        pass


def test_cross_company_admin_denied_by_assert() -> None:
    owner = _user(company_id=uuid.uuid4())
    admin = _user(role=SystemRole.ADMIN, company_id=uuid.uuid4())
    submission = _submission(owner)
    with patch(
        "app.modules.onboarding.service.can_admin_review_user",
        return_value=False,
    ):
        try:
            _assert_can_print_onboarding_submission(admin, submission, owner)
            raise AssertionError("expected permission error")
        except OnboardingPermissionError:
            pass


def test_build_export_document_omits_storage_paths() -> None:
    owner = _user()
    submission = _submission(owner)
    docs = [_doc(submission.id)]

    def _read(path: str):
        assert "secret" in path or "signature" in path
        return PNG_BYTES

    doc = build_onboarding_export_document(
        submission=submission,
        company_name="Demo",
        employee_name="Ion Gradina",
        employee_email=owner.email,
        documents=docs,
        generated_at=datetime(2026, 8, 8, tzinfo=timezone.utc),
        format_datetime=lambda dt: "08 Aug 2026, 14:39 UTC" if dt else "—",
        contract_accepted_display="yes",
        contract_version_display=ONBOARDING_CONTRACT_VERSION,
        read_signature_bytes=_read,
    )
    pdf = build_onboarding_submission_pdf(doc)
    hay = pdf_text_haystack(pdf)
    assert b"storage_path" not in hay
    assert b"onboarding-docs/secret" not in hay
    assert b"/MediaBox" in pdf
