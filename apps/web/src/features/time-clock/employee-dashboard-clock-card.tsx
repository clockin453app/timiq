"use client";

import Link from "next/link";

import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";
import type { ClockStatus } from "./api";

type DurationParts = { compact: string; hms: string };

type EmployeeDashboardClockCardProps = {
  clockStatus: ClockStatus | null;
  clockLoading: boolean;
  clockError: string;
  onShiftDurationParts: DurationParts;
  formatClockLine: (status: ClockStatus) => string;
  describeShift: (clock: ClockStatus) => string;
  t: (key: string, fallback?: string, vars?: Record<string, string>) => string;
};

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

function clockActionLabel(t: EmployeeDashboardClockCardProps["t"]): string {
  return t("dashboard.open_clock", "Open clock");
}

function timerDisplay(
  clockLoading: boolean,
  clockStatus: ClockStatus | null,
  onShiftDurationParts: DurationParts,
  t: EmployeeDashboardClockCardProps["t"],
): string {
  if (clockLoading || !clockStatus) {
    return t("dashboard.checking_status", "Checking status…");
  }
  if (clockStatus.has_open_shift && clockStatus.open_shift_clock_in_at) {
    return onShiftDurationParts.hms || onShiftDurationParts.compact || "—";
  }
  if (clockStatus.status === "clocked_out") {
    return t("dashboard.clocked_out", "Clocked out");
  }
  return t("dashboard.not_clocked_in", "Not clocked in");
}

function statusBadgeLabel(
  clockStatus: ClockStatus,
  onShift: boolean,
  t: EmployeeDashboardClockCardProps["t"],
): string {
  if (onShift) {
    return t("dashboard.clocked_in_badge", "Clocked in");
  }
  if (clockStatus.status === "clocked_out") {
    return t("dashboard.clocked_out_badge", "Clocked out");
  }
  return t("dashboard.not_clocked_in", "Not clocked in");
}

export function EmployeeDashboardClockCard({
  clockStatus,
  clockLoading,
  clockError,
  onShiftDurationParts,
  t,
}: EmployeeDashboardClockCardProps) {
  const onShift = Boolean(clockStatus?.has_open_shift);
  const showLiveTimer = Boolean(clockStatus?.has_open_shift && clockStatus.open_shift_clock_in_at);
  const displayTimer = timerDisplay(clockLoading, clockStatus, onShiftDurationParts, t);

  return (
    <div className="w-full min-w-0">
      <div className="w-full min-w-0 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-header)] px-4 py-2.5">
          <p className="text-sm font-semibold text-[var(--color-text)]">{t("nav.clock", "Clock In / Out")}</p>
          {clockStatus && !clockLoading ? (
            <StatusBadge tone={onShift ? "success" : "muted"}>
              {statusBadgeLabel(clockStatus, onShift, t)}
            </StatusBadge>
          ) : null}
        </div>

        <div className="px-4 py-5">
          <div className="py-6 text-center" suppressHydrationWarning>
            <p
              className={
                showLiveTimer
                  ? "font-mono text-4xl font-bold tabular-nums tracking-tight text-[var(--color-text)] sm:text-5xl"
                  : "text-2xl font-semibold leading-snug text-[var(--color-text-muted)]"
              }
            >
              {displayTimer}
            </p>
          </div>

          {clockError ? (
            <p className="mb-3 text-center text-xs text-[var(--color-danger-700)]">{clockError}</p>
          ) : null}

          <Link
            className={cn(
              "inline-flex w-full min-h-[3rem] items-center justify-center rounded-[var(--radius-md)] border text-base font-semibold no-underline",
              "border-[var(--color-btn-primary-border)] bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-fg)]",
              "hover:bg-[var(--color-btn-primary-hover-bg)] hover:border-[var(--color-btn-primary-hover-bg)]",
              uiClasses.transitionColors,
              uiClasses.focusRing,
            )}
            href="/clock"
          >
            {clockActionLabel(t)}
          </Link>

          {!clockLoading && clockStatus ? (
            <div className="mt-4 space-y-1 border-t border-[var(--color-border)] pt-3 text-center text-xs text-[var(--color-text-muted)]">
              {onShift && clockStatus.open_shift_location_name ? (
                <p className="truncate font-medium text-[var(--color-text)]">
                  {clockStatus.open_shift_location_name}
                </p>
              ) : null}
              <p>
                {t("dashboard.assigned_locations", "Assigned active locations")}:{" "}
                <span className="font-semibold tabular-nums text-[var(--color-text)]">
                  {clockStatus.active_location_count}
                </span>
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
