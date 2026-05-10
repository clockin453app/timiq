from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError

from app.core.config import settings
from app.core.storage.factory import get_storage_backend
from app.db.health import check_database_connection
from app.modules.system_health.schemas import SystemHealthResponse


def get_system_health() -> SystemHealthResponse:
    with ThreadPoolExecutor(max_workers=2) as executor:
        database_future = executor.submit(check_database_connection)
        try:
            db_result = database_future.result(timeout=8)
        except FuturesTimeoutError:
            db_result = {
                "status": "error",
                "database": "unreachable",
            }

        storage_future = executor.submit(lambda: get_storage_backend().healthcheck())
        try:
            storage_ok = storage_future.result(timeout=3)
        except FuturesTimeoutError:
            storage_ok = False

    storage_status = "reachable" if storage_ok else "unreachable"

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
