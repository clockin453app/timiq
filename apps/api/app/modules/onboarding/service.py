import base64
import html
import json
import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.core.storage.factory import get_storage_backend
from app.modules.audit.service import create_internal_audit_event
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.auth.service import can_manage_user
from app.modules.companies.repository import get_company_by_id
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.employee_profiles.repository import get_employee_profile_by_user_id
from app.modules.employee_profiles.sanitize_tax_ids import (
    sanitize_national_insurance_value,
    sanitize_utr_value,
)
from app.modules.onboarding.constants import ONBOARDING_CONTRACT_VERSION
from app.modules.onboarding.models import OnboardingDocument, OnboardingSubmission
from app.modules.onboarding.permissions import (
    can_access_document_file,
    can_access_profile_photo_file,
    can_access_signature_image,
    can_admin_review_user,
    can_employee_edit_submission,
    can_view_submission_as_owner,
    is_submission_owner,
)
from app.modules.onboarding.repository import (
    count_reviewable_submissions,
    delete_document_row,
    get_document_by_id,
    get_document_by_submission_and_type,
    get_submission_by_id,
    get_submission_by_user_id,
    get_submission_with_user_and_profile,
    list_documents_for_submission,
    list_reviewable_submissions,
    save_document,
    save_submission,
    save_submission_no_commit,
)
from app.modules.onboarding.schemas import (
    OnboardingDocumentPublic,
    OnboardingReviewListItemResponse,
    OnboardingReviewListResponse,
    OnboardingSubmissionDetailResponse,
)

REQUIRED_DOC_TYPES = (
    "identity_document",
    "cscs_card",
    "public_liability_insurance",
    "share_code_document",
)

POSITION_OPTIONS = frozenset(
    {
        "Bricklayer",
        "Labourer",
        "Fixer",
        "Supervisor/Foreman",
    },
)

EMPLOYMENT_TYPE_OPTIONS = frozenset(
    {
        "Self-employed",
        "Ltd Company",
        "Agency",
        "PAYE",
    },
)

OPTIONAL_FORM_KEYS = (
    "job_title",
    "start_date",
    "address_line1",
    "address_line2",
    "city",
    "postcode",
    "country",
    "national_insurance_number",
    "utr",
    "bank_account_holder",
    "bank_sort_code",
    "bank_account_number",
    "birth_date",
    "street_address",
    "medical_condition",
    "medical_details",
    "position",
    "cscs_number",
    "cscs_expiry",
    "employment_type",
    "right_to_work_uk",
    "contract_effective_date",
    "site_address",
    "contract_accepted",
    "contract_version",
    "signature_name",
    "company_trading_name",
    "company_registration_number",
)

REQUIRED_FORM_KEYS = (
    "first_name",
    "last_name",
    "phone",
    "emergency_contact_name",
    "emergency_contact_phone",
)

ALLOWED_FORM_KEYS = frozenset(REQUIRED_FORM_KEYS + OPTIONAL_FORM_KEYS)

FIELD_MAX_LENGTH: dict[str, int] = {
    "first_name": 120,
    "last_name": 120,
    "phone": 30,
    "job_title": 120,
    "emergency_contact_name": 120,
    "emergency_contact_phone": 30,
    "address_line1": 200,
    "address_line2": 200,
    "city": 120,
    "postcode": 32,
    "country": 120,
    "national_insurance_number": 32,
    "utr": 32,
    "bank_account_holder": 200,
    "bank_sort_code": 32,
    "bank_account_number": 64,
    "start_date": 32,
    "birth_date": 32,
    "street_address": 200,
    "medical_condition": 16,
    "medical_details": 2000,
    "position": 80,
    "cscs_number": 64,
    "cscs_expiry": 32,
    "employment_type": 32,
    "right_to_work_uk": 16,
    "contract_effective_date": 32,
    "site_address": 500,
    "contract_accepted": 16,
    "contract_version": 64,
    "signature_name": 200,
    "company_trading_name": 200,
    "company_registration_number": 32,
}

MAX_ONBOARDING_DOCUMENT_BYTES = 10 * 1024 * 1024
MAX_SIGNATURE_IMAGE_BYTES = 2 * 1024 * 1024
MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024

ALLOWED_DOCUMENT_MEDIA = frozenset(
    {
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
    },
)

ALLOWED_SIGNATURE_MEDIA = frozenset(
    {
        "image/jpeg",
        "image/png",
    },
)

ALLOWED_PROFILE_PHOTO_MEDIA = frozenset(
    {
        "image/jpeg",
        "image/png",
        "image/webp",
    },
)

EXTENSION_BY_MEDIA: dict[str, str] = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

SIGNATURE_EXTENSION_BY_MEDIA: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
}

PROFILE_PHOTO_EXTENSION_BY_MEDIA: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


class OnboardingError(ValueError):
    pass


class OnboardingNotFoundError(OnboardingError):
    pass


class OnboardingPermissionError(OnboardingError):
    pass


class OnboardingStateError(OnboardingError):
    pass


class OnboardingValidationError(OnboardingError):
    pass


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _unlink_storage_file(relative_path: str | None) -> None:
    if not relative_path:
        return
    get_storage_backend().delete_file(relative_path)


def _normalize_media_type(content_type: str) -> str:
    return (content_type or "").split(";")[0].strip().lower()


