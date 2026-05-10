from fastapi import APIRouter
from starlette.responses import JSONResponse

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check() -> JSONResponse:
    """Process liveness only — no DB, storage, or external checks."""
    return JSONResponse(content={"status": "ok"})
