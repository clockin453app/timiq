from pydantic import BaseModel, Field


class BackupReadiness(BaseModel):
    database_backup: str = Field(
        default="manual_or_unknown",
        description="TimIQ does not detect automated DB backups; treat as manual until wired.",
    )
    storage_backup: str = Field(
        default="manual_or_unknown",
        description="Object storage backups not integrated yet (planned).",
    )
    timiq_storage_root_documented_in_example: bool = False
    local_storage_requires_persistent_disk: bool = False
    object_storage_status: str = Field(default="not_configured")


class SystemHealthCounts(BaseModel):
    companies: int = 0
    active_employees: int = 0
    open_shifts: int = 0
    pending_payroll_items: int = 0
    pending_onboarding_submissions: int = 0
    pending_work_progress_entries: int = 0


class SystemHealthResponse(BaseModel):
    app: str
    environment: str
    status: str
    database: str
    storage: str
    storage_backend: str
    storage_root_configured: bool
    storage_writable: bool
    storage_health_detail: str
    server_time_utc: str
    alembic_revision: str | None = None
    counts: SystemHealthCounts
    backup_readiness: BackupReadiness
    warnings: list[str] = Field(default_factory=list)
