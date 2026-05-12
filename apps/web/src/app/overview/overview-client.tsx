"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, PageHeader, Sheet, SheetBody } from "../../components/ui";
import { isAdministrator, LogoutButton, useCurrentUser } from "../../features/auth";
import { fetchManagementOverview, type OverviewData } from "../../features/dashboard/api";
import { listCompanies, type Company } from "../../features/companies/api";
import { formatMoneyGBP } from "../../features/payroll/format";
import { formatDurationSeconds } from "../../features/time-records/format-duration";

const PAYROLL_STATUS_LABEL: Record<string, string> = {
  not_calculated: "Not calculated",
  pending: "Pending",
  pending_approval: "Pending approval",
  approved: "Approved",
  paid: "Paid",
  mixed: "Mixed status",
};

function toneForPayrollStatus(status: string): "success" | "warning" | "muted" {
  if (status === "paid") {
    return "success";
  }
  if (status === "approved") {
    return "success";
  }
  if (status === "not_calculated") {
    return "muted";
  }
  return "warning";
}

function formatPercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) {
    return "—";
  }
  return `${Math.round(rate * 1000) / 10}%`;
}

function BarChartBlock(props: {
  title: string;
  emptyHint: string;
  rows: { key: string; label: string; value: number; display: string; max: number }[];
}) {
  const max = Math.max(1, ...props.rows.map((r) => r.max));
  if (props.rows.length === 0) {
    return (
      <div className="min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
        <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">{props.title}</p>
        </div>
        <div className="p-4 text-sm text-[var(--color-text-muted)]">{props.emptyHint}</div>
      </div>
    );
  }
  return (
    <div className="min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
      <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">{props.title}</p>
      </div>
      <div className="space-y-2.5 overflow-x-auto p-4">
        {props.rows.map((row) => (
          <div className="min-w-[12rem]" key={row.key}>
            <div className="flex justify-between gap-2 text-xs text-[var(--color-text-muted)]">
              <span className="min-w-0 truncate">{row.label}</span>
              <span className="shrink-0 tabular-nums text-[var(--color-text)]">{row.display}</span>
            </div>
            <div className="mt-1 h-2.5 w-full overflow-hidden rounded bg-[var(--color-header)]">
              <div
                className="h-full rounded-sm bg-[#9ca3af]"
                style={{ width: `${Math.min(100, (row.value / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OverviewCard(props: {
  href: string;
  title: string;
  primary: string;
  secondary?: string;
  badge?: string;
  badgeTone?: "success" | "warning" | "muted";
}) {
  const badgeTone = props.badgeTone ?? "muted";
  const badgeClass =
    badgeTone === "success"
      ? "border-[var(--color-success-700)] bg-[var(--color-success-50)] text-[var(--color-success-700)]"
      : badgeTone === "warning"
        ? "border-[var(--color-warning-700)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]"
        : "border-[var(--color-border-dark)] bg-[var(--color-header)] text-[var(--color-text-muted)]";
  return (
    <Link
      className="block min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] shadow-sm transition-colors hover:border-[var(--color-border)] hover:bg-[#f3f4f6]"
      href={props.href}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">{props.title}</p>
        {props.badge ? (
          <span
            className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badgeClass}`}
          >
            {props.badge}
          </span>
        ) : null}
      </div>
      <div className="px-4 py-5">
        <p className="text-2xl font-semibold tabular-nums tracking-tight text-[var(--color-text)]">{props.primary}</p>
        {props.secondary ? (
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">{props.secondary}</p>
        ) : null}
      </div>
    </Link>
  );
}

export function OverviewClient() {
  const user = useCurrentUser();
  const adminAll = isAdministrator(user);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyFilter, setCompanyFilter] = useState("");
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const companyQuery = useMemo(() => {
    if (!adminAll) {
      return null;
    }
    return companyFilter || null;
  }, [adminAll, companyFilter]);

  useEffect(() => {
    if (!adminAll) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await listCompanies();
        if (!cancelled) {
          setCompanies(rows.filter((c) => c.is_active));
        }
      } catch {
        if (!cancelled) {
          setCompanies([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminAll]);

  const load = useCallback(
    async (silent: boolean) => {
      if (!silent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError("");
      try {
        const payload = await fetchManagementOverview(companyQuery);
        setData(payload);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load overview.");
        if (!silent) {
          setData(null);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [companyQuery],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load(true);
      }
    }, 45_000);
    return () => window.clearInterval(id);
  }, [load]);

  const attendanceRows = useMemo(() => {
    if (!data?.attendance_trend.length) {
      return [];
    }
    const maxPresent = Math.max(1, ...data.attendance_trend.map((d) => d.present_count));
    return data.attendance_trend.map((d) => ({
      key: d.date,
      label: d.date,
      value: d.present_count,
      display: `${d.present_count}/${d.total_employees} (${formatPercent(d.attendance_rate)})`,
      max: maxPresent,
    }));
  }, [data]);

  const payrollRows = useMemo(() => {
    if (!data?.payroll_trend.length) {
      return [];
    }
    const maxGross = Math.max(1, ...data.payroll_trend.map((d) => d.total_gross));
    return data.payroll_trend.map((d) => ({
      key: d.week_start,
      label: `Week ${d.week_start}`,
      value: d.total_gross,
      display: `${formatMoneyGBP(String(d.total_gross))} · ${formatDurationSeconds(d.total_hours_seconds)}`,
      max: maxGross,
    }));
  }, [data]);

  return (
    <Sheet>
      <PageHeader
        action={
          <div className="flex flex-wrap items-center gap-2">
            {adminAll && companies.length > 1 ? (
              <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                <span className="hidden sm:inline">Company</span>
                <select
                  className="max-w-[10rem] rounded border border-[var(--color-border-dark)] bg-[var(--color-sheet)] px-2 py-1 text-xs text-[var(--color-text)] sm:max-w-[14rem]"
                  value={companyFilter}
                  onChange={(e) => setCompanyFilter(e.target.value)}
                >
                  <option value="">All companies</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Button
              disabled={refreshing || loading}
              onClick={() => void load(true)}
              type="button"
              variant="secondary"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
            <LogoutButton />
          </div>
        }
        description="Operational snapshot for your organisation. Data refreshes automatically while this tab is visible."
        title="Overview"
      />

      <SheetBody className="min-w-0 space-y-5 lg:p-6">
        {loading ? <p className="text-sm text-[var(--color-text-muted)]">Loading overview…</p> : null}
        {error ? <p className="text-sm text-[var(--color-danger-700)]">{error}</p> : null}

        {data && !loading ? (
          <>
            {data.aggregated_companies ? (
              <p className="text-xs text-[var(--color-text-muted)]">
                Figures combine all companies. Choose a company above to scope attendance charts, payroll trends, and
                activity to a single company.
              </p>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <OverviewCard
                badge="Active"
                badgeTone="muted"
                href="/employees"
                primary={String(data.active_employee_count)}
                secondary="Employees in your scope"
                title="Employees"
              />
              <OverviewCard
                badge="Sites"
                badgeTone="muted"
                href="/locations"
                primary={String(data.active_location_count)}
                secondary={`${data.active_workplace_count} active workplaces`}
                title="Active locations"
              />
              <OverviewCard
                badge={formatPercent(data.live_attendance_rate)}
                badgeTone="success"
                href="/live-attendance"
                primary={`${data.live_present_today} / ${data.live_total_employees}`}
                secondary={`${data.live_open_shifts} open shift(s) now · attendance today`}
                title="Attendance today"
              />
              <OverviewCard
                badge={PAYROLL_STATUS_LABEL[data.payroll_status] ?? data.payroll_status}
                badgeTone={toneForPayrollStatus(data.payroll_status)}
                href="/payroll-report"
                primary={
                  data.payroll_total_gross != null ? formatMoneyGBP(String(data.payroll_total_gross)) : "—"
                }
                secondary={
                  data.payroll_status === "not_calculated"
                    ? data.payroll_message ?? "Payroll has not been calculated for this week."
                    : `${formatDurationSeconds(data.payroll_total_hours_seconds)} recorded this week`
                }
                title="Payroll this week"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <BarChartBlock
                emptyHint="No attendance trend for the selected scope."
                rows={attendanceRows}
                title="Weekly attendance trend (7 days)"
              />
              <BarChartBlock
                emptyHint={
                  data.payroll_status === "not_calculated"
                    ? "Payroll has not been calculated for recent weeks."
                    : "No payroll history rows found yet."
                }
                rows={payrollRows}
                title="Payroll by week (stored totals)"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] lg:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                    Recent activity
                  </p>
                  {user.system_role === "administrator" ? (
                    <Link className="text-xs font-medium text-[var(--color-link)] underline" href="/audit-log">
                      View all activity
                    </Link>
                  ) : (
                    <span className="text-xs text-[var(--color-text-muted)]">Company-scoped events</span>
                  )}
                </div>
                <ul className="max-h-80 divide-y divide-[var(--color-border)] overflow-y-auto">
                  {data.recent_activity.length === 0 ? (
                    <li className="px-4 py-6 text-sm text-[var(--color-text-muted)]">No recent events.</li>
                  ) : (
                    data.recent_activity.map((row, idx) => (
                      <li className="px-4 py-3 text-sm" key={`${row.occurred_at}-${idx}`}>
                        <p className="font-medium text-[var(--color-text)]">{row.summary}</p>
                        {row.detail ? (
                          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{row.detail}</p>
                        ) : null}
                        <p className="mt-1 text-[10px] text-[var(--color-text-soft)]">
                          {new Date(row.occurred_at).toLocaleString()}
                        </p>
                      </li>
                    ))
                  )}
                </ul>
              </div>

              <div className="min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
                <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                    Quick actions
                  </p>
                </div>
                <ul className="divide-y divide-[var(--color-border)]">
                  {[
                    { label: "Add employee", href: "/employees" },
                    { label: "Add location", href: "/locations" },
                    { label: "View live attendance", href: "/live-attendance" },
                    { label: "Run payroll", href: "/payroll-report" },
                    { label: "Week report", href: "/week-report" },
                    { label: "Site progress review", href: "/work-progress-review" },
                  ].map((item) => (
                    <li key={item.href}>
                      <Link
                        className="flex items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-header)]"
                        href={item.href}
                      >
                        <span>{item.label}</span>
                        <span aria-hidden className="text-[var(--color-text-soft)]">
                          →
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
