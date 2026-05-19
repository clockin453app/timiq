"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PageHeader, Sheet, SheetBody } from "../../components/ui";
import { isAdministrator, isEmployee, useCurrentUser } from "../../features/auth";
import { readStoredCompanyId } from "../../features/companies/selected-company";
import { fetchManagementSummary, type ManagementSummary } from "../../features/dashboard/api";
import { getClockStatus, type ClockStatus } from "../../features/time-clock/api";
import { EmployeeDashboardClockCard } from "../../features/time-clock/employee-dashboard-clock-card";
import { useLiveShiftDurationParts } from "../../features/time-clock/shift-duration";
import { browserDefaultTimeZone } from "../../features/timesheets/week-utils";
import { payrollStatusLabel } from "../../lib/i18n/display-labels";
import { useT } from "../../lib/i18n";
import { formatPayrollWeekUkLabel } from "../../lib/week-label";

function StatusBadge(props: { tone: "success" | "warning" | "muted"; children: string }) {
  const toneClass =
    props.tone === "success"
      ? "border-[var(--color-success-700)] bg-[var(--color-success-50)] text-[var(--color-success-700)]"
      : props.tone === "warning"
        ? "border-[var(--color-warning-700)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]"
        : "border-[var(--color-border-dark)] bg-[var(--color-header)] text-[var(--color-text-muted)]";
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${toneClass}`}
    >
      {props.children}
    </span>
  );
}

function ManagementMetricLinkCard(props: {
  href: string;
  label: string;
  value: string;
  badge: string;
  badgeTone: "success" | "warning" | "muted";
  subline?: string;
}) {
  const toneClass =
    props.badgeTone === "success"
      ? "border-[var(--color-success-700)] bg-[var(--color-success-50)] text-[var(--color-success-700)]"
      : props.badgeTone === "warning"
        ? "border-[var(--color-warning-700)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]"
        : "border-[var(--color-border-dark)] bg-[var(--color-header)] text-[var(--color-text-muted)]";
  return (
    <Link
      className="block min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] shadow-sm transition-colors hover:border-[var(--color-border)] hover:bg-[#f3f4f6]"
      href={props.href}
    >
      <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
        <p className="min-w-0 truncate text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
          {props.label}
        </p>
        <span
          className={`inline-flex shrink-0 items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${toneClass}`}
        >
          {props.badge}
        </span>
      </div>
      <div className="px-3 py-4">
        <p className="text-xl font-semibold tabular-nums tracking-tight text-[var(--color-text)]">{props.value}</p>
        {props.subline ? (
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">{props.subline}</p>
        ) : null}
      </div>
    </Link>
  );
}

function payrollHomeTone(status: string): "success" | "warning" | "muted" {
  if (status === "paid" || status === "approved") {
    return "success";
  }
  if (status === "not_calculated") {
    return "muted";
  }
  return "warning";
}

function EmployeeDashboard() {
  const t = useT();
  const user = useCurrentUser();
  const [clockStatus, setClockStatus] = useState<ClockStatus | null>(null);
  const [clockError, setClockError] = useState("");
  const [clockLoading, setClockLoading] = useState(true);

  const onShiftDurationParts = useLiveShiftDurationParts(
    clockStatus?.open_shift_clock_in_at,
    Boolean(clockStatus?.has_open_shift && clockStatus?.open_shift_clock_in_at),
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setClockLoading(true);
      setClockError("");
      try {
        const data = await getClockStatus();
        if (!cancelled) {
          setClockStatus(data);
        }
      } catch {
        if (!cancelled) {
          setClockStatus(null);
          setClockError(t("dashboard.clock_error", "Could not load clock status."));
        }
      } finally {
        if (!cancelled) {
          setClockLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const quickLinks: { labelKey: string; fallback: string; href: string }[] = [
    { labelKey: "nav.clock", fallback: "Clock In / Out", href: "/clock" },
    { labelKey: "nav.time_records", fallback: "Time Records", href: "/time-records" },
    { labelKey: "nav.timesheets", fallback: "Timesheets", href: "/timesheets" },
    { labelKey: "nav.pay_history", fallback: "Pay History", href: "/pay-history" },
    { labelKey: "nav.starter_form", fallback: "Starter Form", href: "/starter-form" },
    { labelKey: "nav.site_progress", fallback: "Site Progress", href: "/site-progress" },
    { labelKey: "nav.profile", fallback: "Profile", href: "/profile" },
  ];

  function describeShift(clock: ClockStatus): string {
    if (!clock.has_open_shift) {
      return t("dashboard.no_open_shift", "No open shift — clock in when your shift starts.");
    }
    if (clock.current_break_open) {
      return t("dashboard.on_break", "On shift — currently on break.");
    }
    return t("dashboard.on_shift", "On shift — working.");
  }

  function formatClockLine(status: ClockStatus): string {
    if (status.status === "clocked_in") {
      return t("dashboard.clocked_in", "Clocked in");
    }
    if (status.status === "clocked_out") {
      return t("dashboard.clocked_out", "Clocked out");
    }
    return status.status.replace(/_/g, " ");
  }

  return (
    <Sheet>
      <PageHeader
        description={t("dashboard.signed_in_as", "Signed in as {{email}}", { email: user.email })}
        title={t("dashboard.emp_title", "Dashboard")}
      />

      <SheetBody className="min-w-0 space-y-4 md:p-5">
        <EmployeeDashboardClockCard
          clockError={clockError}
          clockLoading={clockLoading}
          clockStatus={clockStatus}
          describeShift={describeShift}
          formatClockLine={formatClockLine}
          onShiftDurationParts={onShiftDurationParts}
          t={t}
        />

        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
          <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
              {t("dashboard.quick_links", "Quick links")}
            </p>
          </div>
          <ul className="divide-y divide-[var(--color-border)]">
            {quickLinks.map((item) => (
              <li key={item.href}>
                <Link
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-header)]"
                  href={item.href}
                >
                  <span className="min-w-0 truncate">{t(item.labelKey, item.fallback)}</span>
                  <span aria-hidden className="shrink-0 text-[var(--color-text-soft)]">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </SheetBody>
    </Sheet>
  );
}

function ManagementDashboard() {
  const t = useT();
  const user = useCurrentUser();
  const adminNeedsCompany = isAdministrator(user);
  const [summary, setSummary] = useState<ManagementSummary | null>(null);
  const [loadError, setLoadError] = useState("");
  const [needsCompanySelection, setNeedsCompanySelection] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (silent: boolean) => {
      const companyId = adminNeedsCompany ? readStoredCompanyId() : null;
      if (adminNeedsCompany && !companyId) {
        setNeedsCompanySelection(true);
        setLoadError("");
        setSummary(null);
        setLoading(false);
        return;
      }
      setNeedsCompanySelection(false);
      if (!silent) {
        setLoading(true);
      }
      setLoadError("");
      try {
        const data = await fetchManagementSummary(companyId);
        setSummary(data);
      } catch (e) {
        const message = e instanceof Error ? e.message : "";
        if (adminNeedsCompany && message.toLowerCase().includes("company")) {
          setNeedsCompanySelection(true);
          setLoadError("");
        } else {
          setLoadError(message || t("dashboard.summary_error", "Could not load dashboard summary."));
        }
        if (!silent) {
          setSummary(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [adminNeedsCompany, t],
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

  const rateLabel =
    summary?.live_attendance_rate == null
      ? "—"
      : `${Math.round(summary.live_attendance_rate * 1000) / 10}%`;

  return (
    <Sheet>
      <PageHeader
        description={t("dashboard.mgmt_description", "Workforce summary and payroll activity.")}
        title={t("dashboard.mgmt_title", "Dashboard")}
      />

      <SheetBody className="min-w-0 space-y-4 md:p-5">
        <p className="text-sm text-[var(--color-text-muted)]">
          {t("dashboard.overview_hint", "For charts and deeper operational context, open the")}{" "}
          <Link className="font-medium text-[var(--color-link)] underline" href="/overview">
            {t("dashboard.overview_link", "Overview")}
          </Link>{" "}
          {t("dashboard.page", "page.")}
        </p>

        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            {t("dashboard.loading_summary", "Loading summary…")}
          </p>
        ) : null}
        {needsCompanySelection ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-5 text-sm text-[var(--color-text-muted)]">
            <p>
              {t(
                "dashboard.select_company_hint",
                "Select a company on the Overview page to view company dashboard data.",
              )}
            </p>
            <Link
              className="mt-3 inline-flex h-9 items-center rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-btn-secondary-bg)] px-3 text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-cell)]"
              href="/overview"
            >
              {t("dashboard.go_overview", "Go to Overview")}
            </Link>
          </div>
        ) : null}

        {loadError ? <p className="text-sm text-[var(--color-danger-700)]">{loadError}</p> : null}

        {summary && !loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ManagementMetricLinkCard
              badge={t("dashboard.metric_present_today", "{{rate}} today", { rate: rateLabel })}
              badgeTone="success"
              href="/live-attendance"
              label={t("dashboard.metric_live_attendance", "Employees clocked in (open shifts)")}
              subline={t(
                "dashboard.metric_live_subline",
                "{{present}} present today of {{total}} employees in scope",
                {
                  present: summary.live_present_today,
                  total: summary.live_total_employees,
                },
              )}
              value={String(summary.live_open_shifts)}
            />
            <ManagementMetricLinkCard
              badge={payrollStatusLabel(t, summary.payroll_status)}
              badgeTone={payrollHomeTone(summary.payroll_status)}
              href="/payroll-report"
              label={t("dashboard.metric_payroll_week", "Weekly payroll period")}
              subline={
                summary.payroll_status === "not_calculated"
                  ? (summary.payroll_message ??
                    t("dashboard.metric_payroll_not_calc", "Payroll has not been calculated for this week."))
                  : summary.payroll_week_start
                    ? formatPayrollWeekUkLabel(summary.payroll_week_start, browserDefaultTimeZone(), false)
                    : undefined
              }
              value={
                summary.payroll_total_gross != null
                  ? new Intl.NumberFormat("en-GB", {
                      style: "currency",
                      currency: "GBP",
                      maximumFractionDigits: 2,
                    }).format(summary.payroll_total_gross)
                  : "—"
              }
            />
            <ManagementMetricLinkCard
              badge={t("dashboard.badge_active", "Active")}
              badgeTone="muted"
              href="/locations"
              label={t("dashboard.metric_active_sites", "Active sites")}
              subline={t("dashboard.metric_locations_sub", "Operational locations for clocking")}
              value={String(summary.active_location_count)}
            />
          </div>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}

export function DashboardHome() {
  const user = useCurrentUser();

  if (isEmployee(user)) {
    return <EmployeeDashboard />;
  }

  return <ManagementDashboard />;
}