def _normalize_uploaded_document(content_type: str, file_bytes: bytes) -> tuple[str, str]:
    if len(file_bytes) == 0:
        raise OnboardingValidationError("Uploaded file is empty.")
    if len(file_bytes) > MAX_ONBOARDING_DOCUMENT_BYTES:
        raise OnboardingValidationError("Uploaded file is too large.")
    media = _normalize_media_type(content_type)
    if media == "application/octet-stream" and file_bytes[:4] == b"%PDF":
        media = "application/pdf"
    if media == "application/octet-stream" and len(file_bytes) >= 3 and file_bytes[:3] == b"\xff\xd8\xff":
        media = "image/jpeg"
    if media == "application/octet-stream" and len(file_bytes) >= 8 and file_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        media = "image/png"
    if media == "application/octet-stream" and len(file_bytes) >= 12 and file_bytes[:4] == b"RIFF" and file_bytes[8:12] == b"WEBP":
        media = "image/webp"
    if media not in ALLOWED_DOCUMENT_MEDIA:
        raise OnboardingValidationError("Only PDF, JPEG, PNG, or WebP documents are allowed.")
    ext = EXTENSION_BY_MEDIA.get(media)
    if ext is None:
        raise OnboardingValidationError("Only PDF, JPEG, PNG, or WebP documents are allowed.")
    return media, ext


def _normalize_profile_photo(content_type: str, file_bytes: bytes) -> tuple[str, str]:
    if len(file_bytes) == 0:
        raise OnboardingValidationError("Profile photo is empty.")
    if len(file_bytes) > MAX_PROFILE_PHOTO_BYTES:
        raise OnboardingValidationError("Profile photo must be 5 MB or smaller.")
    media = _normalize_media_type(content_type)
    if media == "application/octet-stream" and len(file_bytes) >= 3 and file_bytes[:3] == b"\xff\xd8\xff":
        media = "image/jpeg"
    if media == "application/octet-stream" and len(file_bytes) >= 8 and file_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        media = "image/png"
    if media == "application/octet-stream" and len(file_bytes) >= 12 and file_bytes[:4] == b"RIFF" and file_bytes[8:12] == b"WEBP":
        media = "image/webp"
    if media not in ALLOWED_PROFILE_PHOTO_MEDIA:
        raise OnboardingValidationError("Profile photo must be a JPEG, PNG, or WebP image.")
    ext = PROFILE_PHOTO_EXTENSION_BY_MEDIA.get(media)
    if ext is None:
        raise OnboardingValidationError("Profile photo must be a JPEG, PNG, or WebP image.")
    return media, ext


def _normalize_signature_image(content_type: str, file_bytes: bytes) -> tuple[str, str]:
    if len(file_bytes) == 0:
        raise OnboardingValidationError("Signature image is empty.")
    if len(file_bytes) > MAX_SIGNATURE_IMAGE_BYTES:
        raise OnboardingValidationError("Signature image is too large.")
    media = _normalize_media_type(content_type)
    if media == "application/octet-stream" and len(file_bytes) >= 3 and file_bytes[:3] == b"\xff\xd8\xff":
        media = "image/jpeg"
    if media == "application/octet-stream" and len(file_bytes) >= 8 and file_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        media = "image/png"
    if media not in ALLOWED_SIGNATURE_MEDIA:
        raise OnboardingValidationError("Signature must be a JPEG or PNG image.")
    ext = SIGNATURE_EXTENSION_BY_MEDIA.get(media)
    if ext is None:
        raise OnboardingValidationError("Signature must be a JPEG or PNG image.")
    return media, ext


def _write_binary_file(relative_path: str, file_bytes: bytes) -> None:
    get_storage_backend().write_bytes(relative_path, file_bytes)


