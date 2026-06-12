"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Info,
  MapPin,
  Users,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  Badge,
  Button,
  PageHeader,
  SectionCard,
  Sheet,
  SheetBody,
  StatusBadge,
} from "../../components/ui";
import { isAdministrator, useCurrentUser } from "../../features/auth";
import {
  fetchManagementOverview,
  type NeedsAttentionItem,
  type OverviewData,
  type PayrollReadinessPanel,
  type SetupHealthPanel,
  type TodayLiveRow,
} from "../../features/dashboard/api";
import { CompanySelector } from "../../features/companies/company-selector";
import { listCompanies, type Company } from "../../features/companies/api";
import { useAdministratorCompanyScope } from "../../features/companies/selected-company";
import { formatMoneyGBP } from "../../features/payroll/format";
import { formatDurationSeconds } from "../../features/time-records/format-duration";
import { cn } from "../../lib/cn";
import { payrollStatusLabel, useT } from "../../lib/i18n";
import { uiClasses } from "../../lib/ui-classes";

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

function badgeToneFromPayroll(tone: "success" | "warning" | "muted"): "success" | "warning" | "default" {
  if (tone === "success") {
    return "success";
  }
  if (tone === "warning") {
    return "warning";
  }
  return "default";
}

const NEEDS_ATTENTION_ROW_CLASS: Record<string, string> = {
  critical:
    "border-[var(--color-danger-700)]/20 bg-[var(--color-danger-50)] hover:border-[var(--color-danger-700)]/35",
  warning:
    "border-[var(--color-warning-700)]/25 bg-[var(--color-warning-50)] hover:border-[var(--color-warning-700)]/40",
  info: "border-[var(--color-border-dark)] bg-[var(--color-header)] hover:border-[var(--color-border)]",
};

function NeedsAttentionIcon(props: { severity: string }) {
  if (props.severity === "critical") {
    return <CircleAlert aria-hidden className="h-4 w-4 shrink-0 text-[var(--color-danger-700)]" />;
  }
  if (props.severity === "warning") {
    return <AlertTriangle aria-hidden className="h-4 w-4 shrink-0 text-[var(--color-warning-700)]" />;
  }
  return <Info aria-hidden className="h-4 w-4 shrink-0 text-[var(--color-text-soft)]" />;
}

function formatPercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) {
    return "—";
  }
  return `${Math.round(rate * 1000) / 10}%`;
}

function OverviewMetricCard(props: {
  href: string;
  title: string;
  primary: string;
  secondary?: string;
  badge?: string;
  badgeTone?: "success" | "warning" | "muted";
  icon: LucideIcon;
}) {
  const Icon = props.icon;
  const badgeTone = props.badgeTone ?? "muted";

  return (
    <Link
      className={cn(
        uiClasses.card,
        "group block min-w-0 transition-[border-color,box-shadow,transform]",
        "duration-[var(--motion-duration-fast)] ease-[var(--motion-ease-standard)]",
        "hover:border-[var(--color-brand)]/25 hover:shadow-[var(--shadow-soft)]",
      )}
      href={props.href}
    >
      <div className="flex items-start justify-between gap-3 p-4 sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-brand-muted)] text-[var(--color-brand)]">
            <Icon aria-hidden className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
              {props.title}
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-[var(--color-text)]">
              {props.primary}
            </p>
            {props.secondary ? (
              <p className="mt-2 text-sm leading-snug text-[var(--color-text-muted)]">{props.secondary}</p>
            ) : null}
          </div>
        </div>
        {props.badge ? (
          <Badge className="shrink-0" tone={badgeToneFromPayroll(badgeTone)}>
            {props.badge}
          </Badge>
        ) : null}
      </div>
    </Link>
  );
}

