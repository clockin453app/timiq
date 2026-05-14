import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import (
    get_current_user,
    require_admin_or_administrator,
    require_authenticated_employee,
)
from app.modules.auth.models import User
from app.modules.smart_forms.schemas import (
    SmartFormReviewQueueResponse,
    SmartFormReviewRequest,
    SmartFormSubmissionCreateRequest,
    SmartFormSubmissionPatchRequest,
    SmartFormSubmissionResponse,
    SmartFormSubmissionWithTemplateResponse,
    SmartFormTemplateCreateRequest,
    SmartFormTemplatePatchRequest,
    SmartFormTemplateResponse,
)
from app.modules.smart_forms.service import (
    SmartFormError,
    SmartFormNotFoundError,
    SmartFormPermissionError,
    SmartFormValidationError,
    archive_template,
    create_submission,
    create_template,
    get_submission,
    get_template,
    list_my_submissions,
    list_review_submissions_queue,
    list_templates,
    patch_submission,
    patch_template,
    review_submission,
    submit_submission,
)

router = APIRouter(prefix="/api/smart-forms", tags=["smart_forms"])


def _http_exc(exc: SmartFormError) -> HTTPException:
    if isinstance(exc, SmartFormNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    if isinstance(exc, SmartFormPermissionError):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc) or "Forbidden.")
    if isinstance(exc, SmartFormValidationError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request failed.")


@router.get("/templates", response_model=list[SmartFormTemplateResponse])
def http_list_templates(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee),
) -> list[SmartFormTemplateResponse]:
    return list_templates(db_session, current_user)


@router.post("/templates", response_model=SmartFormTemplateResponse)
def http_create_template(
    body: SmartFormTemplateCreateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> SmartFormTemplateResponse:
    try:
        return create_template(db_session, current_user, body)
    except (SmartFormNotFoundError, SmartFormPermissionError, SmartFormValidationError) as exc:
        raise _http_exc(exc) from exc


@router.get("/templates/{template_id}", response_model=SmartFormTemplateResponse)
def http_get_template(
    template_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee),
) -> SmartFormTemplateResponse:
    try:
        return get_template(db_session, current_user, template_id)
    except SmartFormNotFoundError as exc:
        raise _http_exc(exc) from exc


@router.patch("/templates/{template_id}", response_model=SmartFormTemplateResponse)
def http_patch_template(
    template_id: uuid.UUID,
    body: SmartFormTemplatePatchRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> SmartFormTemplateResponse:
    try:
        return patch_template(db_session, current_user, template_id, body)
    except (SmartFormNotFoundError, SmartFormPermissionError, SmartFormValidationError) as exc:
        raise _http_exc(exc) from exc


@router.post("/templates/{template_id}/archive", response_model=SmartFormTemplateResponse)
def http_archive_template(
    template_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> SmartFormTemplateResponse:
    try:
        return archive_template(db_session, current_user, template_id)
    except (SmartFormNotFoundError, SmartFormPermissionError, SmartFormValidationError) as exc:
        raise _http_exc(exc) from exc


@router.get("/submissions/me", response_model=list[SmartFormSubmissionWithTemplateResponse])
def http_list_my_submissions(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee),
) -> list[SmartFormSubmissionWithTemplateResponse]:
    return list_my_submissions(db_session, current_user)


@router.post(
    "/templates/{template_id}/submissions",
    response_model=SmartFormSubmissionResponse,
    status_code=status.HTTP_201_CREATED,
)
def http_create_submission(
    template_id: uuid.UUID,
    body: SmartFormSubmissionCreateRequest | None = None,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee),
) -> SmartFormSubmissionResponse:
    try:
        return create_submission(
            db_session,
            current_user,
            template_id,
            body or SmartFormSubmissionCreateRequest(),
        )
    except (SmartFormNotFoundError, SmartFormPermissionError, SmartFormValidationError) as exc:
        raise _http_exc(exc) from exc


@router.get("/submissions/{submission_id}", response_model=SmartFormSubmissionWithTemplateResponse)
def http_get_submission(
    submission_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee),
) -> SmartFormSubmissionWithTemplateResponse:
    try:
        return get_submission(db_session, current_user, submission_id)
    except SmartFormNotFoundError as exc:
        raise _http_exc(exc) from exc


@router.patch("/submissions/{submission_id}", response_model=SmartFormSubmissionWithTemplateResponse)
def http_patch_submission(
    submission_id: uuid.UUID,
    body: SmartFormSubmissionPatchRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee),
) -> SmartFormSubmissionWithTemplateResponse:
    try:
        return patch_submission(db_session, current_user, submission_id, body)
    except (SmartFormNotFoundError, SmartFormValidationError) as exc:
        raise _http_exc(exc) from exc


@router.post("/submissions/{submission_id}/submit", response_model=SmartFormSubmissionWithTemplateResponse)
def http_submit_submission(
    submission_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee),
) -> SmartFormSubmissionWithTemplateResponse:
    try:
        return submit_submission(db_session, current_user, submission_id)
    except (SmartFormNotFoundError, SmartFormValidationError) as exc:
        raise _http_exc(exc) from exc


@router.get("/review/submissions", response_model=SmartFormReviewQueueResponse)
def http_review_submissions(
    status_filter: str | None = Query(None, alias="status"),
    company_id: uuid.UUID | None = Query(None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> SmartFormReviewQueueResponse:
    try:
        items = list_review_submissions_queue(
            db_session,
            current_user,
            status_filter=status_filter,
            company_id_filter=company_id,
        )
        return SmartFormReviewQueueResponse(items=items)
    except (SmartFormPermissionError, SmartFormValidationError) as exc:
        raise _http_exc(exc) from exc


@router.post(
    "/review/submissions/{submission_id}/review",
    response_model=SmartFormSubmissionWithTemplateResponse,
)
def http_review_submission(
    submission_id: uuid.UUID,
    body: SmartFormReviewRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> SmartFormSubmissionWithTemplateResponse:
    try:
        return review_submission(db_session, current_user, submission_id, body)
    except (SmartFormNotFoundError, SmartFormPermissionError, SmartFormValidationError) as exc:
        raise _http_exc(exc) from exc
