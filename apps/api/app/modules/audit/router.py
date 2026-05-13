from datetime import date, datetime, time, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.audit.sanitize import sanitize_audit_details
from app.modules.audit.schemas import AuditEventCreateRequest, AuditEventListResponse, AuditEventResponse
from app.modules.audit.service import AuditPermissionError, create_audit_event, list_audit_events_for_user
from app.modules.auth.dependencies import require_admin_or_administrator
from app.modules.auth.models import SystemRole, User

router = APIRouter(prefix="/api/audit", tags=["audit"])


def _range_from_dates(date_from: date | None, date_to: date | None) -> tuple[datetime | None, datetime | None]:
    dt_from = (
        datetime.combine(date_from, time.min, tzinfo=timezone.utc) if date_from is not None else None
    )
    dt_to = datetime.combine(date_to, time.max, tzinfo=timezone.utc) if date_to is not None else None
    return dt_from, dt_to


def _list_audit_events_handler(
    db_session: Session,
    current_user: User,  # admin or administrator only (enforced by route dependencies)
    *,
    date_from: date | None,
    date_to: date | None,
    actor_user_id: uuid.UUID | None,
    subject_user_id: uuid.UUID | None,
    company_id: uuid.UUID | None,
    action: str | None,
    entity_type: str | None,
    search: str | None,
    limit: int,
    offset: int,
) -> AuditEventListResponse:
    if current_user.system_role == SystemRole.ADMIN and company_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Company filter is only available to administrators.",
        )
    dt_from, dt_to = _range_from_dates(date_from, date_to)
    try:
        return list_audit_events_for_user(
            db_session,
            current_user,
            date_from=dt_from,
            date_to=dt_to,
            actor_user_id=actor_user_id,
            subject_user_id=subject_user_id,
            company_id=company_id,
            action_contains=action,
            entity_type_contains=entity_type,
            search=search,
            limit=limit,
            offset=offset,
        )
    except AuditPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc


@router.get("/events", response_model=AuditEventListResponse)
def get_audit_events(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    actor_user_id: uuid.UUID | None = Query(default=None),
    subject_user_id: uuid.UUID | None = Query(default=None),
    company_id: uuid.UUID | None = Query(default=None),
    action: str | None = Query(default=None, max_length=120),
    entity_type: str | None = Query(default=None, max_length=120),
    search: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=50_000),
) -> AuditEventListResponse:
    return _list_audit_events_handler(
        db_session,
        current_user,
        date_from=date_from,
        date_to=date_to,
        actor_user_id=actor_user_id,
        subject_user_id=subject_user_id,
        company_id=company_id,
        action=action,
        entity_type=entity_type,
        search=search,
        limit=limit,
        offset=offset,
    )


@router.get("", response_model=AuditEventListResponse, include_in_schema=False)
def get_audit_events_legacy_root(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    actor_user_id: uuid.UUID | None = Query(default=None),
    subject_user_id: uuid.UUID | None = Query(default=None),
    company_id: uuid.UUID | None = Query(default=None),
    action: str | None = Query(default=None, max_length=120),
    entity_type: str | None = Query(default=None, max_length=120),
    search: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0, le=50_000),
) -> AuditEventListResponse:
    return _list_audit_events_handler(
        db_session,
        current_user,
        date_from=date_from,
        date_to=date_to,
        actor_user_id=actor_user_id,
        subject_user_id=subject_user_id,
        company_id=company_id,
        action=action,
        entity_type=entity_type,
        search=search,
        limit=limit,
        offset=offset,
    )


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

    return AuditEventResponse(
        id=record.id,
        actor_user_id=record.actor_user_id,
        company_id=record.company_id,
        action=record.action,
        entity_type=record.entity_type,
        entity_id=record.entity_id,
        details=sanitize_audit_details(record.details or {}),
        created_at=record.created_at,
    )