function OverviewAttentionCard(props: {
  title: string;
  scopeNote: string | null;
  emptyLabel: string;
  items: NeedsAttentionItem[];
}) {
  return (
    <SectionCard
      className="border-[var(--color-warning-700)]/20 shadow-[var(--shadow-card)]"
      description={props.scopeNote ?? undefined}
      title={props.title}
    >
      {props.items.length === 0 ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-header)] px-4 py-3 text-sm text-[var(--color-text-muted)]">
          <CheckCircle2 aria-hidden className="h-4 w-4 shrink-0 text-[var(--color-success-700)]" />
          <span>{props.emptyLabel}</span>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {props.items.map((item) => (
            <li key={item.code}>
              <Link
                className={cn(
                  "flex items-center justify-between gap-3 rounded-[var(--radius-md)] border px-3 py-3 text-sm transition-colors",
                  NEEDS_ATTENTION_ROW_CLASS[item.severity] ?? NEEDS_ATTENTION_ROW_CLASS.info,
                )}
                href={item.href}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <NeedsAttentionIcon severity={item.severity} />
                  <span className="min-w-0 font-medium text-[var(--color-text)]">{item.label}</span>
                </span>
                <span className="inline-flex min-w-[2rem] shrink-0 items-center justify-center rounded-[var(--radius-full)] bg-white/80 px-2 py-0.5 text-sm font-bold tabular-nums text-[var(--color-text)] shadow-sm">
                  {item.count}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function ReadinessStatChip(props: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
        {props.label}
      </p>
      <p className="mt-1 text-base font-semibold tabular-nums text-[var(--color-text)]">{props.value}</p>
    </div>
  );
}

function OverviewReadinessPanel(props: {
  readiness: PayrollReadinessPanel | null;
  unavailableLabel: string;
  t: ReturnType<typeof useT>;
}) {
  const { readiness, t } = props;

  if (!readiness) {
    return (
      <SectionCard title={t("overview.payroll_readiness", "Payroll readiness")}>
        <p className="text-sm text-[var(--color-text-muted)]">{props.unavailableLabel}</p>
      </SectionCard>
    );
  }

  const yesNo = (value: boolean) => (value ? t("common.yes", "Yes") : t("common.no", "No"));

  return (
    <SectionCard
      action={
        <Link
          className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-brand)] hover:text-[var(--color-brand-hover)]"
          href={readiness.href}
        >
          {t("overview.open_payroll_report")}
          <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      }
      description={readiness.scope_note ?? undefined}
      title={t("overview.payroll_readiness", "Payroll readiness")}
    >
      <div className="space-y-4">
        <StatusBadge status={readiness.payroll_status}>
          {payrollStatusLabel(t, readiness.payroll_status)}
        </StatusBadge>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <ReadinessStatChip label={t("overview.readiness_items", "Items")} value={readiness.total_items} />
          <ReadinessStatChip label={t("overview.readiness_pending", "Pending")} value={readiness.pending_count} />
          <ReadinessStatChip label={t("overview.readiness_approved", "Approved")} value={readiness.approved_count} />
          <ReadinessStatChip label={t("overview.readiness_paid", "Paid")} value={readiness.paid_count} />
          <ReadinessStatChip
            label={t("overview.readiness_rate_missing", "Rate missing")}
            value={readiness.rate_missing_count}
          />
          <ReadinessStatChip
            label={t("overview.readiness_open_shifts_week", "Open shifts (week)")}
            value={readiness.open_shifts_started_in_week_count}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge tone={readiness.payroll_period_not_calculated ? "warning" : "default"}>
            {t("overview.readiness_not_calculated", "Not calculated")}: {yesNo(readiness.payroll_period_not_calculated)}
          </Badge>
          <Badge tone={readiness.payroll_needs_recalculation ? "warning" : "default"}>
            {t("overview.readiness_needs_recalc", "Needs recalc")}: {yesNo(readiness.payroll_needs_recalculation)}
          </Badge>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
            {t("overview.readiness_gross_hours", "Gross / hours")}
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--color-text)]">
            {readiness.total_gross != null ? formatMoneyGBP(String(readiness.total_gross)) : "—"} ·{" "}
            {formatDurationSeconds(readiness.total_hours_seconds)}
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

function HealthCheckRow(props: {
  label: string;
  value: ReactNode;
  href?: string;
  bordered?: boolean;
}) {
  const valueNode = props.href ? (
    <Link className="font-semibold text-[var(--color-brand)] hover:text-[var(--color-brand-hover)]" href={props.href}>
      {props.value}
    </Link>
  ) : (
    <span className="font-semibold text-[var(--color-text)]">{props.value}</span>
  );

  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3 py-2.5 text-sm",
        props.bordered ? "border-t border-[var(--color-border)] pt-3" : undefined,
      )}
    >
      <span className="text-[var(--color-text-muted)]">{props.label}</span>
      {valueNode}
    </li>
  );
}

