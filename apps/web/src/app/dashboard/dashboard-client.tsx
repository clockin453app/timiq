"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PageHeader, Sheet, SheetBody } from "../../components/ui";
import { isEmployee, useCurrentUser } from "../../features/auth";
import { fetchManagementSummary, type ManagementSummary } from "../../features/dashboard/api";
import { getClockStatus, type ClockStatus } from "../../features/time-clock/api";
import { useLiveShiftDurationParts } from "../../features/time-clock/shift-duration";
import { browserDefaultTimeZone } from "../../features/timesheets/week-utils";
import { formatPayrollWeekUkLabel } from "../../lib/week-label";

function describeShift(clock: ClockStatus): string {
  if (!clock.has_open_shift) {
    return "No open shift — clock in when your shift starts.";
  }
  if (clock.current_break_open) {
    return "On shift — currently on break.";
  }
  return "On shift — working.";
}

function formatClockLine(status: ClockStatus): string {
  if (status.status === "clocked_in") {
    return "Clocked in";
  }
  if (status.status === "clocked_out") {
    return "Clocked out";
  }
  return status.status.replace(/_/g, " ");
}

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
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
          {props.label}
        </p>
        <span
          className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${toneClass}`}
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

const PAYROLL_HOME_LABEL: Record<string, string> = {
  not_calculated: "Not calculated",
  pending: "Pending",
  pending_approval: "Pending approval",
  approved: "Approved",
  paid: "Paid",
  mixed: "Mixed",
};

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
          setClockError("Could not load clock status.");
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
  }, []);

  const quickLinks: { label: string; href: string | null; note?: string }[] = [
    { label: "Clock In / Out", href: "/clock" },
    { label: "Time Records", href: "/time-records" },
    { label: "Timesheets", href: "/timesheets" },
    { label: "Pay History", href: "/pay-history" },
    { label: "Starter Form", href: "/starter-form" },
    { label: "Site Progress", href: "/site-progress" },
    { label: "Profile", href: "/profile" },
  ];

  return (
    <Sheet>
      <PageHeader description={`Signed in as ${user.email}`} title="Dashboard" />

      <SheetBody className="min-w-0 space-y-4 md:p-5">
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
              Clock & shift
            </p>
            {clockStatus && clockStatus.has_open_shift ? (
              <StatusBadge tone="success">On shift</StatusBadge>
            ) : clockStatus ? (
              <StatusBadge tone="muted">Off shift</StatusBadge>
            ) : null}
          </div>

          <div className="p-4">
          {clockLoading ? (
            <p className="text-sm text-[var(--color-text-muted)]">Loading clock status…</p>
          ) : null}

          {!clockLoading && clockError ? (
            <p className="text-sm text-[var(--color-danger-700)]">{clockError}</p>
          ) : null}

          {!clockLoading && clockStatus ? (
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-[var(--color-text-muted)]">Current clock status</dt>
                <dd className="font-semibold text-[var(--color-text)]">{formatClockLine(clockStatus)}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-[var(--color-text-muted)]">Today hours</dt>
                <dd className="font-semibold text-[var(--color-text)]">Calculated after clock-out</dd>
              </div>
              {clockStatus.has_open_shift && clockStatus.open_shift_clock_in_at ? (
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <dt className="text-xs text-[var(--color-text-muted)]">Live shift time</dt>
                  <dd className="font-semibold text-[var(--color-text)]" suppressHydrationWarning>
                    On shift for{" "}
                    <span className="font-mono">
                      {onShiftDurationParts.hms || onShiftDurationParts.compact || "—"}
                    </span>
                    {onShiftDurationParts.compact && onShiftDurationParts.hms ? (
                      <span className="font-normal text-[var(--color-text-muted)]">
                        {" "}
                        ({onShiftDurationParts.compact})
                      </span>
                    ) : null}
                  </dd>
                </div>
              ) : null}
              <div className="flex flex-col gap-1 sm:col-span-2">
                <dt className="text-xs text-[var(--color-text-muted)]">Shift status</dt>
                <dd className="font-semibold text-[var(--color-text)]">{describeShift(clockStatus)}</dd>
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <dt className="text-xs text-[var(--color-text-muted)]">Assigned active locations</dt>
                <dd className="font-semibold tabular-nums text-[var(--color-text)]">
                  {clockStatus.active_location_count}
                </dd>
              </div>
            </dl>
          ) : null}
          </div>
        </div>

        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
          <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
              Quick links
            </p>
          </div>
          <ul className="divide-y divide-[var(--color-border)]">
            {quickLinks.map((item) => (
              <li key={item.label}>
                {item.href ? (
                  <Link
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-header)]"
                    href={item.href}
                  >
                    <span>{item.label}</span>
                    <span aria-hidden className="text-[var(--color-text-soft)]">
                      →
                    </span>
                  </Link>
                ) : (
                  <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm">
                    <span className="font-medium text-[var(--color-text)]">{item.label}</span>
                    <span className="text-xs text-[var(--color-text-muted)]">{item.note}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </SheetBody>
    </Sheet>
  );
}

function ManagementDashboard() {
  const [summary, setSummary] = useState<ManagementSummary | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent: boolean) => {
    if (!silent) {
      setLoading(true);
    }
    setLoadError("");
    try {
      const data = await fetchManagementSummary(null);
      setSummary(data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load dashboard summary.");
      if (!silent) {
        setSummary(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

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
      <PageHeader description="Workforce summary and payroll activity." title="Dashboard" />

      <SheetBody className="min-w-0 space-y-4 md:p-5">
        <p className="text-sm text-[var(--color-text-muted)]">
          For charts and deeper operational context, open the{" "}
          <Link className="font-medium text-[var(--color-link)] underline" href="/overview">
            Overview
          </Link>{" "}
          page.
        </p>

        {loading ? <p className="text-sm text-[var(--color-text-muted)]">Loading summary…</p> : null}
        {loadError ? <p className="text-sm text-[var(--color-danger-700)]">{loadError}</p> : null}

        {summary && !loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ManagementMetricLinkCard
              badge={`${rateLabel} today`}
              badgeTone="success"
              href="/live-attendance"
              label="Employees clocked in (open shifts)"
              subline={`${summary.live_present_today} present today of ${summary.live_total_employees} employees in scope`}
              value={String(summary.live_open_shifts)}
            />
            <ManagementMetricLinkCard
              badge={PAYROLL_HOME_LABEL[summary.payroll_status] ?? summary.payroll_status}
              badgeTone={payrollHomeTone(summary.payroll_status)}
              href="/payroll-report"
              label="Weekly payroll period"
              subline={
                summary.payroll_status === "not_calculated"
                  ? summary.payroll_message ?? "Payroll has not been calculated for this week."
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
              badge="Active"
              badgeTone="muted"
              href="/workplaces"
              label="Workplaces configured"
              subline={`${summary.active_location_count} active locations`}
              value={String(summary.active_workplace_count)}
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
