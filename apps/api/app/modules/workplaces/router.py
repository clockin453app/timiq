import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import require_admin_or_administrator
from app.modules.auth.models import User
from app.modules.workplaces.schemas import (
    WorkplaceCreateRequest,
    WorkplaceResponse,
    WorkplaceStatusUpdateRequest,
    WorkplaceTaxPatchRequest,
)
from app.modules.workplaces.service import (
    WorkplaceCompanyNotFoundError,
    WorkplaceDuplicateError,
    WorkplaceError,
    WorkplaceNotFoundError,
    WorkplacePermissionError,
    create_workplace,
    list_workplaces_visible_to_user,
    patch_workplace_tax_rate,
    update_workplace_status,
)

router = APIRouter(prefix="/api/workplaces", tags=["workplaces"])


@router.get("", response_model=list[WorkplaceResponse])
def get_workplaces(
    company_id: uuid.UUID | None = Query(
        default=None,
        description="Required for administrators; ignored for company admins (own company enforced).",
    ),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[WorkplaceResponse]:
    try:
        workplaces = list_workplaces_visible_to_user(
            db_session,
            current_user,
            company_id=company_id,
        )
    except WorkplaceError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return [WorkplaceResponse.model_validate(workplace) for workplace in workplaces]


@router.post("", response_model=WorkplaceResponse, status_code=status.HTTP_201_CREATED)
def create_managed_workplace(
    request: WorkplaceCreateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> WorkplaceResponse:
    try:
        workplace = create_workplace(
            db_session=db_session,
            actor=current_user,
            company_id=request.company_id,
            name=request.name,
            code=request.code,
            address=request.address,
            is_active=request.is_active,
        )
    except WorkplaceDuplicateError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A workplace with this name already exists for this company.",
        ) from exc
    except WorkplacePermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except WorkplaceCompanyNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found.",
        ) from exc

    return WorkplaceResponse.model_validate(workplace)


@router.patch("/{workplace_id}/tax", response_model=WorkplaceResponse)
def update_workplace_tax_route(
    workplace_id: uuid.UUID,
    request: WorkplaceTaxPatchRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> WorkplaceResponse:
    try:
        rate = float(request.tax_rate) if request.tax_rate is not None else None
        workplace = patch_workplace_tax_rate(
            db_session,
            current_user,
            workplace_id,
            rate,
        )
    except WorkplaceNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workplace not found.",
        ) from exc
    except WorkplacePermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

    return WorkplaceResponse.model_validate(workplace)


@router.patch("/{workplace_id}/status", response_model=WorkplaceResponse)
def update_managed_workplace_status(
    workplace_id: uuid.UUID,
    request: WorkplaceStatusUpdateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> WorkplaceResponse:
    try:
        workplace = update_workplace_status(
            db_session=db_session,
            actor=current_user,
            workplace_id=workplace_id,
            is_active=request.is_active,
        )
    except WorkplaceNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workplace not found.",
        ) from exc
    except WorkplacePermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

    return WorkplaceResponse.model_validate(workplace)
