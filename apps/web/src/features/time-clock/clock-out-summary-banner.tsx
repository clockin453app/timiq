"use client";

import { useEffect, useState } from "react";

import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";
import {
  CLOCK_OUT_SUMMARY_DISMISS_MS,
  type ClockOutSummary,
  formatClockedOutAtLocal,
  formatWorkedTodayLabel,
} from "./clock-out-summary";

type ClockOutSummaryBannerProps = {
  summary: ClockOutSummary;
  onDismiss: () => void;
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string;
  className?: string;
};

export function ClockOutSummaryBanner({
  className,
  onDismiss,
  summary,
  t,
}: ClockOutSummaryBannerProps) {
  const [visible, setVisible] = useState(true);
  const clockedOutLocal = formatClockedOutAtLocal(summary.clockedOutAt);
  const workedLabel = formatWorkedTodayLabel(summary.totalWorkedSecondsToday);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setVisible(false);
      onDismiss();
    }, CLOCK_OUT_SUMMARY_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [onDismiss]);

  if (!visible) {
    return null;
  }

  return (
    <div
      className={cn(
        "relative w-full min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-success-700)] border-l-4 bg-[var(--color-success-50)] px-3 py-2.5",
        "motion-safe:transition-opacity motion-safe:duration-200 motion-reduce:transition-none",
        className,
      )}
      data-testid="clock-out-summary-banner"
      role="status"
    >
      <button
        aria-label={t("dashboard.dismiss_shift_summary", "Dismiss shift summary")}
        className={cn(
          "absolute right-1.5 top-1.5 inline-flex h-8 w-8 items-center justify-center rounded text-[var(--color-success-700)]",
          "hover:bg-[var(--color-success-700)]/10",
          uiClasses.focusRing,
        )}
        data-testid="clock-out-summary-dismiss"
        onClick={() => {
          setVisible(false);
          onDismiss();
        }}
        type="button"
      >
        <span aria-hidden="true" className="text-lg leading-none">
          ×
        </span>
      </button>

      <div className="flex min-w-0 items-start gap-2.5 pr-8">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-success-700)] text-[13px] font-bold text-white"
        >
          ✓
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[var(--color-brand-navy-dark)]">
            {t("dashboard.shift_completed", "Shift completed")}
          </p>
          <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
            {t("dashboard.hours_worked_today", "Hours worked today")}
          </p>
          <p
            className="mt-0.5 text-[22px] font-bold tabular-nums leading-tight text-[var(--color-brand-navy-dark)]"
            data-testid="clock-out-summary-total"
          >
            {workedLabel}
          </p>
          {clockedOutLocal ? (
            <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
              {t("dashboard.clocked_out_at", "Clocked out at {{time}}", { time: clockedOutLocal })}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
