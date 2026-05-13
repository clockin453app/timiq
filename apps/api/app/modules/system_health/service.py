from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.storage.factory import get_storage_backend, storage_root_explicitly_configured
from app.core.storage.local import LocalStorageBackend
from app.db.health import check_database_connection
from app.modules.auth.models import SystemRole, User
from app.modules.companies.models import Company
from app.modules.onboarding.models import OnboardingSubmission
from app.modules.payroll.models import PayrollItem
from app.modules.system_health.schemas import BackupReadiness, SystemHealthCounts, SystemHealthResponse
from app.modules.time_clock.models import TimeShift
from app.modules.work_progress.models import WorkProgressEntry


def _find_monorepo_root() -> Path | None:
    here = Path(__file__).resolve()
    for p in [here, *here.parents]:
        if (p / "apps" / "api" / ".env.example").is_file():
            return p
    return None


def _env_example_mentions_storage_root() -> bool:
    root = _find_monorepo_root()
    if root is None:
        return False
    path = root / "apps" / "api" / ".env.example"
    try:
        return "TIMIQ_STORAGE_ROOT" in path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False


def _read_alembic_revision(db_session: Session) -> str | None:
    try:
        rev = db_session.scalar(text("SELECT version_num FROM alembic_version LIMIT 1"))
        return str(rev) if rev else None
    except Exception:
        return None


def _counts(db_session: Session) -> SystemHealthCounts:
    companies = int(db_session.scalar(select(func.count()).select_from(Company)) or 0)
    employees_stmt = select(func.count()).select_from(User).where(
        User.system_role == SystemRole.EMPLOYEE,
        User.is_active.is_(True),
    )
    active_employees = int(db_session.scalar(employees_stmt) or 0)
    open_shifts = int(
        db_session.scalar(select(func.count()).select_from(TimeShift).where(TimeShift.status == "open")) or 0,
    )
    pending_payroll = int(
        db_session.scalar(
            select(func.count()).select_from(PayrollItem).where(PayrollItem.status == "pending"),
        )
        or 0,
    )
    pending_onboarding = int(
        db_session.scalar(
            select(func.count())
            .select_from(OnboardingSubmission)
            .where(OnboardingSubmission.status == "submitted"),
        )
        or 0,
    )
    pending_wp = int(
        db_session.scalar(
            select(func.count())
            .select_from(WorkProgressEntry)
            .where(WorkProgressEntry.status == "submitted"),
        )
        or 0,
    )
    return SystemHealthCounts(
        companies=companies,
        active_employees=active_employees,
        open_shifts=open_shifts,
        pending_payroll_items=pending_payroll,
        pending_onboarding_submissions=pending_onboarding,
        pending_work_progress_entries=pending_wp,
    )


def get_system_health(db_session: Session) -> SystemHealthResponse:
    warnings: list[str] = []
    root_cfg = storage_root_explicitly_configured()

    with ThreadPoolExecutor(max_workers=2) as executor:
        database_future = executor.submit(check_database_connection)
        storage_future = executor.submit(lambda: get_storage_backend().healthcheck())
        try:
            db_result = database_future.result(timeout=8)
        except FuturesTimeoutError:
            db_result = {"status": "error", "database": "unreachable"}
        try:
            storage_ok = storage_future.result(timeout=5)
        except FuturesTimeoutError:
            storage_ok = False

    backend = get_storage_backend()
    storage_kind = "local" if isinstance(backend, LocalStorageBackend) else "custom"
    writable = bool(getattr(backend, "writable_probe", lambda: False)())

    if not root_cfg:
        warnings.append(
            "TIMIQ_STORAGE_ROOT is not set in the environment; the API uses its built-in default data directory.",
        )
    if storage_kind == "local":
        warnings.append(
            "Local file storage is active: provision persistent disk, permissions, and backups outside TimIQ.",
        )
    warnings.append(
        "Object storage (S3-compatible) is not configured yet; treat uploads as durable only after disk backup.",
    )

    storage_status = "reachable" if storage_ok else "unreachable"
    if storage_ok and not writable:
        storage_status = "degraded"
        warnings.append("Storage directory exists but a write probe failed (check permissions).")

    overall = "ok"
    if db_result.get("status") != "ok" or not storage_ok:
        overall = "degraded"
    if not writable and storage_ok:
        overall = "degraded"

    detail = "ok" if storage_ok and writable else "check_configuration"
    if not storage_ok:
        detail = "unreachable_or_missing"

    backup = BackupReadiness(
        database_backup="manual_or_unknown",
        storage_backup="manual_or_unknown",
        timiq_storage_root_documented_in_example=_env_example_mentions_storage_root(),
        local_storage_requires_persistent_disk=storage_kind == "local",
        object_storage_status="not_configured",
    )

    counts = _counts(db_session)

    return SystemHealthResponse(
        app=settings.app_name,
        environment=settings.app_env,
        status=overall,
        database=str(db_result.get("database", "unknown")),
        storage=storage_status,
        storage_backend=storage_kind,
        storage_root_configured=root_cfg,
        storage_writable=writable,
        storage_health_detail=detail,
        server_time_utc=datetime.now(timezone.utc).isoformat(),
        alembic_revision=_read_alembic_revision(db_session),
        counts=counts,
        backup_readiness=backup,
        warnings=warnings,
    )
