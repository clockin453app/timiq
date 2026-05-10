from fastapi import APIRouter, Depends

from app.modules.auth.dependencies import require_administrator
from app.modules.auth.models import User
from app.modules.system_health.schemas import SystemHealthResponse
from app.modules.system_health.service import get_system_health

router = APIRouter(prefix="/api/system-health", tags=["system-health"])


@router.get("", response_model=SystemHealthResponse)
def read_system_health(
    current_user: User = Depends(require_administrator),
) -> SystemHealthResponse:
    return get_system_health()
