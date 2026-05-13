from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import require_administrator
from app.modules.auth.models import User
from app.modules.system_health.schemas import SystemHealthResponse
from app.modules.system_health.service import get_system_health

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/health", response_model=SystemHealthResponse)
def read_system_health_api(
    db_session: Session = Depends(get_db_session),
    _user: User = Depends(require_administrator),
) -> SystemHealthResponse:
    return get_system_health(db_session)