function OverviewHealthPanel(props: {
  health: SetupHealthPanel | null;
  noScopeLabel: string;
  thresholdNote: string;
  t: ReturnType<typeof useT>;
}) {
  const { health, t } = props;

  if (!health) {
    return (
      <SectionCard title={t("overview.setup_health", "Setup health")}>
        <p className="text-sm text-[var(--color-text-muted)]">{props.noScopeLabel}</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard description={health.scope_note ?? undefined} title={t("overview.setup_health", "Setup health")}>
      <ul className="divide-y divide-[var(--color-border)]">
        <HealthCheckRow
          label={t("overview.setup_active_employees")}
          value={health.active_employee_count}
        />
        <HealthCheckRow
          label={t("overview.setup_active_locations")}
          value={health.active_location_count}
        />
        <HealthCheckRow
          href="/employees"
          label={t("overview.setup_missing_hourly_rate")}
          value={health.employees_missing_hourly_rate_count}
        />
        <HealthCheckRow
          href="/site-access"
          label={t("overview.setup_no_site_access")}
          value={health.employees_without_site_access_count}
        />
        <HealthCheckRow
          bordered
          label={t("overview.setup_time_policy")}
          value={
            health.time_policy_row_present ? (
              <Badge tone="success">{t("overview.legend_present", "Present")}</Badge>
            ) : (
              "—"
            )
          }
        />
        <HealthCheckRow
          label={t("overview.setup_time_policy_config")}
          value={
            <Badge tone={health.time_policy_configured ? "success" : "default"}>
              {health.time_policy_configured
                ? t("overview.legend_policy", "Likely yes")
                : t("overview.legend_default", "Default-like")}
            </Badge>
          }
        />
      </ul>
      <p className="mt-3 text-xs leading-snug text-[var(--color-text-soft)]">{props.thresholdNote}</p>
    </SectionCard>
  );
}

function OverviewTrendCard(props: {
  title: string;
  emptyHint: string;
  rows: { key: string; label: string; value: number; display: string; max: number }[];
}) {
  const max = Math.max(1, ...props.rows.map((r) => r.max));

  return (
    <SectionCard title={props.title}>
      {props.rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">{props.emptyHint}</p>
      ) : (
        <div className="space-y-3">
          {props.rows.map((row) => (
            <div className="min-w-0" key={row.key}>
              <div className="flex justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-[var(--color-text-muted)]">{row.label}</span>
                <span className="shrink-0 tabular-nums font-medium text-[var(--color-text)]">{row.display}</span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[var(--color-header)]">
                <div
                  className="h-full rounded-full bg-[var(--color-brand)]/55 transition-[width] duration-[var(--motion-duration-fast)]"
                  style={{ width: `${Math.min(100, (row.value / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function TodayLivePanel(props: {
  title: string;
  viewAllLabel: string;
  emptyLabel: string;
  rows: TodayLiveRow[];
}) {
  return (
    <SectionCard
      action={
        <Link
          className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-brand)] hover:text-[var(--color-brand-hover)]"
          href="/live-attendance"
        >
          {props.viewAllLabel}
          <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      }
      title={props.title}
    >
      {props.rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">{props.emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {props.rows.map((row, idx) => (
            <li key={`${row.display_name}-${row.clock_in_at}-${idx}`}>
              <Link
                className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-transparent px-3 py-2.5 text-sm transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-header)] sm:flex-row sm:items-center sm:justify-between sm:gap-3"
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
                  <span className="block sm:inline">{new Date(row.clock_in_at).toLocaleString()}</span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function OverviewListLink(props: { href: string; label: string }) {
  return (
    <Link
      className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] px-3 py-2.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-header)]"
      href={props.href}
    >
      <span className="min-w-0">{props.label}</span>
      <ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-[var(--color-text-soft)]" />
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

  const thresholdNote = data
    ? t(
        "overview.long_open_shift_note",
        "Long-open shift threshold on this page: {{hours}}h UTC since clock-in.",
        { hours: data.long_open_shift_threshold_hours },
      )
    : "";

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

        {data?.generated_at && !loading ? (
          <p className="text-xs text-[var(--color-text-muted)]">
            {t("overview.last_updated", "Last updated {{time}}", {
              time: new Date(data.generated_at).toLocaleString(),
            })}
            <span className="mx-2 text-[var(--color-border-dark)]" aria-hidden>
              ·
            </span>
            {t(
              "overview.auto_refresh_note",
              "Auto-refreshes every 45 seconds when this tab is visible.",
            )}
          </p>
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
              <OverviewMetricCard
                badge={t("overview.badge_active", "Active")}
                badgeTone="muted"
                href="/employees"
                icon={Users}
                primary={String(data.active_employee_count)}
                secondary={t("overview.employees_subline")}
                title={t("overview.employees", "Employees")}
              />
              <OverviewMetricCard
                badge={t("overview.badge_sites", "Sites")}
                badgeTone="muted"
                href="/locations"
                icon={MapPin}
                primary={String(data.active_location_count)}
                secondary={t("overview.locations_sites_sub", "Operational sites for clocking and access")}
                title={t("overview.active_locations", "Active locations")}
              />
              <OverviewMetricCard
                badge={formatPercent(data.live_attendance_rate)}
                badgeTone="success"
                href="/live-attendance"
                icon={Activity}
                primary={`${data.live_present_today} / ${data.live_total_employees}`}
                secondary={t("overview.attendance_now_sub", "{{open}} open shift(s) now · attendance today", {
                  open: data.live_open_shifts,
                })}
                title={t("overview.attendance_today", "Attendance today")}
              />
              <OverviewMetricCard
                badge={payrollStatusLabel(t, data.payroll_status)}
                badgeTone={toneForPayrollStatus(data.payroll_status)}
                href="/payroll-report"
                icon={Wallet}
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

            <OverviewAttentionCard
              emptyLabel={t("overview.empty_attention")}
              items={data.needs_attention}
              scopeNote={data.needs_attention_scope_note}
              title={t("overview.needs_attention", "Needs attention")}
            />

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <OverviewReadinessPanel
                readiness={data.payroll_readiness}
                t={t}
                unavailableLabel={t("overview.payroll_readiness_unavailable")}
              />
              <OverviewHealthPanel
                health={data.setup_health}
                noScopeLabel={t("overview.no_company_scope")}
                t={t}
                thresholdNote={thresholdNote}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <TodayLivePanel
                emptyLabel={t("overview.no_open_shifts")}
                rows={data.today_live}
                title={t("overview.today_live", "Today live")}
                viewAllLabel={t("common.view_all", "View all")}
              />
              <OverviewTrendCard
                emptyHint={t("overview.trend_attendance_empty")}
                rows={attendanceRows}
                title={t("overview.trend_attendance")}
              />
            </div>

            <OverviewTrendCard
              emptyHint={
                data.payroll_status === "not_calculated"
                  ? t("overview.payroll_not_calc_weeks")
                  : t("overview.trend_payroll_empty_no_history")
              }
              rows={payrollRows}
              title={t("overview.trend_payroll")}
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <SectionCard
                action={
                  user.system_role === "administrator" ? (
                    <Link
                      className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-brand)] hover:text-[var(--color-brand-hover)]"
                      href="/system/audit-log"
                    >
                      {t("overview.view_all_activity")}
                      <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                    </Link>
                  ) : (
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {t("overview.company_scoped_events")}
                    </span>
                  )
                }
                className="lg:col-span-2"
                title={t("overview.recent_activity")}
              >
                {data.recent_activity.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">{t("overview.no_recent_events")}</p>
                ) : (
                  <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {data.recent_activity.map((row, idx) => (
                      <li
                        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2.5 text-sm"
                        key={`${row.occurred_at}-${idx}`}
                      >
                        <p className="font-medium text-[var(--color-text)]">{row.summary}</p>
                        {row.detail ? (
                          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{row.detail}</p>
                        ) : null}
                        <p className="mt-1 text-[10px] text-[var(--color-text-soft)]">
                          {new Date(row.occurred_at).toLocaleString()}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              <SectionCard title={t("overview.quick_actions")}>
                <ul className="space-y-1">
                  {[
                    { key: "emp", label: t("overview.quick_add_employee"), href: "/employees" },
                    { key: "loc", label: t("overview.quick_add_location"), href: "/locations" },
                    { key: "live", label: t("overview.link_live_attendance"), href: "/live-attendance" },
                    { key: "pay", label: t("overview.quick_run_payroll"), href: "/payroll-report" },
                    { key: "week", label: t("overview.link_week_report"), href: "/week-report" },
                    { key: "site", label: t("overview.link_site_progress"), href: "/work-progress-review" },
                  ].map((item) => (
                    <li key={item.key}>
                      <OverviewListLink href={item.href} label={item.label} />
                    </li>
                  ))}
                </ul>
              </SectionCard>
            </div>
          </>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
