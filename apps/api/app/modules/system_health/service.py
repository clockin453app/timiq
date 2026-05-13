from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.storage.factory import get_storage_backend, storage_root_explicitly_configured
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
    storage_kind = backend.get_backend_name()
    writable = bool(getattr(backend, "writable_probe", lambda: False)())

    if storage_kind == "local" and not root_cfg:
        warnings.append(
            "TIMIQ_STORAGE_ROOT is not set in the environment; the API uses its built-in default data directory.",
        )
    if storage_kind == "local":
        warnings.append(
            "Local file storage is active: provision persistent disk, permissions, and backups outside TimIQ.",
        )
    if storage_kind == "s3":
        warnings.append(
            "Private S3-compatible object storage is active: enable versioning, least-privilege IAM, and off-site backup or replication per your provider.",
        )
    warnings.append(
        "Backups must include both the PostgreSQL database and private blob storage (disk tree or object bucket); application-level export does not replace full restores.",
    )
    warnings.append(
        "Restore testing is manual: periodically restore to an isolated environment and verify logins, payroll samples, and file downloads through the app.",
    )

    storage_status = "reachable" if storage_ok else "unreachable"
    if storage_ok and not writable:
        storage_status = "degraded"
        warnings.append("Storage write probe failed (check permissions, bucket policy, or credentials scope).")

    overall = "ok"
    if db_result.get("status") != "ok" or not storage_ok:
        overall = "degraded"
    if not writable and storage_ok:
        overall = "degraded"

    detail = "ok" if storage_ok and writable else "check_configuration"
    if not storage_ok:
        detail = "unreachable_or_missing"

    object_storage_status = "configured" if storage_kind == "s3" else "not_configured"

    backup = BackupReadiness(
        database_backup="manual_or_unknown",
        storage_backup="manual_or_unknown",
        timiq_storage_root_documented_in_example=_env_example_mentions_storage_root(),
        local_storage_requires_persistent_disk=storage_kind == "local",
        object_storage_status=object_storage_status,
        restore_testing="manual_required",
        object_storage_planned="",
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