def _normalize_form_payload(patch: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for key, raw in patch.items():
        if key not in ALLOWED_FORM_KEYS:
            continue
        if raw is None:
            result[key] = ""
            continue
        if not isinstance(raw, str):
            raise OnboardingValidationError(f"Field {key} must be a string.")
        text = raw.strip()
        max_len = FIELD_MAX_LENGTH.get(key, 500)
        if len(text) > max_len:
            raise OnboardingValidationError(f"Field {key} is too long.")
        result[key] = text
    return result


def _merge_form_payload(existing: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    normalized = _normalize_form_payload(patch)
    merged = dict(existing)
    merged.update(normalized)
    return merged


def _parse_start_date(value: str) -> date | None:
    cleaned = value.strip()
    if not cleaned:
        return None
    return date.fromisoformat(cleaned)


def _parse_required_iso_date(raw: str, field_label: str) -> date:
    cleaned = raw.strip()
    if not cleaned:
        raise OnboardingValidationError(f"Missing required field: {field_label}.")
    try:
        return date.fromisoformat(cleaned)
    except ValueError as exc:
        raise OnboardingValidationError(
            f"{field_label} must be a valid ISO date (YYYY-MM-DD).",
        ) from exc


def _yn_flag(value: str) -> str | None:
    v = value.strip().lower()
    if v in ("yes", "y", "true", "1"):
        return "yes"
    if v in ("no", "n", "false", "0"):
        return "no"
    return None


def _truthy_contract_accepted(value: str) -> bool:
    v = value.strip().lower()
    return v in ("yes", "true", "1", "on")


def _contract_version_display(value: object) -> str:
    raw = str(value or "").strip()
    if raw == "legacy-ui_constants-1":
        return "Legacy UI contract v1 (legacy-ui_constants-1)"
    return raw or ONBOARDING_CONTRACT_VERSION


def _format_document_datetime(value: datetime | None) -> str:
    if value is None:
        return "—"
    dt = value
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%d %b %Y, %H:%M UTC")


def _contract_accepted_display(form: dict[str, Any]) -> str:
    if "contract_accepted" in form:
        raw = form.get("contract_accepted")
    elif "accept_contract" in form:
        raw = form.get("accept_contract")
    else:
        return "Not recorded"
    if raw in (True, 1):
        return "yes"
    if raw in (False, 0):
        return "no"
    text = str(raw).strip().lower()
    if text in ("yes", "true", "1", "on"):
        return "yes"
    if text in ("no", "false", "0", "off", ""):
        return "no"
    return "Not recorded"


def _street_line(form: dict[str, Any]) -> str:
    s = str(form.get("street_address", "")).strip()
    if s:
        return s
    return str(form.get("address_line1", "")).strip()


def submission_to_detail(
    submission: OnboardingSubmission,
    documents: list[OnboardingDocument],
    *,
    account_email: str,
) -> OnboardingSubmissionDetailResponse:
    return OnboardingSubmissionDetailResponse(
        id=submission.id,
        user_id=submission.user_id,
        company_id=submission.company_id,
        account_email=account_email,
        status=submission.status,
        form_payload=dict(submission.form_payload or {}),
        signature_mode=submission.signature_mode,
        signature_typed_text=submission.signature_typed_text,
        has_drawn_signature=bool(submission.signature_image_path),
        documents=[OnboardingDocumentPublic.model_validate(d) for d in documents],
        submitted_at=submission.submitted_at,
        reviewed_at=submission.reviewed_at,
        review_note=submission.review_note,
        has_profile_photo=bool(submission.profile_photo_storage_path),
        profile_photo_updated_at=submission.profile_photo_updated_at,
        created_at=submission.created_at,
        updated_at=submission.updated_at,
    )


def get_or_create_my_submission(
    db_session: Session,
    actor: User,
) -> OnboardingSubmissionDetailResponse:
    row = get_submission_by_user_id(db_session, actor.id)
    if row is None:
        row = OnboardingSubmission(
            user_id=actor.id,
            company_id=actor.company_id,
            status="draft",
            form_payload={},
        )
        save_submission(db_session, row)
    if not can_view_submission_as_owner(actor, row):
        raise OnboardingPermissionError("You cannot access this onboarding record.")
    docs = list_documents_for_submission(db_session, row.id)
    return submission_to_detail(row, docs, account_email=actor.email)


def patch_my_draft(
    db_session: Session,
    actor: User,
    form_payload: dict[str, Any],
) -> OnboardingSubmissionDetailResponse:
    row = get_submission_by_user_id(db_session, actor.id)
    if row is None:
        merged = _merge_form_payload({}, form_payload)
        row = OnboardingSubmission(
            user_id=actor.id,
            company_id=actor.company_id,
            status="draft",
            form_payload=merged,
        )
        save_submission(db_session, row)
    else:
        if not can_employee_edit_submission(actor, row):
            raise OnboardingStateError("This onboarding record cannot be edited in its current state.")
        row.form_payload = _merge_form_payload(dict(row.form_payload or {}), form_payload)
        save_submission(db_session, row)
    docs = list_documents_for_submission(db_session, row.id)
    return submission_to_detail(row, docs, account_email=actor.email)


def reopen_my_submission(db_session: Session, actor: User) -> OnboardingSubmissionDetailResponse:
    row = get_submission_by_user_id(db_session, actor.id)
    if row is None:
        raise OnboardingNotFoundError("No onboarding record found.")
    if not is_submission_owner(actor, row):
        raise OnboardingPermissionError("You cannot access this onboarding record.")
    if row.status != "rejected":
        raise OnboardingStateError("Only a rejected application can be reopened for editing.")
    row.status = "draft"
    save_submission(db_session, row)
    docs = list_documents_for_submission(db_session, row.id)
    return submission_to_detail(row, docs, account_email=actor.email)


def upload_my_document(
    db_session: Session,
    actor: User,
    doc_type: str,
    original_filename: str,
    content_type: str,
    file_bytes: bytes,
) -> OnboardingSubmissionDetailResponse:
    if doc_type not in REQUIRED_DOC_TYPES:
        raise OnboardingValidationError("Invalid document type.")
    row = get_submission_by_user_id(db_session, actor.id)
    if row is None:
        row = OnboardingSubmission(
            user_id=actor.id,
            company_id=actor.company_id,
            status="draft",
            form_payload={},
        )
        db_session.add(row)
        db_session.commit()
        db_session.refresh(row)
    if not can_employee_edit_submission(actor, row):
        raise OnboardingStateError("Documents cannot be changed in the current state.")

    media_type, ext = _normalize_uploaded_document(content_type, file_bytes)
    rel_path = f"onboarding-documents/{actor.id}/{row.id}/{doc_type}-{uuid.uuid4().hex}{ext}"
    _write_binary_file(rel_path, file_bytes)

    existing = get_document_by_submission_and_type(db_session, row.id, doc_type)
    try:
        if existing is not None:
            _unlink_storage_file(existing.storage_path)
            existing.original_filename = original_filename[:255]
            existing.content_type = media_type
            existing.file_size_bytes = len(file_bytes)
            existing.storage_path = rel_path
            save_document(db_session, existing)
        else:
            doc = OnboardingDocument(
                submission_id=row.id,
                doc_type=doc_type,
                original_filename=original_filename[:255],
                content_type=media_type,
                file_size_bytes=len(file_bytes),
                storage_path=rel_path,
            )
            save_document(db_session, doc)
    except Exception:
        _unlink_storage_file(rel_path)
        raise

    row = get_submission_by_user_id(db_session, actor.id)
    assert row is not None
    docs = list_documents_for_submission(db_session, row.id)
    return submission_to_detail(row, docs, account_email=actor.email)


def delete_my_document(
    db_session: Session,
    actor: User,
    document_id: uuid.UUID,
) -> OnboardingSubmissionDetailResponse:
    row = get_submission_by_user_id(db_session, actor.id)
    if row is None:
        raise OnboardingNotFoundError("No onboarding record found.")
    if not can_employee_edit_submission(actor, row):
        raise OnboardingStateError("Documents cannot be changed in the current state.")
    doc = get_document_by_id(db_session, document_id)
    if doc is None or doc.submission_id != row.id:
        raise OnboardingNotFoundError("Document not found.")
    _unlink_storage_file(doc.storage_path)
    delete_document_row(db_session, doc)
    row = get_submission_by_user_id(db_session, actor.id)
    assert row is not None
    docs = list_documents_for_submission(db_session, row.id)
    return submission_to_detail(row, docs, account_email=actor.email)


def set_my_typed_signature(db_session: Session, actor: User, text: str) -> OnboardingSubmissionDetailResponse:
    cleaned = text.strip()
    if len(cleaned) < 2 or len(cleaned) > 200:
        raise OnboardingValidationError("Typed signature must be between 2 and 200 characters.")
    row = get_submission_by_user_id(db_session, actor.id)
    if row is None:
        row = OnboardingSubmission(
            user_id=actor.id,
            company_id=actor.company_id,
            status="draft",
            form_payload={},
        )
        db_session.add(row)
        db_session.commit()
        db_session.refresh(row)
    if not can_employee_edit_submission(actor, row):
        raise OnboardingStateError("Signature cannot be changed in the current state.")
    if row.signature_image_path:
        _unlink_storage_file(row.signature_image_path)
        row.signature_image_path = None
    row.signature_mode = "typed"
    row.signature_typed_text = cleaned
    save_submission(db_session, row)
    docs = list_documents_for_submission(db_session, row.id)
    return submission_to_detail(row, docs, account_email=actor.email)


def set_my_drawn_signature(
    db_session: Session,
    actor: User,
    content_type: str,
    file_bytes: bytes,
) -> OnboardingSubmissionDetailResponse:
    row = get_submission_by_user_id(db_session, actor.id)
    if row is None:
        row = OnboardingSubmission(
            user_id=actor.id,
            company_id=actor.company_id,
            status="draft",
            form_payload={},
        )
        db_session.add(row)
        db_session.commit()
        db_session.refresh(row)
    if not can_employee_edit_submission(actor, row):
        raise OnboardingStateError("Signature cannot be changed in the current state.")

    media_type, ext = _normalize_signature_image(content_type, file_bytes)
    rel_path = f"onboarding-signatures/{actor.id}/{row.id}/signature-{uuid.uuid4().hex}{ext}"
    _write_binary_file(rel_path, file_bytes)
    try:
        if row.signature_image_path:
            _unlink_storage_file(row.signature_image_path)
        row.signature_image_path = rel_path
        row.signature_mode = "drawn"
        row.signature_typed_text = None
        save_submission(db_session, row)
    except Exception:
        _unlink_storage_file(rel_path)
        raise
    docs = list_documents_for_submission(db_session, row.id)
    return submission_to_detail(row, docs, account_email=actor.email)


def clear_my_signature(db_session: Session, actor: User) -> OnboardingSubmissionDetailResponse:
    row = get_submission_by_user_id(db_session, actor.id)
    if row is None:
        raise OnboardingNotFoundError("No onboarding record found.")
    if not can_employee_edit_submission(actor, row):
        raise OnboardingStateError("Signature cannot be changed in the current state.")
    if row.signature_image_path:
        _unlink_storage_file(row.signature_image_path)
        row.signature_image_path = None
    row.signature_mode = None
    row.signature_typed_text = None
    save_submission(db_session, row)
    docs = list_documents_for_submission(db_session, row.id)
    return submission_to_detail(row, docs, account_email=actor.email)


def upload_my_profile_photo(
    db_session: Session,
    actor: User,
    content_type: str,
    file_bytes: bytes,
) -> OnboardingSubmissionDetailResponse:
    row = get_submission_by_user_id(db_session, actor.id)
    if row is None:
        row = OnboardingSubmission(
            user_id=actor.id,
            company_id=actor.company_id,
            status="draft",
            form_payload={},
        )
        db_session.add(row)
        db_session.commit()
        db_session.refresh(row)
    if not can_employee_edit_submission(actor, row):
        raise OnboardingStateError("Profile photo cannot be changed in the current state.")

    media_type, ext = _normalize_profile_photo(content_type, file_bytes)
    rel_path = f"onboarding-profile-photos/{actor.id}/{row.id}/photo-{uuid.uuid4().hex}{ext}"
    _write_binary_file(rel_path, file_bytes)
    try:
        if row.profile_photo_storage_path:
            _unlink_storage_file(row.profile_photo_storage_path)
        row.profile_photo_storage_path = rel_path
        row.profile_photo_content_type = media_type
        row.profile_photo_file_size_bytes = len(file_bytes)
        row.profile_photo_updated_at = _utc_now()
        save_submission(db_session, row)
    except Exception:
        _unlink_storage_file(rel_path)
        raise
    docs = list_documents_for_submission(db_session, row.id)
    return submission_to_detail(row, docs, account_email=actor.email)


def delete_my_profile_photo(db_session: Session, actor: User) -> OnboardingSubmissionDetailResponse:
    row = get_submission_by_user_id(db_session, actor.id)
    if row is None:
        raise OnboardingNotFoundError("No onboarding record found.")
    if not can_employee_edit_submission(actor, row):
        raise OnboardingStateError("Profile photo cannot be changed in the current state.")
    if row.profile_photo_storage_path:
        _unlink_storage_file(row.profile_photo_storage_path)
    row.profile_photo_storage_path = None
    row.profile_photo_content_type = None
    row.profile_photo_file_size_bytes = None
    row.profile_photo_updated_at = None
    save_submission(db_session, row)
    docs = list_documents_for_submission(db_session, row.id)
    return submission_to_detail(row, docs, account_email=actor.email)


def _validate_ready_to_submit(
    submission: OnboardingSubmission,
    documents: list[OnboardingDocument],
    *,
    account_email: str,
) -> None:
    form = dict(submission.form_payload or {})
    for key in REQUIRED_FORM_KEYS:
        if not str(form.get(key, "")).strip():
            raise OnboardingValidationError(f"Missing required field: {key}.")
    if not (account_email or "").strip():
        raise OnboardingValidationError("Missing required field: account email.")

    if not str(form.get("birth_date", "")).strip():
        raise OnboardingValidationError("Missing required field: birth_date.")
    _parse_required_iso_date(str(form.get("birth_date", "")), "birth_date")

    if not _street_line(form):
        raise OnboardingValidationError("Missing required field: street_address.")

    if _yn_flag(str(form.get("medical_condition", ""))) is None:
        raise OnboardingValidationError("Missing required field: medical_condition (yes or no).")

    pos = str(form.get("position", "")).strip()
    if not pos or pos not in POSITION_OPTIONS:
        raise OnboardingValidationError("Missing or invalid field: position.")

    if not str(form.get("cscs_number", "")).strip():
        raise OnboardingValidationError("Missing required field: cscs_number.")
    if not str(form.get("cscs_expiry", "")).strip():
        raise OnboardingValidationError("Missing required field: cscs_expiry.")
    _parse_required_iso_date(str(form.get("cscs_expiry", "")), "cscs_expiry")

    et = str(form.get("employment_type", "")).strip()
    if not et or et not in EMPLOYMENT_TYPE_OPTIONS:
        raise OnboardingValidationError("Missing or invalid field: employment_type.")

    if _yn_flag(str(form.get("right_to_work_uk", ""))) is None:
        raise OnboardingValidationError("Missing required field: right_to_work_uk (yes or no).")

    if not str(form.get("national_insurance_number", "")).strip():
        raise OnboardingValidationError("Missing required field: national_insurance_number.")
    if not str(form.get("utr", "")).strip():
        raise OnboardingValidationError("Missing required field: utr.")

    if not str(form.get("start_date", "")).strip():
        raise OnboardingValidationError("Missing required field: start_date.")
    _parse_required_iso_date(str(form.get("start_date", "")), "start_date")

    if not str(form.get("contract_effective_date", "")).strip():
        raise OnboardingValidationError("Missing required field: contract_effective_date.")
    _parse_required_iso_date(
        str(form.get("contract_effective_date", "")),
        "contract_effective_date",
    )

    if not str(form.get("site_address", "")).strip():
        raise OnboardingValidationError("Missing required field: site_address.")

    for bk in ("bank_account_number", "bank_sort_code", "bank_account_holder"):
        if not str(form.get(bk, "")).strip():
            raise OnboardingValidationError(f"Missing required field: {bk}.")

    if not _truthy_contract_accepted(str(form.get("contract_accepted", ""))):
        raise OnboardingValidationError("You must accept the contract before submitting.")

    if not str(form.get("signature_name", "")).strip():
        raise OnboardingValidationError("Missing required field: signature_name.")

    if submission.signature_mode != "drawn" or not submission.signature_image_path:
        raise OnboardingValidationError("A drawn signature image is required before submitting.")

    slots = {d.doc_type for d in documents}
    for req in REQUIRED_DOC_TYPES:
        if req not in slots:
            raise OnboardingValidationError(f"Missing required document upload: {req}.")


def submit_my_submission(db_session: Session, actor: User) -> OnboardingSubmissionDetailResponse:
    row = get_submission_by_user_id(db_session, actor.id)
    if row is None:
        raise OnboardingNotFoundError("No onboarding record found.")
    if not is_submission_owner(actor, row):
        raise OnboardingPermissionError("You cannot submit this onboarding record.")
    if row.status != "draft":
        raise OnboardingStateError("Only a draft can be submitted.")
    form = dict(row.form_payload or {})
    if _truthy_contract_accepted(str(form.get("contract_accepted", ""))):
        form["contract_version"] = ONBOARDING_CONTRACT_VERSION
    row.form_payload = form
    docs = list_documents_for_submission(db_session, row.id)
    _validate_ready_to_submit(row, docs, account_email=actor.email)
    row.status = "submitted"
    row.submitted_at = _utc_now()
    row.reviewed_at = None
    row.reviewed_by_user_id = None
    row.review_note = None
    save_submission(db_session, row)
    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="onboarding.submitted",
        entity_type="onboarding_submission",
        entity_id=str(row.id),
        company_id=row.company_id,
        details={"user_id": str(actor.id)},
    )
    docs = list_documents_for_submission(db_session, row.id)
    return submission_to_detail(row, docs, account_email=actor.email)


def list_review_submissions(
    db_session: Session,
    actor: User,
    *,
    status_filter: str | None,
    company_id: uuid.UUID | None,
    limit: int,
    offset: int,
) -> OnboardingReviewListResponse:
    if actor.system_role not in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        raise OnboardingPermissionError("You do not have permission to list onboarding reviews.")
    if actor.system_role == SystemRole.ADMIN and company_id is not None:
        raise OnboardingPermissionError("Company filter is only available to an Administrator.")
    total = count_reviewable_submissions(
        db_session,
        actor=actor,
        status_filter=status_filter,
        company_id=company_id,
    )
    rows = list_reviewable_submissions(
        db_session,
        actor=actor,
        status_filter=status_filter,
        company_id=company_id,
        limit=limit,
        offset=offset,
    )
    items: list[OnboardingReviewListItemResponse] = []
    for submission, user, profile in rows:
        name_parts = []
        if profile is not None:
            if profile.first_name:
                name_parts.append(profile.first_name)
            if profile.last_name:
                name_parts.append(profile.last_name)
        employee_name = " ".join(name_parts).strip() or None
        company_name: str | None = None
        if user.company_id is not None:
            company = get_company_by_id(db_session, user.company_id)
            if company is not None:
                company_name = company.name
        items.append(
            OnboardingReviewListItemResponse(
                id=submission.id,
                user_id=user.id,
                user_email=user.email,
                employee_name=employee_name,
                company_id=user.company_id,
                company_name=company_name,
                status=submission.status,
                submitted_at=submission.submitted_at,
                updated_at=submission.updated_at,
            ),
        )
    return OnboardingReviewListResponse(items=items, total=total)


def get_review_submission_detail(
    db_session: Session,
    actor: User,
    submission_id: uuid.UUID,
) -> OnboardingSubmissionDetailResponse:
    if actor.system_role not in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        raise OnboardingPermissionError("You do not have permission to view onboarding reviews.")
    bundle = get_submission_with_user_and_profile(db_session, submission_id)
    if bundle is None:
        raise OnboardingNotFoundError("Submission not found.")
    submission, owner, _profile = bundle
    if owner.system_role != SystemRole.EMPLOYEE:
        raise OnboardingNotFoundError("Submission not found.")
    if not can_admin_review_user(actor, owner):
        raise OnboardingNotFoundError("Submission not found.")
    docs = list_documents_for_submission(db_session, submission.id)
    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="onboarding.review_detail_viewed",
        entity_type="onboarding_submission",
        entity_id=str(submission.id),
        company_id=submission.company_id,
        details={"subject_user_id": str(owner.id)},
    )
    return submission_to_detail(submission, docs, account_email=owner.email)


