from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.audit.schemas import AuditEventCreateRequest, AuditEventResponse
from app.modules.audit.service import (
    AuditPermissionError,
    create_audit_event,
    get_audit_events_visible_to_user,
)
from app.modules.auth.dependencies import get_current_user, require_admin_or_administrator
from app.modules.auth.models import User

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("", response_model=list[AuditEventResponse])
def get_audit_events(
    limit: int = Query(default=100, ge=1, le=500),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> list[AuditEventResponse]:
    try:
        records = get_audit_events_visible_to_user(db_session, current_user, limit=limit)
    except AuditPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

    return [AuditEventResponse.model_validate(item) for item in records]


@router.post("", response_model=AuditEventResponse, status_code=status.HTTP_201_CREATED)
def create_managed_audit_event(
    request: AuditEventCreateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> AuditEventResponse:
    try:
        record = create_audit_event(
            db_session=db_session,
            actor=current_user,
            action=request.action,
            entity_type=request.entity_type,
            entity_id=request.entity_id,
            company_id=request.company_id,
            details=request.details,
        )
    except AuditPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

    return AuditEventResponse.model_validate(record)
