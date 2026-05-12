import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import require_admin_or_administrator
from app.modules.auth.models import User

from .permissions import DashboardPermissionError
from .schemas import ManagementSummaryResponse, OverviewResponse
from .service import DashboardError, build_management_summary, build_overview

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=ManagementSummaryResponse)
def read_management_summary(
    company_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> ManagementSummaryResponse:
    try:
        return build_management_summary(db_session, current_user, company_id=company_id)
    except DashboardPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except DashboardError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/overview", response_model=OverviewResponse)
def read_management_overview(
    company_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> OverviewResponse:
    try:
        return build_overview(db_session, current_user, company_id=company_id)
    except DashboardPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except DashboardError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
