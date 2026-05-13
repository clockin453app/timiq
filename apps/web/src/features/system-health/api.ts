import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

export type BackupReadiness = {
  database_backup: string;
  storage_backup: string;
  timiq_storage_root_documented_in_example: boolean;
  local_storage_requires_persistent_disk: boolean;
  object_storage_status: string;
};

export type SystemHealthCounts = {
  companies: number;
  active_employees: number;
  open_shifts: number;
  pending_payroll_items: number;
  pending_onboarding_submissions: number;
  pending_work_progress_entries: number;
};

export type SystemHealth = {
  app: string;
  environment: string;
  status: string;
  database: string;
  storage: string;
  storage_backend: string;
  storage_root_configured: boolean;
  storage_writable: boolean;
  storage_health_detail: string;
  server_time_utc: string;
  alembic_revision: string | null;
  counts: SystemHealthCounts;
  backup_readiness: BackupReadiness;
  warnings: string[];
};

export async function getSystemHealth(): Promise<SystemHealth> {
  const primary = await fetch(`${API_URL}/api/system/health`, { credentials: "include" });
  if (primary.ok) {
    return primary.json() as Promise<SystemHealth>;
  }
  if (primary.status === 403) {
    const detail = await primary.json().catch(() => ({}));
    throw new Error(
      fastApiDetailToMessage((detail as { detail?: unknown }).detail, "You cannot view system health."),
    );
  }
  const legacy = await fetch(`${API_URL}/api/system-health`, { credentials: "include" });
  if (!legacy.ok) {
    const detail = await legacy.json().catch(() => ({}));
    throw new Error(
      fastApiDetailToMessage((detail as { detail?: unknown }).detail, "Could not load system health."),
    );
  }
  const base = (await legacy.json()) as Partial<SystemHealth>;
  return {
    app: base.app ?? "",
    environment: base.environment ?? "",
    status: base.status ?? "unknown",
    database: base.database ?? "",
    storage: base.storage ?? "",
    storage_backend: "unknown",
    storage_root_configured: false,
    storage_writable: false,
    storage_health_detail: "legacy_endpoint",
    server_time_utc: new Date().toISOString(),
    alembic_revision: null,
    counts: {
      companies: 0,
      active_employees: 0,
      open_shifts: 0,
      pending_payroll_items: 0,
      pending_onboarding_submissions: 0,
      pending_work_progress_entries: 0,
    },
    backup_readiness: {
      database_backup: "manual_or_unknown",
      storage_backup: "manual_or_unknown",
      timiq_storage_root_documented_in_example: false,
      local_storage_requires_persistent_disk: false,
      object_storage_status: "not_configured",
    },
    warnings: ["Using legacy /api/system-health response; upgrade API for full diagnostics."],
  };
}
