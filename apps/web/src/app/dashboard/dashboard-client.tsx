"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { PageHeader, Sheet, SheetBody } from "../../components/ui";
import { isEmployee, LogoutButton, useCurrentUser } from "../../features/auth";
import { getClockStatus, type ClockStatus } from "../../features/time-clock/api";

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

function ManagementMetricCard(props: {
  label: string;
  value: string;
  badge: string;
  badgeTone: "success" | "warning" | "muted";
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
          {props.label}
        </p>
        <StatusBadge tone={props.badgeTone}>{props.badge}</StatusBadge>
      </div>
      <div className="px-3 py-3">
        <p className="text-xl font-semibold tabular-nums tracking-tight text-[var(--color-text)]">
          {props.value}
        </p>
      </div>
    </div>
  );
}

function EmployeeDashboard() {
  const user = useCurrentUser();
  const [clockStatus, setClockStatus] = useState<ClockStatus | null>(null);
  const [clockError, setClockError] = useState("");
  const [clockLoading, setClockLoading] = useState(true);

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
    { label: "Site Progress", href: null, note: "Coming in next batch" },
    { label: "Profile", href: "/profile" },
  ];

  return (
    <Sheet>
      <PageHeader
        action={<LogoutButton />}
        description={`Signed in as ${user.email}`}
        title="Dashboard"
      />

      <SheetBody className="space-y-4 md:p-5">
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
                <dd className="font-semibold text-[var(--color-text)]">
                  Coming in next batch{" "}
                  <span className="font-normal text-[var(--color-text-muted)]">
                    (time records / reporting)
                  </span>
                </dd>
              </div>
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
  return (
    <Sheet>
      <PageHeader
        action={<LogoutButton />}
        description="Workforce summary and payroll activity."
        title="Dashboard"
      />

      <SheetBody className="md:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ManagementMetricCard
            badge="Ready"
            badgeTone="success"
            label="Employees clocked in"
            value="0"
          />
          <ManagementMetricCard
            badge="Setup required"
            badgeTone="warning"
            label="Weekly payroll period"
            value="Not started"
          />
          <ManagementMetricCard
            badge="Setup required"
            badgeTone="warning"
            label="Workplaces configured"
            value="0"
          />
        </div>
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
