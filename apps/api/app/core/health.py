from datetime import datetime, timezone

from fastapi import APIRouter
from starlette.responses import JSONResponse

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check() -> JSONResponse:
    """Process liveness only — no DB, storage, or external checks."""
    return JSONResponse(content={"status": "ok"})


@router.get("/api/healthz")
async def health_check_api_path() -> JSONResponse:
    """Public liveness for load balancers (e.g. Render). No auth, DB, storage, or secrets."""
    return JSONResponse(
        content={
            "status": "ok",
            "server_time": datetime.now(timezone.utc).isoformat(),
        }
    )