def _assert_can_print_onboarding_submission(actor: User, submission: OnboardingSubmission, owner: User) -> None:
    if is_submission_owner(actor, submission):
        if submission.status == "draft":
            raise OnboardingPermissionError("Submit your starter form before printing.")
        return
    if actor.system_role not in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        raise OnboardingPermissionError("You do not have permission to print this submission.")
    if owner.system_role != SystemRole.EMPLOYEE or not can_admin_review_user(actor, owner):
        raise OnboardingPermissionError("You do not have permission to print this submission.")


def _signature_image_data_url(signature_path: str | None) -> tuple[str | None, str | None]:
    if not signature_path:
        return None, None
    try:
        backend = get_storage_backend()
        if not backend.exists(signature_path):
            return None, "Signature file unavailable"
        data = backend.read_bytes(signature_path)
    except Exception:
        return None, "Signature file unavailable"
    if len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n":
        media = "image/png"
    elif len(data) >= 3 and data[:3] == b"\xff\xd8\xff":
        media = "image/jpeg"
    else:
        return None, "Signature file unavailable"
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{media};base64,{encoded}", None


def render_submission_print_html(db_session: Session, actor: User, submission_id: uuid.UUID) -> str:
    bundle = get_submission_with_user_and_profile(db_session, submission_id)
    if bundle is None:
        raise OnboardingNotFoundError("Submission not found.")
    submission, owner, profile = bundle
    _assert_can_print_onboarding_submission(actor, submission, owner)
    docs = list_documents_for_submission(db_session, submission.id)
    company = get_company_by_id(db_session, submission.company_id) if submission.company_id else None
    company_esc = html.escape(company.name if company else "Company")

    name_parts: list[str] = []
    if profile is not None:
        if profile.first_name:
            name_parts.append(profile.first_name)
        if profile.last_name:
            name_parts.append(profile.last_name)
    employee_name = html.escape(" ".join(name_parts).strip() or (owner.email or "Employee"))

    form = dict(submission.form_payload or {})
    form_rows: list[str] = []
    for key in sorted(form.keys()):
        raw = form[key]
        if isinstance(raw, (dict, list)):
            val = html.escape(json.dumps(raw, ensure_ascii=False))
        else:
            val = html.escape(str(raw))
        form_rows.append(f"<tr><th>{html.escape(str(key))}</th><td>{val}</td></tr>")

    doc_rows: list[str] = []
    for d in docs:
        doc_rows.append(
            "<tr>"
            f"<td>{html.escape(d.doc_type)}</td>"
            f"<td>{html.escape(d.original_filename)}</td>"
            f"<td>{html.escape(d.content_type)}</td>"
            f"<td>{d.file_size_bytes}</td>"
            "</tr>",
        )

    signature_data_url, signature_error = _signature_image_data_url(submission.signature_image_path)
    sig_mode = html.escape((submission.signature_mode or "").strip() or "—")
    typed_raw = (submission.signature_typed_text or "").strip() or str(form.get("signature_name", "")).strip()
    typed = html.escape(typed_raw)
    contract_raw = submission.form_payload.get("contract_version") or ONBOARDING_CONTRACT_VERSION
    contract = html.escape(_contract_version_display(contract_raw))
    accepted_label = _contract_accepted_display(form)
    submitted_label = html.escape(_format_document_datetime(submission.submitted_at))
    generated_label = html.escape(_format_document_datetime(_utc_now()))
    signature_body = ""
    if signature_data_url:
        signature_body = (
            '<div class="signature-image-wrap">'
            f'<img class="signature-image" src="{signature_data_url}" alt="Employee signature"/>'
            "</div>"
        )
    elif signature_error:
        signature_body = f'<p class="signature-missing">{html.escape(signature_error)}</p>'
    else:
        signature_body = '<p class="signature-missing">Not provided</p>'
    typed_line = f"<p><strong>Typed / signatory name:</strong> {typed}</p>" if typed_raw else ""

    html_out = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Starter form — {employee_name}</title>
