"use client";

import { addDaysIsoYmd } from "../features/timesheets/week-utils";
import { Button } from "./ui";

export type WeekPickerBarProps = {
  weekStartIso: string;
  timezoneLabel?: string;
  disabled?: boolean;
  onWeekChange: (iso: string) => void;
};

export function WeekPickerBar({
  weekStartIso,
  timezoneLabel,
  disabled,
  onWeekChange,
}: WeekPickerBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2 text-sm">
      <Button
        disabled={disabled}
        onClick={() => onWeekChange(addDaysIsoYmd(weekStartIso, -7))}
        type="button"
      >
        Previous week
      </Button>
      <Button
        disabled={disabled}
        onClick={() => onWeekChange(addDaysIsoYmd(weekStartIso, 7))}
        type="button"
      >
        Next week
      </Button>
      <span className="text-[var(--color-text-muted)]">
        Week starting {weekStartIso}
        {timezoneLabel ? ` · ${timezoneLabel}` : ""}
      </span>
    </div>
  );
}
