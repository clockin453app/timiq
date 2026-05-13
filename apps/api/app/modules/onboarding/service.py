import uuid
from datetime import date, datetime, timezone
from pathlib import Path
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

REQUIRED_FORM_KEYS = (
    "first_name",
    "last_name",
    "phone",
    "emergency_contact_name",
    "emergency_contact_phone",
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
    backend = get_storage_backend()
    path = backend.build_path(relative_path)
    path.unlink(missing_ok=True)


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


def _write_binary_file(relative_path: str, file_bytes: bytes) -> Path:
    backend = get_storage_backend()
    absolute_path = backend.build_path(relative_path)
    absolute_path.parent.mkdir(parents=True, exist_ok=True)
    absolute_path.write_bytes(file_bytes)
    return absolute_path


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


def submission_to_detail(
    submission: OnboardingSubmission,
    documents: list[OnboardingDocument],
) -> OnboardingSubmissionDetailResponse:
    return OnboardingSubmissionDetailResponse(
        id=submission.id,
        user_id=submission.user_id,
        company_id=submission.company_id,
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
    return submission_to_detail(row, docs)


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
    return submission_to_detail(row, docs)


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
    return submission_to_detail(row, docs)


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
    return submission_to_detail(row, docs)


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
    return submission_to_detail(row, docs)


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
    return submission_to_detail(row, docs)


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
    return submission_to_detail(row, docs)


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
    return submission_to_detail(row, docs)


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
    return submission_to_detail(row, docs)


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
    return submission_to_detail(row, docs)


def _validate_ready_to_submit(submission: OnboardingSubmission, documents: list[OnboardingDocument]) -> None:
    form = dict(submission.form_payload or {})
    for key in REQUIRED_FORM_KEYS:
        if not str(form.get(key, "")).strip():
            raise OnboardingValidationError(f"Missing required field: {key}.")
    slots = {d.doc_type for d in documents}
    for req in REQUIRED_DOC_TYPES:
        if req not in slots:
            raise OnboardingValidationError(f"Missing required document upload: {req}.")
    if submission.signature_mode == "typed":
        if not (submission.signature_typed_text or "").strip():
            raise OnboardingValidationError("Typed signature is required.")
    elif submission.signature_mode == "drawn":
        if not submission.signature_image_path:
            raise OnboardingValidationError("Drawn signature image is required.")
    else:
        raise OnboardingValidationError("Choose a typed or drawn signature before submitting.")

    start_raw = str(form.get("start_date", "")).strip()
    if start_raw:
        try:
            _parse_start_date(start_raw)
        except ValueError as exc:
            raise OnboardingValidationError("start_date must be a valid ISO date (YYYY-MM-DD).") from exc


def submit_my_submission(db_session: Session, actor: User) -> OnboardingSubmissionDetailResponse:
    row = get_submission_by_user_id(db_session, actor.id)
    if row is None:
        raise OnboardingNotFoundError("No onboarding record found.")
    if not is_submission_owner(actor, row):
        raise OnboardingPermissionError("You cannot submit this onboarding record.")
    if row.status != "draft":
        raise OnboardingStateError("Only a draft can be submitted.")
    docs = list_documents_for_submission(db_session, row.id)
    _validate_ready_to_submit(row, docs)
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
    return submission_to_detail(row, docs)


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
    return submission_to_detail(submission, docs)


def resolve_document_download(
    db_session: Session,
    actor: User,
    document_id: uuid.UUID,
) -> tuple[Path, OnboardingDocument, OnboardingSubmission, User]:
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
    path = backend.build_path(doc.storage_path)
    if not path.is_file():
        raise OnboardingNotFoundError("Document not found.")
    return path, doc, submission, owner


def download_document_file(
    db_session: Session,
    actor: User,
    document_id: uuid.UUID,
) -> tuple[Path, OnboardingDocument, OnboardingSubmission, User]:
    path, doc, submission, owner = resolve_document_download(db_session, actor, document_id)
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
    return path, doc, submission, owner


def resolve_signature_image_download(
    db_session: Session,
    actor: User,
    submission_id: uuid.UUID,
) -> tuple[Path, OnboardingSubmission, User]:
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
    path = backend.build_path(submission.signature_image_path)
    if not path.is_file():
        raise OnboardingNotFoundError("Signature file not found.")
    return path, submission, owner


def download_signature_image(
    db_session: Session,
    actor: User,
    submission_id: uuid.UUID,
) -> tuple[Path, OnboardingSubmission, User]:
    path, submission, owner = resolve_signature_image_download(db_session, actor, submission_id)
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
    return path, submission, owner


def resolve_profile_photo_file_download(
    db_session: Session,
    actor: User,
    subject_user_id: uuid.UUID,
) -> tuple[Path, OnboardingSubmission, User]:
    submission = get_submission_by_user_id(db_session, subject_user_id)
    if submission is None or not submission.profile_photo_storage_path:
        raise OnboardingNotFoundError("Profile photo not found.")
    owner = get_user_by_id(db_session, subject_user_id)
    if owner is None:
        raise OnboardingNotFoundError("Profile photo not found.")
    if not can_access_profile_photo_file(actor, owner):
        raise OnboardingNotFoundError("Profile photo not found.")
    backend = get_storage_backend()
    path = backend.build_path(submission.profile_photo_storage_path)
    if not path.is_file():
        raise OnboardingNotFoundError("Profile photo not found.")
    return path, submission, owner


def download_profile_photo_file(
    db_session: Session,
    actor: User,
    subject_user_id: uuid.UUID,
) -> tuple[Path, OnboardingSubmission, User]:
    path, submission, owner = resolve_profile_photo_file_download(
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
    return path, submission, owner


def _apply_form_to_profile(profile: EmployeeProfile, form: dict[str, Any]) -> None:
    profile.first_name = str(form.get("first_name", "")).strip() or None
    profile.last_name = str(form.get("last_name", "")).strip() or None
    profile.phone = str(form.get("phone", "")).strip() or None
    profile.job_title = str(form.get("job_title", "")).strip() or None
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
    return submission_to_detail(submission, docs)


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
    return submission_to_detail(submission, docs)
