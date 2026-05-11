import uuid
from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import get_current_user, require_admin_or_administrator
from app.modules.auth.models import User
from app.modules.work_progress.schemas import (
    WorkProgressAcknowledgeBody,
    WorkProgressBulkFileIdsBody,
    WorkProgressCommentBody,
    WorkProgressCreateRequest,
    WorkProgressEntryDetailResponse,
    WorkProgressMeListResponse,
    WorkProgressMeOptionsResponse,
    WorkProgressReviewAttachmentGalleryResponse,
    WorkProgressReviewDetailResponse,
    WorkProgressReviewListResponse,
)
from app.modules.work_progress.service import (
    WorkProgressNotFoundError,
    WorkProgressPermissionError,
    WorkProgressStateError,
    WorkProgressValidationError,
    acknowledge_review,
    add_review_comment,
    bulk_delete_review_attachments,
    bulk_download_review_attachments_zip,
    create_my_entry,
    download_work_progress_file,
    get_me_options,
    get_my_entry_detail,
    get_review_detail,
    list_my_entries,
    list_review,
    list_review_attachment_gallery,
    upload_my_entry_file,
    work_progress_attachment_response_filename,
    work_progress_attachment_response_media_type,
)

router = APIRouter(prefix="/api/work-progress", tags=["work_progress"])

NOT_FOUND = "Not found."


def _read_upload_file(upload: UploadFile) -> tuple[str, str, bytes]:
    raw = upload.file.read()
    filename = upload.filename or "upload"
    content_type = upload.content_type or "application/octet-stream"
    return filename, content_type, raw


@router.get("/me/options", response_model=WorkProgressMeOptionsResponse)
def get_work_progress_me_options(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> WorkProgressMeOptionsResponse:
    return get_me_options(db_session, current_user)


@router.get("/me", response_model=WorkProgressMeListResponse)
def get_work_progress_me_list(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> WorkProgressMeListResponse:
    return list_my_entries(db_session, current_user, limit=limit, offset=offset)


@router.post("/me", response_model=WorkProgressEntryDetailResponse, status_code=status.HTTP_201_CREATED)
def post_work_progress_me(
    body: WorkProgressCreateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> WorkProgressEntryDetailResponse:
    try:
        return create_my_entry(db_session, current_user, body)
    except WorkProgressValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/me/{progress_id}", response_model=WorkProgressEntryDetailResponse)
def get_work_progress_me_detail(
    progress_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> WorkProgressEntryDetailResponse:
    try:
        return get_my_entry_detail(db_session, current_user, progress_id)
    except WorkProgressNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None


@router.post("/me/{progress_id}/files", response_model=WorkProgressEntryDetailResponse)
async def post_work_progress_me_file(
    progress_id: uuid.UUID,
    file: UploadFile = File(...),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> WorkProgressEntryDetailResponse:
    filename, content_type, raw = _read_upload_file(file)
    try:
        return upload_my_entry_file(
            db_session,
            current_user,
            progress_id,
            original_filename=filename,
            content_type=content_type,
            file_bytes=raw,
        )
    except WorkProgressNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None
    except WorkProgressValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/review", response_model=WorkProgressReviewListResponse)
def get_work_progress_review_list(
    company_id: uuid.UUID | None = Query(default=None),
    user_id: uuid.UUID | None = Query(default=None),
    location_id: uuid.UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    title_search: str | None = Query(default=None, max_length=300),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> WorkProgressReviewListResponse:
    try:
        return list_review(
            db_session,
            current_user,
            company_id=company_id,
            user_id=user_id,
            location_id=location_id,
            status_filter=status,
            date_from=date_from,
            date_to=date_to,
            title_search=title_search,
            limit=limit,
            offset=offset,
        )
    except WorkProgressPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except WorkProgressValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/review/attachments/gallery", response_model=WorkProgressReviewAttachmentGalleryResponse)
def get_work_progress_review_attachment_gallery(
    company_id: uuid.UUID | None = Query(default=None),
    user_id: uuid.UUID | None = Query(default=None),
    location_id: uuid.UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    title_search: str | None = Query(default=None, max_length=300),
    limit: int = Query(default=48, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> WorkProgressReviewAttachmentGalleryResponse:
    try:
        return list_review_attachment_gallery(
            db_session,
            current_user,
            company_id=company_id,
            user_id=user_id,
            location_id=location_id,
            status_filter=status,
            date_from=date_from,
            date_to=date_to,
            title_search=title_search,
            limit=limit,
            offset=offset,
        )
    except WorkProgressPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except WorkProgressValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/review/attachments/bulk-download")
def post_work_progress_review_attachments_bulk_download(
    body: WorkProgressBulkFileIdsBody,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    try:
        data = bulk_download_review_attachments_zip(db_session, current_user, body.file_ids)
    except WorkProgressPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except WorkProgressNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None
    headers = {"Content-Disposition": 'attachment; filename="work-progress-attachments.zip"'}
    return Response(content=data, media_type="application/zip", headers=headers)


@router.post("/review/attachments/bulk-delete", status_code=status.HTTP_204_NO_CONTENT)
def post_work_progress_review_attachments_bulk_delete(
    body: WorkProgressBulkFileIdsBody,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> Response:
    try:
        bulk_delete_review_attachments(db_session, current_user, body.file_ids)
    except WorkProgressPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except WorkProgressNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None
    except WorkProgressValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/review/{progress_id}", response_model=WorkProgressReviewDetailResponse)
def get_work_progress_review_detail(
    progress_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> WorkProgressReviewDetailResponse:
    try:
        return get_review_detail(db_session, current_user, progress_id)
    except WorkProgressNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None


@router.post("/review/{progress_id}/acknowledge", response_model=WorkProgressReviewDetailResponse)
def post_work_progress_acknowledge(
    progress_id: uuid.UUID,
    body: WorkProgressAcknowledgeBody,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> WorkProgressReviewDetailResponse:
    try:
        return acknowledge_review(db_session, current_user, progress_id, body.note)
    except WorkProgressNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None
    except WorkProgressStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/review/{progress_id}/comment", response_model=WorkProgressReviewDetailResponse)
def post_work_progress_review_comment(
    progress_id: uuid.UUID,
    body: WorkProgressCommentBody,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> WorkProgressReviewDetailResponse:
    try:
        return add_review_comment(db_session, current_user, progress_id, body.comment)
    except WorkProgressNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None
    except WorkProgressStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/files/{file_id}/file")
def get_work_progress_file(
    file_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> FileResponse:
    try:
        path, att = download_work_progress_file(db_session, current_user, file_id)
    except WorkProgressNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND) from None

    return FileResponse(
        path,
        media_type=work_progress_attachment_response_media_type(att),
        filename=work_progress_attachment_response_filename(att),
    )
