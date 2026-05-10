from app.core.config import settings
from app.core.storage.factory import get_storage_backend
from app.db.health import check_database_connection
from app.modules.system_health.schemas import SystemHealthResponse


def get_system_health() -> SystemHealthResponse:
    db_result = check_database_connection()
    storage_backend = get_storage_backend()
    storage_status = "reachable" if storage_backend.healthcheck() else "unreachable"

    overall_status = (
        "ok"
        if db_result["status"] == "ok" and storage_status == "reachable"
        else "degraded"
    )

    return SystemHealthResponse(
        app=settings.app_name,
        environment=settings.app_env,
        status=overall_status,
        database=db_result["database"],
        storage=storage_status,
    )
