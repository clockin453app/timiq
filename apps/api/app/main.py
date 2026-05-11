from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.health import router as health_router
from app.modules.audit.router import router as audit_router
from app.modules.auth.router import router as auth_router
from app.modules.companies.router import router as companies_router
from app.modules.employee_profiles.router import router as employee_profiles_router
from app.modules.locations.router import router as locations_router
from app.modules.site_access.router import router as site_access_router
from app.modules.system_health.router import router as system_health_router
from app.modules.time_clock.router import router as time_clock_router
from app.modules.onboarding.router import router as onboarding_router
from app.modules.work_progress.router import router as work_progress_router
from app.modules.payroll.router import router as payroll_router
from app.modules.time_records.router import time_records_router, timesheets_router
from app.modules.workplaces.router import router as workplaces_router

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
)

allowed_origins = [
    origin.strip()
    for origin in settings.cors_allowed_origins.split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(companies_router)
app.include_router(locations_router)
app.include_router(site_access_router)
app.include_router(audit_router)
app.include_router(workplaces_router)
app.include_router(employee_profiles_router)
app.include_router(system_health_router)
app.include_router(time_clock_router)
app.include_router(time_records_router)
app.include_router(timesheets_router)
app.include_router(payroll_router)
app.include_router(onboarding_router)
app.include_router(work_progress_router)