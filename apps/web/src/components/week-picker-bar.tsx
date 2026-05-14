"use client";

import { addDaysIsoYmd, browserDefaultTimeZone } from "../features/timesheets/week-utils";
import { formatPayrollWeekUkLabel } from "../lib/week-label";
import { Button } from "./ui";

export type WeekPickerBarProps = {
  weekStartIso: string;
  timezoneLabel?: string;
  /** IANA zone used for week number and date range (defaults to browser zone). */
  payrollTimeZone?: string;
  disabled?: boolean;
  onWeekChange: (iso: string) => void;
};

export function WeekPickerBar({
  weekStartIso,
  timezoneLabel,
  payrollTimeZone,
  disabled,
  onWeekChange,
}: WeekPickerBarProps) {
  const tz = (payrollTimeZone ?? "").trim() || browserDefaultTimeZone();
  const weekLabel = formatPayrollWeekUkLabel(weekStartIso, tz, false);
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] text-sm">
      <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 md:px-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
          Payroll week
        </p>
      </div>
      <div className="flex flex-col gap-2 bg-[var(--color-cell)] px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-2 md:px-4">
        <p className="min-w-0 flex-1 truncate font-semibold text-[var(--color-text)]">
          {weekLabel}
          {timezoneLabel ? (
            <span className="font-normal text-[var(--color-text-muted)]">
              {" "}
              · {timezoneLabel}
            </span>
          ) : null}
        </p>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            disabled={disabled}
            onClick={() => onWeekChange(addDaysIsoYmd(weekStartIso, -7))}
            size="sm"
            type="button"
            variant="secondary"
          >
            Previous
          </Button>
          <Button
            disabled={disabled}
            onClick={() => onWeekChange(addDaysIsoYmd(weekStartIso, 7))}
            size="sm"
            type="button"
            variant="secondary"
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
