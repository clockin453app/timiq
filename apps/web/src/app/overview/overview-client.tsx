"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Button, PageHeader, Sheet, SheetBody } from "../../components/ui";
import { isAdministrator, useCurrentUser } from "../../features/auth";
import { fetchManagementOverview, type OverviewData } from "../../features/dashboard/api";
import { CompanySelector } from "../../features/companies/company-selector";
import { listCompanies, type Company } from "../../features/companies/api";
import { useAdministratorCompanyScope } from "../../features/companies/selected-company";
import { formatMoneyGBP } from "../../features/payroll/format";
import { formatDurationSeconds } from "../../features/time-records/format-duration";
import { payrollStatusLabel, useT } from "../../lib/i18n";

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

const NEEDS_ATTENTION_SEVERITY_CLASS: Record<string, string> = {
  critical: "border-l-[3px] border-[#b91c1c] bg-[#fef2f2]",
  warning: "border-l-[3px] border-[#b45309] bg-[#fffbeb]",
  info: "border-l-[3px] border-[#64748b] bg-[#f8fafc]",
};

function PanelFrame(props: { title: string; children: ReactNode; headerRight?: ReactNode }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">{props.title}</p>
        {props.headerRight}
      </div>
      {props.children}
    </div>
  );
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
  const t = useT();
  const user = useCurrentUser();
  const adminAll = isAdministrator(user);
  const [companies, setCompanies] = useState<Company[]>([]);
  const companyScope = useAdministratorCompanyScope(user, companies);
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const companyQuery = useMemo(() => {
    if (!adminAll) {
      return null;
    }
    return companyScope.companyId;
  }, [adminAll, companyScope.companyId]);

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
      if (adminAll && !companyQuery) {
        setData(null);
        setError("");
        setLoading(false);
        setRefreshing(false);
        return;
      }
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
        setError(e instanceof Error ? e.message : t("overview.load_error", "Could not load overview."));
        if (!silent) {
          setData(null);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [adminAll, companyQuery, t],
  );

  const payrollTrendLabelFn = useCallback(
    (weekStart: string) => t("overview.week_label", "Week {{date}}", { date: weekStart }),
    [t],
  );

  const attendanceTrendDisplayFn = useCallback(
    (present: number, total: number, rate: string) =>
      t("overview.attendance_bar_display", "{{present}}/{{total}} ({{rate}})", {
        present: String(present),
        total: String(total),
        rate,
      }),
    [t],
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
      display: attendanceTrendDisplayFn(d.present_count, d.total_employees, formatPercent(d.attendance_rate)),
      max: maxPresent,
    }));
  }, [data, attendanceTrendDisplayFn]);

  const payrollRows = useMemo(() => {
    if (!data?.payroll_trend.length) {
      return [];
    }
    const maxGross = Math.max(1, ...data.payroll_trend.map((d) => d.total_gross));
    return data.payroll_trend.map((d) => ({
      key: d.week_start,
      label: payrollTrendLabelFn(d.week_start),
      value: d.total_gross,
      display: `${formatMoneyGBP(String(d.total_gross))} · ${formatDurationSeconds(d.total_hours_seconds)}`,
      max: maxGross,
    }));
  }, [data, payrollTrendLabelFn]);

  return (
    <Sheet>
      <PageHeader
        action={
          <div className="flex flex-wrap items-center gap-2">
            {adminAll && companyScope.companies.length > 0 ? (
              <CompanySelector
                companies={companyScope.companies}
                onChange={companyScope.setCompanyId}
                value={companyScope.companyId}
              />
            ) : null}
            <Button
              disabled={refreshing || loading}
              onClick={() => void load(true)}
              type="button"
              variant="secondary"
            >
              {refreshing ? t("common.refreshing", "Refreshing…") : t("common.refresh", "Refresh")}
            </Button>
          </div>
        }
        description={t("overview.page_description")}
        title={t("overview.page_title")}
      />

      <SheetBody className="min-w-0 space-y-5 lg:p-6">
        {companyScope.scopeLabel ? (
          <p className="text-xs text-[var(--color-text-muted)]">{companyScope.scopeLabel}</p>
        ) : null}
        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">{t("overview.loading", "Loading overview…")}</p>
        ) : null}
        {error ? <p className="text-sm text-[var(--color-danger-700)]">{error}</p> : null}

        {adminAll && companyScope.needsCompanySelection && !loading ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
            {t("overview.select_company_dashboard", "Select a company to view its dashboard.")}
          </div>
        ) : null}

        {data && !loading ? (
          <>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <OverviewCard
                badge={t("overview.badge_active", "Active")}
                badgeTone="muted"
                href="/employees"
                primary={String(data.active_employee_count)}
                secondary={t("overview.employees_subline")}
                title={t("overview.employees", "Employees")}
              />
              <OverviewCard
                badge={t("overview.badge_sites", "Sites")}
                badgeTone="muted"
                href="/locations"
                primary={String(data.active_location_count)}
                secondary={t("overview.locations_sites_sub", "Operational sites for clocking and access")}
                title={t("overview.active_locations", "Active locations")}
              />
              <OverviewCard
                badge={formatPercent(data.live_attendance_rate)}
                badgeTone="success"
                href="/live-attendance"
                primary={`${data.live_present_today} / ${data.live_total_employees}`}
                secondary={t("overview.attendance_now_sub", "{{open}} open shift(s) now · attendance today", {
                  open: data.live_open_shifts,
                })}
                title={t("overview.attendance_today", "Attendance today")}
              />
              <OverviewCard
                badge={payrollStatusLabel(t, data.payroll_status)}
                badgeTone={toneForPayrollStatus(data.payroll_status)}
                href="/payroll-report"
                primary={
                  data.payroll_total_gross != null ? formatMoneyGBP(String(data.payroll_total_gross)) : "—"
                }
                secondary={
                  data.payroll_status === "not_calculated"
                    ? data.payroll_message ?? t("overview.payroll_not_calc")
                    : t("overview.payroll_recorded_week", "{{hours}} recorded this week", {
                        hours: formatDurationSeconds(data.payroll_total_hours_seconds),
                      })
                }
                title={t("overview.payroll_this_week")}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <PanelFrame title={t("overview.needs_attention", "Needs attention")}>
                <div className="p-3">
                  {data.needs_attention_scope_note ? (
                    <p className="mb-3 text-[11px] text-[var(--color-text-muted)]">{data.needs_attention_scope_note}</p>
                  ) : null}
                  {data.needs_attention.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-muted)]">{t("overview.empty_attention")}</p>
                  ) : (
                    <ul className="divide-y divide-[var(--color-border)]">
                      {data.needs_attention.map((item) => (
                        <li key={item.code}>
                          <Link
                            className={`flex items-center justify-between gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-[var(--color-header)] ${NEEDS_ATTENTION_SEVERITY_CLASS[item.severity] ?? NEEDS_ATTENTION_SEVERITY_CLASS.info}`}
                            href={item.href}
                          >
                            <span className="min-w-0 font-medium text-[var(--color-text)]">{item.label}</span>
                            <span className="shrink-0 tabular-nums font-semibold text-[var(--color-text)]">
                              {item.count}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </PanelFrame>

              <PanelFrame
                headerRight={
                  <Link className="text-xs font-medium text-[var(--color-link)] underline" href="/live-attendance">
                    {t("common.view_all", "View all")}
                  </Link>
                }
                title={t("overview.today_live", "Today live")}
              >
                <div className="p-3">
                  {data.today_live.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-muted)]">{t("overview.no_open_shifts")}</p>
                  ) : (
                    <ul className="divide-y divide-[var(--color-border)]">
                      {data.today_live.map((row, idx) => (
                        <li key={`${row.display_name}-${row.clock_in_at}-${idx}`}>
                          <Link
                            className="flex flex-col gap-0.5 px-3 py-2.5 text-sm transition-colors hover:bg-[var(--color-header)] sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                            href={row.href}
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-[var(--color-text)]">{row.display_name}</p>
                              <p className="text-xs text-[var(--color-text-muted)]">
                                {row.location_name ?? "—"}
                                {row.email ? ` · ${row.email}` : null}
                              </p>
                            </div>
                            <p className="shrink-0 text-xs tabular-nums text-[var(--color-text-muted)] sm:text-right">
                              {formatDurationSeconds(row.running_seconds)}
                              <span className="hidden sm:inline"> · </span>
                              <span className="block sm:inline">
                                {new Date(row.clock_in_at).toLocaleString()}
                              </span>
                            </p>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </PanelFrame>

              <PanelFrame title={t("overview.payroll_readiness", "Payroll readiness")}>
                <div className="space-y-3 p-3">
                  {!data.payroll_readiness ? (
                    <p className="text-sm text-[var(--color-text-muted)]">
                      {t("overview.payroll_readiness_unavailable")}
                    </p>
                  ) : (
                    <>
                      {data.payroll_readiness.scope_note ? (
                        <p className="text-[11px] text-[var(--color-text-muted)]">{data.payroll_readiness.scope_note}</p>
                      ) : null}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            toneForPayrollStatus(data.payroll_readiness.payroll_status) === "success"
                              ? "border-[var(--color-success-700)] bg-[var(--color-success-50)] text-[var(--color-success-700)]"
                              : toneForPayrollStatus(data.payroll_readiness.payroll_status) === "muted"
                                ? "border-[var(--color-border-dark)] bg-[var(--color-header)] text-[var(--color-text-muted)]"
                                : "border-[var(--color-warning-700)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]"
                          }`}
                        >
                          {payrollStatusLabel(t, data.payroll_readiness.payroll_status)}
                        </span>
                        <Link
                          className="text-xs font-medium text-[var(--color-link)] underline"
                          href={data.payroll_readiness.href}
                        >
                          {t("overview.open_payroll_report")}
                        </Link>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
                        <div>
                          <dt className="text-[var(--color-text-soft)]">{t("overview.readiness_items", "Items")}</dt>
                          <dd className="tabular-nums font-medium text-[var(--color-text)]">
                            {data.payroll_readiness.total_items}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[var(--color-text-soft)]">{t("overview.readiness_pending", "Pending")}</dt>
                          <dd className="tabular-nums font-medium text-[var(--color-text)]">
                            {data.payroll_readiness.pending_count}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[var(--color-text-soft)]">{t("overview.readiness_approved", "Approved")}</dt>
                          <dd className="tabular-nums font-medium text-[var(--color-text)]">
                            {data.payroll_readiness.approved_count}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[var(--color-text-soft)]">{t("overview.readiness_paid", "Paid")}</dt>
                          <dd className="tabular-nums font-medium text-[var(--color-text)]">
                            {data.payroll_readiness.paid_count}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[var(--color-text-soft)]">
                            {t("overview.readiness_rate_missing", "Rate missing")}
                          </dt>
                          <dd className="tabular-nums font-medium text-[var(--color-text)]">
                            {data.payroll_readiness.rate_missing_count}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[var(--color-text-soft)]">
                            {t("overview.readiness_open_shifts_week", "Open shifts (week)")}
                          </dt>
                          <dd className="tabular-nums font-medium text-[var(--color-text)]">
                            {data.payroll_readiness.open_shifts_started_in_week_count}
                          </dd>
                        </div>
                        <div className="col-span-2 sm:col-span-3">
                          <dt className="text-[var(--color-text-soft)]">
                            {t("overview.readiness_not_calculated", "Not calculated")}
                          </dt>
                          <dd className="font-medium text-[var(--color-text)]">
                            {data.payroll_readiness.payroll_period_not_calculated
                              ? t("common.yes", "Yes")
                              : t("common.no", "No")}
                          </dd>
                        </div>
                        <div className="col-span-2 sm:col-span-3">
                          <dt className="text-[var(--color-text-soft)]">
                            {t("overview.readiness_needs_recalc", "Needs recalc")}
                          </dt>
                          <dd className="font-medium text-[var(--color-text)]">
                            {data.payroll_readiness.payroll_needs_recalculation
                              ? t("common.yes", "Yes")
                              : t("common.no", "No")}
                          </dd>
                        </div>
                        <div className="col-span-2 sm:col-span-3">
                          <dt className="text-[var(--color-text-soft)]">
                            {t("overview.readiness_gross_hours", "Gross / hours")}
                          </dt>
                          <dd className="font-medium text-[var(--color-text)]">
                            {data.payroll_readiness.total_gross != null
                              ? formatMoneyGBP(String(data.payroll_readiness.total_gross))
                              : "—"}{" "}
                            · {formatDurationSeconds(data.payroll_readiness.total_hours_seconds)}
                          </dd>
                        </div>
                      </dl>
                    </>
                  )}
                </div>
              </PanelFrame>

              <PanelFrame title={t("overview.setup_health", "Setup health")}>
                <div className="p-3">
                  {!data.setup_health ? (
                    <p className="text-sm text-[var(--color-text-muted)]">{t("overview.no_company_scope")}</p>
                  ) : (
                    <>
                      {data.setup_health.scope_note ? (
                        <p className="mb-3 text-[11px] text-[var(--color-text-muted)]">{data.setup_health.scope_note}</p>
                      ) : null}
                      <ul className="space-y-1.5 text-xs text-[var(--color-text)]">
                        <li className="flex justify-between gap-2">
                          <span className="text-[var(--color-text-muted)]">{t("overview.setup_active_employees")}</span>
                          <span className="tabular-nums font-medium">{data.setup_health.active_employee_count}</span>
                        </li>
                        <li className="flex justify-between gap-2">
                          <span className="text-[var(--color-text-muted)]">{t("overview.setup_active_locations")}</span>
                          <span className="tabular-nums font-medium">{data.setup_health.active_location_count}</span>
                        </li>
                        <li className="flex justify-between gap-2">
                          <span className="text-[var(--color-text-muted)]">{t("overview.setup_missing_hourly_rate")}</span>
                          <Link className="font-medium text-[var(--color-link)] underline" href="/employees">
                            {data.setup_health.employees_missing_hourly_rate_count}
                          </Link>
                        </li>
                        <li className="flex justify-between gap-2">
                          <span className="text-[var(--color-text-muted)]">{t("overview.setup_no_site_access")}</span>
                          <Link className="font-medium text-[var(--color-link)] underline" href="/site-access">
                            {data.setup_health.employees_without_site_access_count}
                          </Link>
                        </li>
                        <li className="flex justify-between gap-2 border-t border-[var(--color-border)] pt-2">
                          <span className="text-[var(--color-text-muted)]">{t("overview.setup_time_policy")}</span>
                          <span className="font-medium">
                            {data.setup_health.time_policy_row_present
                              ? t("overview.legend_present", "Present")
                              : "—"}
                          </span>
                        </li>
                        <li className="flex justify-between gap-2">
                          <span className="text-[var(--color-text-muted)]">{t("overview.setup_time_policy_config")}</span>
                          <span className="font-medium">
                            {data.setup_health.time_policy_configured
                              ? t("overview.legend_policy", "Likely yes")
                              : t("overview.legend_default", "Default-like")}
                          </span>
                        </li>
                      </ul>
                      <p className="mt-2 text-[10px] text-[var(--color-text-soft)]">
                        {t(
                          "overview.long_open_shift_note",
                          "Long-open shift threshold on this page: {{hours}}h UTC since clock-in.",
                          { hours: data.long_open_shift_threshold_hours },
                        )}
                      </p>
                    </>
                  )}
                </div>
              </PanelFrame>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <BarChartBlock
                emptyHint={t("overview.trend_attendance_empty")}
                rows={attendanceRows}
                title={t("overview.trend_attendance")}
              />
              <BarChartBlock
                emptyHint={
                  data.payroll_status === "not_calculated"
                    ? t("overview.payroll_not_calc_weeks")
                    : t("overview.trend_payroll_empty_no_history")
                }
                rows={payrollRows}
                title={t("overview.trend_payroll")}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] lg:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                    {t("overview.recent_activity")}
                  </p>
                  {user.system_role === "administrator" ? (
                    <Link className="text-xs font-medium text-[var(--color-link)] underline" href="/system/audit-log">
                      {t("overview.view_all_activity")}
                    </Link>
                  ) : (
                    <span className="text-xs text-[var(--color-text-muted)]">{t("overview.company_scoped_events")}</span>
                  )}
                </div>
                <ul className="max-h-80 divide-y divide-[var(--color-border)] overflow-y-auto">
                  {data.recent_activity.length === 0 ? (
                    <li className="px-4 py-6 text-sm text-[var(--color-text-muted)]">{t("overview.no_recent_events")}</li>
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
                    {t("overview.quick_actions")}
                  </p>
                </div>
                <ul className="divide-y divide-[var(--color-border)]">
                  {[
                    { key: "emp", label: t("overview.quick_add_employee"), href: "/employees" },
                    { key: "loc", label: t("overview.quick_add_location"), href: "/locations" },
                    { key: "live", label: t("overview.link_live_attendance"), href: "/live-attendance" },
                    { key: "pay", label: t("overview.quick_run_payroll"), href: "/payroll-report" },
                    { key: "week", label: t("overview.link_week_report"), href: "/week-report" },
                    { key: "site", label: t("overview.link_site_progress"), href: "/work-progress-review" },
                  ].map((item) => (
                    <li key={item.key}>
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