<style>
* {{ box-sizing: border-box; }}
body {{ background: #f5f7fb; color: #111827; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 28px; }}
.document {{ background: #fff; border: 1px solid #d9e0ea; border-radius: 14px; margin: 0 auto; max-width: 980px; padding: 28px; }}
.header {{ border-bottom: 1px solid #e5e7eb; display: grid; gap: 18px; grid-template-columns: minmax(0, 1fr) minmax(280px, 0.85fr); padding-bottom: 18px; }}
h1 {{ font-size: 1.45rem; margin: 0; }}
.title {{ font-size: 1.15rem; font-weight: 800; text-align: right; }}
.meta-grid {{ display: grid; gap: 10px 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 16px; }}
.meta-item {{ background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 12px; }}
.label {{ color: #64748b; display: block; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }}
.value {{ display: block; font-size: 0.92rem; font-weight: 700; margin-top: 3px; }}
h2 {{ color: #111827; font-size: 1rem; margin: 1.35rem 0 0.55rem; }}
table {{ border-collapse: collapse; width: 100%; margin-top: 8px; }}
th, td {{ border: 1px solid #d7dde5; padding: 7px 9px; text-align: left; font-size: 0.875rem; vertical-align: top; }}
th {{ background: #f8fafc; width: 28%; }}
.signature-panel {{ border: 1px solid #d7dde5; border-radius: 12px; padding: 14px; }}
.signature-image-wrap {{ background: #fff; border: 1px solid #cbd5e1; border-radius: 10px; margin: 10px 0; min-height: 110px; padding: 10px; }}
.signature-image {{ display: block; max-height: 145px; max-width: 360px; object-fit: contain; }}
.signature-missing {{ background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; color: #9a3412; padding: 10px; }}
@media print {{ body {{ background: #fff; padding: 0; }} .document {{ border: none; border-radius: 0; max-width: none; }} }}
</style></head><body>
<main class="document">
<header class="header">
  <div>
    <h1>{company_esc}</h1>
    <p><strong>Employee:</strong> {employee_name} ({html.escape(owner.email or "")})</p>
  </div>
  <div>
    <div class="title">Starter Form / Onboarding Contract</div>
  </div>
</header>
<section class="meta-grid">
  <div class="meta-item"><span class="label">Company</span><span class="value">{company_esc}</span></div>
  <div class="meta-item"><span class="label">Employee</span><span class="value">{employee_name} ({html.escape(owner.email or "")})</span></div>
  <div class="meta-item"><span class="label">Status</span><span class="value">{html.escape(submission.status)}</span></div>
  <div class="meta-item"><span class="label">Submitted</span><span class="value">{submitted_label}</span></div>
  <div class="meta-item"><span class="label">Contract accepted</span><span class="value">{accepted_label}</span></div>
  <div class="meta-item"><span class="label">Contract version</span><span class="value">{contract}</span></div>
  <div class="meta-item"><span class="label">Generated</span><span class="value">{generated_label}</span></div>
</section>

<h2>Employee signature</h2>
<section class="signature-panel">
  <p><strong>Signature mode:</strong> {sig_mode}</p>
  {typed_line}
  {signature_body}
</section>

<h2>Documents</h2>
<table><thead><tr><th>Type</th><th>Filename</th><th>Content type</th><th>Size (bytes)</th></tr></thead><tbody>
{"".join(doc_rows) if doc_rows else "<tr><td colspan=4>No documents</td></tr>"}
</tbody></table>

<h2>Form responses</h2>
<table><tbody>
{"".join(form_rows) if form_rows else "<tr><td colspan=2>No form data</td></tr>"}
</tbody></table>
</main>
</body></html>"""

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="onboarding.submission_printed",
        entity_type="onboarding_submission",
        entity_id=str(submission.id),
        company_id=submission.company_id,
        details={
            "export_type": "print_html",
            "subject_user_id": str(owner.id),
        },
    )
    return html_out


def resolve_document_download(
    db_session: Session,
    actor: User,
    document_id: uuid.UUID,
) -> tuple[bytes, OnboardingDocument, OnboardingSubmission, User]:
    doc = get_document_by_id(db_session, document_id)
    if doc is None:
        raise OnboardingNotFoundError("Document not found.")
    submission = get_submission_by_id(db_session, doc.submission_id)
    if submission is None:
        raise OnboardingNotFoundError("Document not found.")
    owner = get_user_by_id(db_session, submission.user_id)
    if owner is None:
        raise OnboardingNotFoundError("Document not found.")
    if not can_access_document_file(actor, submission, doc, owner):
        raise OnboardingNotFoundError("Document not found.")
    backend = get_storage_backend()
    if not backend.exists(doc.storage_path):
        raise OnboardingNotFoundError("Document not found.")
    data = backend.read_bytes(doc.storage_path)
    return data, doc, submission, owner


def download_document_file(
    db_session: Session,
    actor: User,
    document_id: uuid.UUID,
) -> tuple[bytes, OnboardingDocument, OnboardingSubmission, User]:
    data, doc, submission, owner = resolve_document_download(db_session, actor, document_id)
    if actor.system_role in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR) and actor.id != owner.id:
        create_internal_audit_event(
            db_session=db_session,
            actor=actor,
            action="onboarding.document_downloaded",
            entity_type="onboarding_document",
            entity_id=str(doc.id),
            company_id=submission.company_id,
            details={
                "submission_id": str(submission.id),
                "doc_type": doc.doc_type,
                "subject_user_id": str(owner.id),
            },
        )
    return data, doc, submission, owner


def resolve_signature_image_download(
    db_session: Session,
    actor: User,
    submission_id: uuid.UUID,
) -> tuple[bytes, OnboardingSubmission, User]:
    submission = get_submission_by_id(db_session, submission_id)
    if submission is None:
        raise OnboardingNotFoundError("Submission not found.")
    owner = get_user_by_id(db_session, submission.user_id)
    if owner is None:
        raise OnboardingNotFoundError("Submission not found.")
    if not can_access_signature_image(actor, submission, owner):
        raise OnboardingNotFoundError("Submission not found.")
    if not submission.signature_image_path:
        raise OnboardingNotFoundError("No drawn signature on file.")
    backend = get_storage_backend()
    if not backend.exists(submission.signature_image_path):
        raise OnboardingNotFoundError("Signature file not found.")
    data = backend.read_bytes(submission.signature_image_path)
    return data, submission, owner


def download_signature_image(
    db_session: Session,
    actor: User,
    submission_id: uuid.UUID,
) -> tuple[bytes, OnboardingSubmission, User]:
    data, submission, owner = resolve_signature_image_download(db_session, actor, submission_id)
    if actor.system_role in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR) and actor.id != owner.id:
        create_internal_audit_event(
            db_session=db_session,
            actor=actor,
            action="onboarding.signature_image_downloaded",
            entity_type="onboarding_submission",
            entity_id=str(submission.id),
            company_id=submission.company_id,
            details={"subject_user_id": str(owner.id)},
        )
    return data, submission, owner


def resolve_profile_photo_file_download(
    db_session: Session,
    actor: User,
    subject_user_id: uuid.UUID,
) -> tuple[bytes, OnboardingSubmission, User]:
    submission = get_submission_by_user_id(db_session, subject_user_id)
    if submission is None or not submission.profile_photo_storage_path:
        raise OnboardingNotFoundError("Profile photo not found.")
    owner = get_user_by_id(db_session, subject_user_id)
    if owner is None:
        raise OnboardingNotFoundError("Profile photo not found.")
    if not can_access_profile_photo_file(actor, owner):
        raise OnboardingNotFoundError("Profile photo not found.")
    backend = get_storage_backend()
    if not backend.exists(submission.profile_photo_storage_path):
        raise OnboardingNotFoundError("Profile photo not found.")
    data = backend.read_bytes(submission.profile_photo_storage_path)
    return data, submission, owner


def download_profile_photo_file(
    db_session: Session,
    actor: User,
    subject_user_id: uuid.UUID,
) -> tuple[bytes, OnboardingSubmission, User]:
    data, submission, owner = resolve_profile_photo_file_download(
        db_session,
        actor,
        subject_user_id,
    )
    if actor.system_role in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR) and actor.id != owner.id:
        create_internal_audit_event(
            db_session=db_session,
            actor=actor,
            action="onboarding.profile_photo_viewed",
            entity_type="onboarding_submission",
            entity_id=str(submission.id),
            company_id=submission.company_id,
            details={"subject_user_id": str(owner.id)},
        )
    return data, submission, owner


def _apply_form_to_profile(profile: EmployeeProfile, form: dict[str, Any]) -> None:
    profile.first_name = str(form.get("first_name", "")).strip() or None
    profile.last_name = str(form.get("last_name", "")).strip() or None
    profile.phone = str(form.get("phone", "")).strip() or None
    position = str(form.get("position", "")).strip()
    job_free = str(form.get("job_title", "")).strip()
    profile.job_title = position or job_free or None
    profile.national_insurance_number = sanitize_national_insurance_value(form.get("national_insurance_number"))
    profile.utr_number = sanitize_utr_value(form.get("utr"))
    profile.emergency_contact_name = str(form.get("emergency_contact_name", "")).strip() or None
    profile.emergency_contact_phone = str(form.get("emergency_contact_phone", "")).strip() or None
    start_raw = str(form.get("start_date", "")).strip()
    if start_raw:
        profile.start_date = _parse_start_date(start_raw)
    else:
        profile.start_date = None


def approve_submission(
    db_session: Session,
    actor: User,
    submission_id: uuid.UUID,
    reason: str,
) -> OnboardingSubmissionDetailResponse:
    if actor.system_role not in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        raise OnboardingPermissionError("You do not have permission to approve onboarding.")
    bundle = get_submission_with_user_and_profile(db_session, submission_id)
    if bundle is None:
        raise OnboardingNotFoundError("Submission not found.")
    submission, owner, _profile_row = bundle
    if owner.system_role != SystemRole.EMPLOYEE:
        raise OnboardingNotFoundError("Submission not found.")
    if not can_manage_user(actor, owner):
        raise OnboardingNotFoundError("Submission not found.")
    if submission.status != "submitted":
        raise OnboardingStateError("Only a submitted application can be approved.")

    profile = get_employee_profile_by_user_id(db_session, owner.id)
    if profile is None:
        profile = EmployeeProfile(
            user_id=owner.id,
            company_id=owner.company_id,
        )
        db_session.add(profile)
    if profile.company_id is None and owner.company_id is not None:
        profile.company_id = owner.company_id
    _apply_form_to_profile(profile, dict(submission.form_payload or {}))
    profile.is_onboarded = True

    submission.status = "approved"
    submission.reviewed_at = _utc_now()
    submission.reviewed_by_user_id = actor.id
    submission.review_note = reason.strip()

    save_submission_no_commit(db_session, submission)
    db_session.add(profile)
    db_session.commit()
    db_session.refresh(submission)

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="onboarding.approved",
        entity_type="onboarding_submission",
        entity_id=str(submission.id),
        company_id=submission.company_id,
        details={
            "subject_user_id": str(owner.id),
            "reason": submission.review_note,
        },
    )
    docs = list_documents_for_submission(db_session, submission.id)
    return submission_to_detail(submission, docs, account_email=owner.email)


def reject_submission(
    db_session: Session,
    actor: User,
    submission_id: uuid.UUID,
    reason: str,
) -> OnboardingSubmissionDetailResponse:
    if actor.system_role not in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        raise OnboardingPermissionError("You do not have permission to reject onboarding.")
    bundle = get_submission_with_user_and_profile(db_session, submission_id)
    if bundle is None:
        raise OnboardingNotFoundError("Submission not found.")
    submission, owner, _profile_row = bundle
    if owner.system_role != SystemRole.EMPLOYEE:
        raise OnboardingNotFoundError("Submission not found.")
    if not can_manage_user(actor, owner):
        raise OnboardingNotFoundError("Submission not found.")
    if submission.status != "submitted":
        raise OnboardingStateError("Only a submitted application can be rejected.")

    submission.status = "rejected"
    submission.reviewed_at = _utc_now()
    submission.reviewed_by_user_id = actor.id
    submission.review_note = reason.strip()
    save_submission(db_session, submission)

    create_internal_audit_event(
        db_session=db_session,
        actor=actor,
        action="onboarding.rejected",
        entity_type="onboarding_submission",
        entity_id=str(submission.id),
        company_id=submission.company_id,
        details={
            "subject_user_id": str(owner.id),
            "reason": submission.review_note,
        },
    )
    docs = list_documents_for_submission(db_session, submission.id)
    return submission_to_detail(submission, docs, account_email=owner.email)
