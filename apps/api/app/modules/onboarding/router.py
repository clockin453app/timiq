import mimetypes
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response

from app.core.storage.file_response import protected_file_response
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import get_current_user, require_admin_or_administrator
from app.modules.auth.models import User
from app.modules.onboarding.schemas import (
    OnboardingDraftPatchRequest,
    OnboardingReviewListResponse,
    OnboardingReviewReasonBody,
    OnboardingSubmissionDetailResponse,
    OnboardingTypedSignatureBody,
)
from app.modules.onboarding.service import (
    OnboardingNotFoundError,
    OnboardingPermissionError,
    OnboardingStateError,
    OnboardingValidationError,
    approve_submission,
    clear_my_signature,
    delete_my_document,
    delete_my_profile_photo,
    download_document_file,
    download_profile_photo_file,
    download_signature_image,
    get_or_create_my_submission,
    get_review_submission_detail,
    list_review_submissions,
    patch_my_draft,
    reject_submission,
    render_submission_print_html,
    reopen_my_submission,
    set_my_drawn_signature,
    set_my_typed_signature,
    submit_my_submission,
    upload_my_document,
    upload_my_profile_photo,
)

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])

NOT_FOUND = "Not found."


def _read_upload_file(upload: UploadFile) -> tuple[str, str, bytes]:
    raw = upload.file.read()
    filename = upload.filename or "upload"
    content_type = upload.content_type or "application/octet-stream"
    return filename, content_type, raw


