import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.modules.auth.models import SystemRole
from app.modules.onboarding.constants import ONBOARDING_CONTRACT_VERSION
from app.modules.onboarding.models import OnboardingSubmission
from app.modules.onboarding.service import render_submission_print_html, submit_my_submission


PNG_BYTES = b"\x89PNG\r\n\x1a\nsignature-bytes"


def _user(*, user_id: uuid.UUID | None = None, role: SystemRole = SystemRole.EMPLOYEE):
    return SimpleNamespace(
        id=user_id or uuid.uuid4(),
        email="employee@timiq.local",
        system_role=role,
        company_id=uuid.uuid4(),
    )


def _submission(owner, *, status: str = "submitted", contract_version: str = ONBOARDING_CONTRACT_VERSION):
    now = datetime(2026, 5, 18, 12, 0, tzinfo=timezone.utc)
    return OnboardingSubmission(
        id=uuid.uuid4(),
        user_id=owner.id,
        company_id=owner.company_id,
        status=status,
        form_payload={
            "contract_accepted": "true",
            "contract_version": contract_version,
            "signature_name": "Employee Signed Name",
        },
        signature_mode="drawn",
        signature_typed_text="Typed Employee",
        signature_image_path=f"onboarding-signatures/{owner.id}/signature.png",
        submitted_at=now if status != "draft" else None,
        created_at=now,
        updated_at=now,
    )


def _render(submission: OnboardingSubmission, owner):
    storage = MagicMock()
    storage.exists.return_value = True
    storage.read_bytes.return_value = PNG_BYTES
    with (
        patch("app.modules.onboarding.service.get_submission_with_user_and_profile", return_value=(submission, owner, SimpleNamespace(first_name="Petre", last_name="Rotaru"))),
        patch("app.modules.onboarding.service.list_documents_for_submission", return_value=[]),
        patch("app.modules.onboarding.service.get_company_by_id", return_value=SimpleNamespace(name="Demo Company")),
        patch("app.modules.onboarding.service.get_storage_backend", return_value=storage),
        patch("app.modules.onboarding.service.create_internal_audit_event"),
    ):
        html = render_submission_print_html(MagicMock(), owner, submission.id)
    return html, storage


def test_print_document_embeds_drawn_signature_and_header() -> None:
    owner = _user()
    submission = _submission(owner)

    html, _storage = _render(submission, owner)

    assert "Starter Form / Onboarding Contract" in html
    assert "Demo Company" in html
    assert "Petre Rotaru" in html
    assert "employee@timiq.local" in html
    assert "Contract accepted" in html
    assert ONBOARDING_CONTRACT_VERSION in html
    assert "Employee signature" in html
    assert "Signature mode:" in html
    assert "Typed Employee" in html
    assert "data:image/png;base64," in html


def test_print_document_handles_missing_signature_file_safely() -> None:
    owner = _user()
    submission = _submission(owner)
    storage = MagicMock()
    storage.exists.return_value = False

    with (
        patch("app.modules.onboarding.service.get_submission_with_user_and_profile", return_value=(submission, owner, None)),
        patch("app.modules.onboarding.service.list_documents_for_submission", return_value=[]),
        patch("app.modules.onboarding.service.get_company_by_id", return_value=SimpleNamespace(name="Demo Company")),
        patch("app.modules.onboarding.service.get_storage_backend", return_value=storage),
        patch("app.modules.onboarding.service.create_internal_audit_event"),
    ):
        html = render_submission_print_html(MagicMock(), owner, submission.id)

    assert "Signature file unavailable" in html
    assert "onboarding-signatures/" not in html


def test_legacy_contract_version_displays_without_mutating_record() -> None:
    owner = _user()
    submission = _submission(owner, status="approved", contract_version="legacy-ui_constants-1")
    before = dict(submission.form_payload)

    html, _storage = _render(submission, owner)

    assert "Legacy UI contract v1 (legacy-ui_constants-1)" in html
    assert submission.form_payload == before


def test_print_document_does_not_expose_storage_paths_or_urls() -> None:
    owner = _user()
    submission = _submission(owner)
    submission.signature_image_path = "onboarding-signatures/secret/path/signature.png"

    html, _storage = _render(submission, owner)

    assert "onboarding-signatures/secret/path" not in html
    assert "https://r2" not in html.lower()
    assert "storage_path" not in html


def test_new_submission_captures_backend_contract_version() -> None:
    owner = _user()
    submission = _submission(owner, status="draft", contract_version="legacy-ui_constants-1")

    with (
        patch("app.modules.onboarding.service.get_submission_by_user_id", return_value=submission),
        patch("app.modules.onboarding.service.list_documents_for_submission", return_value=[]),
        patch("app.modules.onboarding.service._validate_ready_to_submit"),
        patch("app.modules.onboarding.service.save_submission", return_value=submission),
        patch("app.modules.onboarding.service.create_internal_audit_event"),
    ):
        submit_my_submission(MagicMock(), owner)

    assert submission.form_payload["contract_version"] == ONBOARDING_CONTRACT_VERSION
