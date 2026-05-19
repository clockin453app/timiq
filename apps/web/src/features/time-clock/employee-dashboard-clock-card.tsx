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

function clockActionLabel(clockStatus: ClockStatus | null, t: EmployeeDashboardClockCardProps["t"]): string {
  if (!clockStatus) {
    return t("dashboard.open_clock", "Open clock");
  }
  if (clockStatus.has_open_shift) {
    return t("dashboard.action_clock_out", "Clock out");
  }
  return t("dashboard.action_clock_in", "Clock in");
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

export function EmployeeDashboardClockCard({
  clockStatus,
  clockLoading,
  clockError,
  onShiftDurationParts,
  formatClockLine,
  describeShift,
  t,
}: EmployeeDashboardClockCardProps) {
  const onShift = Boolean(clockStatus?.has_open_shift);
  const showLiveTimer = Boolean(clockStatus?.has_open_shift && clockStatus.open_shift_clock_in_at);
  const displayTimer = timerDisplay(clockLoading, clockStatus, onShiftDurationParts, t);

  return (
    <div className="w-full max-w-[20rem] min-w-0">
      <div className="flex aspect-square w-full min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] shadow-[var(--shadow-card)]">
        <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
            {t("dashboard.clock_shift_section", "Clock & shift")}
          </p>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            {clockStatus && onShift ? (
              <StatusBadge tone="success">{t("dashboard.on_shift_badge", "On shift")}</StatusBadge>
            ) : clockStatus ? (
              <StatusBadge tone="muted">{t("dashboard.off_shift_badge", "Off shift")}</StatusBadge>
            ) : null}
            {clockStatus && !clockLoading ? (
              <StatusBadge tone={onShift ? "success" : "muted"}>
                {onShift
                  ? t("dashboard.clocked_in_badge", "Clocked in")
                  : t("dashboard.clocked_out_badge", "Clocked out")}
              </StatusBadge>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
          <div
            className="flex min-h-0 flex-1 flex-col items-center justify-center text-center"
            suppressHydrationWarning
          >
            <p
              className={
                showLiveTimer
                  ? "font-mono text-4xl font-bold tabular-nums tracking-tight text-[var(--color-text)] sm:text-[2.75rem]"
                  : "text-xl font-semibold leading-snug text-[var(--color-text-muted)] sm:text-2xl"
              }
            >
              {displayTimer}
            </p>
            {showLiveTimer && onShiftDurationParts.compact ? (
              <p className="mt-1 text-xs text-[var(--color-text-muted)]" suppressHydrationWarning>
                {onShiftDurationParts.compact}
              </p>
            ) : null}
          </div>

          {clockError ? (
            <p className="mb-2 text-center text-xs text-[var(--color-danger-700)]">{clockError}</p>
          ) : null}

          <Link
            className={cn(
              "inline-flex w-full min-h-[2.75rem] items-center justify-center rounded-[var(--radius-md)] border text-base font-semibold no-underline",
              "border-[var(--color-btn-primary-border)] bg-[var(--color-btn-primary-bg)] text-[var(--color-btn-primary-fg)]",
              "hover:bg-[var(--color-btn-primary-hover-bg)] hover:border-[var(--color-btn-primary-hover-bg)]",
              uiClasses.transitionColors,
              uiClasses.focusRing,
            )}
            href="/clock"
          >
            {clockActionLabel(clockStatus, t)}
          </Link>

          {!clockLoading && clockStatus ? (
            <dl className="mt-4 grid gap-2 border-t border-[var(--color-border)] pt-3 text-xs">
              <div className="flex items-start justify-between gap-2">
                <dt className="text-[var(--color-text-muted)]">
                  {t("dashboard.current_clock_status", "Current clock status")}
                </dt>
                <dd className="text-right font-semibold text-[var(--color-text)]">
                  {formatClockLine(clockStatus)}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-2">
                <dt className="text-[var(--color-text-muted)]">
                  {t("dashboard.shift_status", "Shift status")}
                </dt>
                <dd className="max-w-[11rem] text-right font-medium leading-snug text-[var(--color-text)]">
                  {describeShift(clockStatus)}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-2">
                <dt className="text-[var(--color-text-muted)]">{t("dashboard.today_hours", "Today hours")}</dt>
                <dd className="text-right font-medium text-[var(--color-text)]">
                  {t("dashboard.today_hours_hint", "Calculated after clock-out")}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-2">
                <dt className="text-[var(--color-text-muted)]">
                  {t("dashboard.assigned_locations", "Assigned active locations")}
                </dt>
                <dd className="font-semibold tabular-nums text-[var(--color-text)]">
                  {clockStatus.active_location_count}
                </dd>
              </div>
            </dl>
          ) : null}
        </div>
      </div>
    </div>
  );
}
