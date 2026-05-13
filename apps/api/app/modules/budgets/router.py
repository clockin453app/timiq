import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query

from app.db.session import get_db_session
from app.modules.auth.dependencies import require_admin_or_administrator
from app.modules.auth.models import User
from app.modules.budgets.schemas import LabourCostResponse
from app.modules.budgets.service import labour_cost_budget
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/budgets", tags=["budgets"])


def _opt_date(raw: str) -> date:
    try:
        return date.fromisoformat(raw.strip())
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="date_from and date_to must be YYYY-MM-DD.",
        ) from exc


def _opt_planned_budget(raw: str | None) -> Decimal | None:
    if raw is None or str(raw).strip() == "":
        return None
    try:
        return Decimal(str(raw).strip())
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="planned_budget_amount must be a decimal number.",
        ) from exc


@router.get("/labour-cost", response_model=LabourCostResponse)
def get_labour_cost_budget(
    date_from: str = Query(..., description="Inclusive local start date (YYYY-MM-DD) in company policy timezone."),
    date_to: str = Query(..., description="Inclusive local end date (YYYY-MM-DD) in company policy timezone."),
    company_id: uuid.UUID | None = Query(
        default=None,
        description="Required for administrators; ignored for company admins (own company enforced).",
    ),
    location_id: uuid.UUID | None = Query(default=None),
    user_id: uuid.UUID | None = Query(default=None),
    workplace_id: uuid.UUID | None = Query(default=None),
    planned_budget_amount: str | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> LabourCostResponse:
    return labour_cost_budget(
        db_session,
        current_user,
        company_id=company_id,
        date_from=_opt_date(date_from),
        date_to=_opt_date(date_to),
        location_id=location_id,
        user_id=user_id,
        workplace_id=workplace_id,
        planned_budget_amount=_opt_planned_budget(planned_budget_amount),
    )