@router.get("/me", response_model=OnboardingSubmissionDetailResponse)
def read_my_onboarding(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> OnboardingSubmissionDetailResponse:
    try:
        return get_or_create_my_submission(db_session, current_user)
    except OnboardingPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.patch("/me/draft", response_model=OnboardingSubmissionDetailResponse)
def patch_my_onboarding_draft(
    body: OnboardingDraftPatchRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> OnboardingSubmissionDetailResponse:
    try:
        return patch_my_draft(db_session, current_user, body.form_payload)
    except OnboardingStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except OnboardingValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/me/reopen", response_model=OnboardingSubmissionDetailResponse)
def reopen_my_onboarding(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> OnboardingSubmissionDetailResponse:
    try:
        return reopen_my_submission(db_session, current_user)
    except OnboardingNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None
    except OnboardingPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except OnboardingStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/me/documents", response_model=OnboardingSubmissionDetailResponse)
async def post_my_onboarding_document(
    doc_type: str = Form(...),
    file: UploadFile = File(...),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> OnboardingSubmissionDetailResponse:
    filename, content_type, raw = _read_upload_file(file)
    try:
        return upload_my_document(
            db_session,
            current_user,
            doc_type=doc_type.strip(),
            original_filename=filename,
            content_type=content_type,
            file_bytes=raw,
        )
    except OnboardingValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except OnboardingStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/me/documents/{document_id}", response_model=OnboardingSubmissionDetailResponse)
def remove_my_onboarding_document(
    document_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> OnboardingSubmissionDetailResponse:
    try:
        return delete_my_document(db_session, current_user, document_id)
    except OnboardingNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None
    except OnboardingStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/me/signature/typed", response_model=OnboardingSubmissionDetailResponse)
def post_my_typed_signature(
    body: OnboardingTypedSignatureBody,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> OnboardingSubmissionDetailResponse:
    try:
        return set_my_typed_signature(db_session, current_user, body.text)
    except OnboardingValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except OnboardingNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None
    except OnboardingStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/me/signature/drawn", response_model=OnboardingSubmissionDetailResponse)
async def post_my_drawn_signature(
    file: UploadFile = File(...),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> OnboardingSubmissionDetailResponse:
    _filename, content_type, raw = _read_upload_file(file)
    try:
        return set_my_drawn_signature(db_session, current_user, content_type, raw)
    except OnboardingValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except OnboardingStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/me/signature", response_model=OnboardingSubmissionDetailResponse)
def delete_my_signature(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> OnboardingSubmissionDetailResponse:
    try:
        return clear_my_signature(db_session, current_user)
    except OnboardingNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None
    except OnboardingStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/me/profile-photo", response_model=OnboardingSubmissionDetailResponse)
async def post_my_onboarding_profile_photo(
    file: UploadFile = File(...),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> OnboardingSubmissionDetailResponse:
    _filename, content_type, raw = _read_upload_file(file)
    try:
        return upload_my_profile_photo(db_session, current_user, content_type, raw)
    except OnboardingValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except OnboardingStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.delete("/me/profile-photo", response_model=OnboardingSubmissionDetailResponse)
def delete_my_onboarding_profile_photo(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> OnboardingSubmissionDetailResponse:
    try:
        return delete_my_profile_photo(db_session, current_user)
    except OnboardingNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None
    except OnboardingStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/me/submit", response_model=OnboardingSubmissionDetailResponse)
def post_my_onboarding_submit(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> OnboardingSubmissionDetailResponse:
    try:
        return submit_my_submission(db_session, current_user)
    except OnboardingNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None
    except OnboardingPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except OnboardingStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except OnboardingValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/review", response_model=OnboardingReviewListResponse)
def get_onboarding_review_list(
    status_filter: str | None = Query(default=None, alias="status"),
    company_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> OnboardingReviewListResponse:
    try:
        return list_review_submissions(
            db_session,
            current_user,
            status_filter=status_filter,
            company_id=company_id,
            limit=limit,
            offset=offset,
        )
    except OnboardingPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.get("/review/{submission_id}", response_model=OnboardingSubmissionDetailResponse)
def get_onboarding_review_detail(
    submission_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> OnboardingSubmissionDetailResponse:
    try:
        return get_review_submission_detail(db_session, current_user, submission_id)
    except OnboardingNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None
    except OnboardingPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.post("/review/{submission_id}/approve", response_model=OnboardingSubmissionDetailResponse)
def post_onboarding_approve(
    submission_id: uuid.UUID,
    body: OnboardingReviewReasonBody,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> OnboardingSubmissionDetailResponse:
    try:
        return approve_submission(db_session, current_user, submission_id, body.reason)
    except OnboardingNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None
    except OnboardingPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except OnboardingStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/review/{submission_id}/reject", response_model=OnboardingSubmissionDetailResponse)
def post_onboarding_reject(
    submission_id: uuid.UUID,
    body: OnboardingReviewReasonBody,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> OnboardingSubmissionDetailResponse:
    try:
        return reject_submission(db_session, current_user, submission_id, body.reason)
    except OnboardingNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None
    except OnboardingPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except OnboardingStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/submissions/{submission_id}/print")
def get_onboarding_submission_print(
    submission_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    try:
        body = render_submission_print_html(db_session, current_user, submission_id)
    except OnboardingNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None
    except OnboardingPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from None
    return Response(
        content=body,
        media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": f'inline; filename="onboarding-{submission_id}.html"'},
    )


@router.get("/documents/{document_id}/file")
def get_onboarding_document_file(
    document_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    try:
        data, doc, _submission, _owner = download_document_file(
            db_session,
            current_user,
            document_id,
        )
    except OnboardingNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None
    except OnboardingPermissionError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None

    return protected_file_response(
        body=data,
        media_type=doc.content_type,
        download_filename=doc.original_filename,
    )


@router.get("/profile-photo/{user_id}/file")
def get_onboarding_profile_photo_file(
    user_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    try:
        data, submission, _owner = download_profile_photo_file(
            db_session,
            current_user,
            user_id,
        )
    except OnboardingNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None
    except OnboardingPermissionError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None

    media_type = submission.profile_photo_content_type or mimetypes.guess_type("profile.jpg")[0]
    return protected_file_response(
        body=data,
        media_type=media_type or "application/octet-stream",
        download_filename=f"profile-photo-{user_id}",
    )


@router.get("/submissions/{submission_id}/signature-image")
def get_onboarding_signature_image(
    submission_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    try:
        data, submission, _owner = download_signature_image(
            db_session,
            current_user,
            submission_id,
        )
    except OnboardingNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None
    except OnboardingPermissionError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None

    guessed, _ = mimetypes.guess_type("signature.png")
    return protected_file_response(
        body=data,
        media_type=guessed or "application/octet-stream",
        download_filename="signature.png",
    )
