"use client";

import { useEffect, useState } from "react";

import { PageHeader, Sheet, SheetBody, Table, TableBody, TableCell, TableRow } from "../../components/ui";
import { getSystemHealth, type SystemHealth } from "./api";

function StatusLine(props: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const tone =
    props.tone === "bad"
      ? "text-red-800"
      : props.tone === "warn"
        ? "text-amber-900"
        : "text-emerald-900";
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[#4b5563]">{props.label}</p>
      <p className={`mt-1 text-sm font-semibold tabular-nums ${tone}`}>{props.value}</p>
    </div>
  );
}

export function SystemHealthScreen() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await getSystemHealth();
        if (!cancelled) {
          setHealth(data);
        }
      } catch (e) {
        if (!cancelled) {
          setHealth(null);
          setError(e instanceof Error ? e.message : "Could not load system health.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dbTone = health?.database === "reachable" ? "ok" : "bad";
  const stTone =
    health?.storage === "reachable" ? "ok" : health?.storage === "degraded" ? "warn" : "bad";

  return (
    <Sheet>
      <PageHeader
        title="System health"
        description="Safe diagnostics for administrators. No secrets, credentials, or file paths are returned."
      />
      <SheetBody className="space-y-4">
        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}
        {loading ? <p className="text-sm text-[var(--color-text-muted)]">Loading…</p> : null}
        {health ? (
          <div className="space-y-5">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <StatusLine label="Overall" tone={health.status === "ok" ? "ok" : "warn"} value={health.status} />
              <StatusLine label="API" tone="ok" value="running" />
              <StatusLine label="Database" tone={dbTone} value={health.database} />
              <StatusLine label="Storage" tone={stTone} value={health.storage} />
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-4 text-sm shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">Configuration</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-[#1f2937]">
                <li>Environment label: {health.environment}</li>
                <li>Storage backend: {health.storage_backend}</li>
                <li>TIMIQ_STORAGE_ROOT set: {health.storage_root_configured ? "yes" : "no"}</li>
                <li>Storage writable probe: {health.storage_writable ? "passed" : "failed"}</li>
                <li>Storage detail: {health.storage_health_detail}</li>
                <li>Server time (UTC): {new Date(health.server_time_utc).toLocaleString()}</li>
                <li>Alembic revision: {health.alembic_revision ?? "unknown"}</li>
              </ul>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-4 text-sm shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">Counts</p>
              <Table className="mt-2 text-sm">
                <TableBody>
                  <TableRow>
                    <TableCell>Companies</TableCell>
                    <TableCell className="tabular-nums">{health.counts.companies}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Active employees</TableCell>
                    <TableCell className="tabular-nums">{health.counts.active_employees}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Open shifts</TableCell>
                    <TableCell className="tabular-nums">{health.counts.open_shifts}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Pending payroll items</TableCell>
                    <TableCell className="tabular-nums">{health.counts.pending_payroll_items}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Pending onboarding (submitted)</TableCell>
                    <TableCell className="tabular-nums">{health.counts.pending_onboarding_submissions}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Pending work progress (submitted)</TableCell>
                    <TableCell className="tabular-nums">{health.counts.pending_work_progress_entries}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-4 text-sm shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">Backup readiness</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-[#1f2937]">
                <li>Database backups: {health.backup_readiness.database_backup}</li>
                <li>Storage backups: {health.backup_readiness.storage_backup}</li>
                <li>
                  TIMIQ_STORAGE_ROOT in apps/api/.env.example:{" "}
                  {health.backup_readiness.timiq_storage_root_documented_in_example ? "yes" : "no"}
                </li>
                <li>
                  Local disk persistence required:{" "}
                  {health.backup_readiness.local_storage_requires_persistent_disk ? "yes" : "no"}
                </li>
                <li>Object storage: {health.backup_readiness.object_storage_status}</li>
              </ul>
              <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                See <span className="font-medium">docs/backup-runbook.md</span> for backup and restore practices.
              </p>
            </div>

            {health.warnings.length > 0 ? (
              <div className="rounded-[var(--radius-md)] border border-amber-800/25 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                <p className="font-semibold">Warnings</p>
                <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
                  {health.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
