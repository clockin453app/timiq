"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  PageHeader,
  Sheet,
  SheetBody,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui";
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
    { label: "Time Records", href: null, note: "Coming in next batch" },
    { label: "Timesheets", href: null, note: "Coming in next batch" },
    { label: "Pay History", href: null, note: "Coming in next batch" },
    { label: "Starter Form", href: null, note: "Coming in next batch" },
    { label: "Site Progress", href: null, note: "Coming in next batch" },
    { label: "Profile", href: "/profile" },
  ];

  return (
    <Sheet>
      <PageHeader
        title="Dashboard"
        description={`Welcome — signed in as ${user.email}`}
        action={<LogoutButton />}
      />

      <SheetBody className="space-y-4">
        <div className="border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            Clock & shift
          </p>

          {clockLoading ? (
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">Loading clock status…</p>
          ) : null}

          {!clockLoading && clockError ? (
            <p className="mt-2 text-sm text-[var(--color-danger-700)]">{clockError}</p>
          ) : null}

          {!clockLoading && clockStatus ? (
            <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex flex-col gap-0.5 border-t border-[var(--color-border)] pt-2 first:border-t-0 first:pt-0">
                <dt className="text-[var(--color-text-muted)]">Current clock status</dt>
                <dd className="font-medium text-[var(--color-text)]">{formatClockLine(clockStatus)}</dd>
              </div>
              <div className="flex flex-col gap-0.5 border-t border-[var(--color-border)] pt-2 sm:border-t-0 sm:pt-0">
                <dt className="text-[var(--color-text-muted)]">Today hours</dt>
                <dd className="font-medium text-[var(--color-text)]">
                  Coming in next batch{" "}
                  <span className="font-normal text-[var(--color-text-muted)]">
                    (time records / reporting)
                  </span>
                </dd>
              </div>
              <div className="flex flex-col gap-0.5 border-t border-[var(--color-border)] pt-2 sm:col-span-2">
                <dt className="text-[var(--color-text-muted)]">Shift status</dt>
                <dd className="font-medium text-[var(--color-text)]">{describeShift(clockStatus)}</dd>
              </div>
              <div className="flex flex-col gap-0.5 border-t border-[var(--color-border)] pt-2 sm:col-span-2">
                <dt className="text-[var(--color-text-muted)]">Assigned active locations</dt>
                <dd className="font-medium text-[var(--color-text)]">
                  {clockStatus.active_location_count}
                </dd>
              </div>
            </dl>
          ) : null}
        </div>

        <div className="border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            Quick links
          </p>
          <ul className="mt-2 space-y-2 text-sm">
            {quickLinks.map((item) => (
              <li key={item.label}>
                {item.href ? (
                  <Link
                    className="font-medium text-[var(--color-text)] underline decoration-[var(--color-border-dark)] underline-offset-2 hover:text-[var(--color-text-soft)]"
                    href={item.href}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span className="text-[var(--color-text)]">
                    {item.label}{" "}
                    <span className="text-[var(--color-text-muted)]">— {item.note}</span>
                  </span>
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
        title="Dashboard"
        description="Workforce summary and payroll activity."
        action={<LogoutButton />}
      />

      <SheetBody>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Metric</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            <TableRow>
              <TableCell>Employees clocked in</TableCell>
              <TableCell>0</TableCell>
              <TableCell>Ready</TableCell>
            </TableRow>

            <TableRow>
              <TableCell>Weekly payroll period</TableCell>
              <TableCell>Not started</TableCell>
              <TableCell>Setup required</TableCell>
            </TableRow>

            <TableRow>
              <TableCell>Workplaces configured</TableCell>
              <TableCell>0</TableCell>
              <TableCell>Setup required</TableCell>
            </TableRow>
          </TableBody>
        </Table>
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
