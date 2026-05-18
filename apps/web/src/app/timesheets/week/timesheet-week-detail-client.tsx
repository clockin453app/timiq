"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { PageHeader, Sheet, SheetBody } from "../../../components/ui";
import { formatDurationSeconds } from "../../../features/time-records/format-duration";
import { BreakDeductionCell } from "../../../features/time-records/break-deduction-cell";
import {
  fetchMyTimesheetWeek,
  type TimesheetDayTotals,
  type TimesheetWeekResponse,
} from "../../../features/timesheets/api";
import { browserDefaultTimeZone } from "../../../features/timesheets/week-utils";
import { useLiveShiftDurationParts } from "../../../features/time-clock/shift-duration";
import { useT } from "../../../lib/i18n";
import { formatPayrollWeekUkLabel } from "../../../lib/week-label";

function dayHasAttendance(day: TimesheetDayTotals): boolean {
  return (
    day.actual_seconds > 0 ||
    day.counted_seconds > 0 ||
    day.rounded_seconds > 0 ||
    day.break_seconds > 0
  );
}

function formatDay(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    return isoDate;
  }
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(iso: string, timeZone?: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || undefined,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function OpenShiftLiveElapsed({ clockInAt }: { clockInAt: string }) {
  const parts = useLiveShiftDurationParts(clockInAt, true);
  return (
    <p className="mt-0.5 tabular-nums text-[var(--color-text)]">
      Elapsed:{" "}
      <span className="font-mono text-[var(--color-text)]" suppressHydrationWarning>
        {parts.hms || parts.compact || "—"}
      </span>
      {parts.hms && parts.compact ? (
        <span className="ml-1 text-[var(--color-text-muted)]">({parts.compact})</span>
      ) : null}
    </p>
  );
}

export function TimesheetWeekDetailClient(props: { weekStart: string }) {
  const { weekStart } = props;
  const t = useT();
  const [sheet, setSheet] = useState<TimesheetWeekResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      if (!weekStart) {
        setSheet(null);
        setError("Choose a week from the Timesheets list.");
        setLoading(false);
        return;
      }
      try {
        const data = await fetchMyTimesheetWeek(weekStart);
        if (!cancelled) {
          setSheet(data);
        }
      } catch {
        if (!cancelled) {
          setSheet(null);
          setError("Could not load this timesheet week.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [weekStart]);

  const daysWithAttendance = useMemo(
    () => sheet?.days.filter(dayHasAttendance) ?? [],
    [sheet],
  );
  const weekLabel = sheet
    ? formatPayrollWeekUkLabel(sheet.week_start, sheet.company_timezone || browserDefaultTimeZone(), false)
    : weekStart || "—";
  const hasShiftData = Boolean(
    sheet &&
      (daysWithAttendance.length > 0 ||
        sheet.completed_shift_count > 0 ||
        sheet.open_shifts.length > 0 ||
        sheet.week_actual_seconds > 0 ||
        sheet.week_counted_seconds > 0 ||
        sheet.week_rounded_seconds > 0),
  );

  return (
    <Sheet>
      <PageHeader
        title={t("timesheets.week_detail_title", "Timesheet week")}
        description={t(
          "timesheets.week_detail_description",
          "Selected week details from your approved time records.",
        )}
      />
      <SheetBody className="space-y-4">
        <div>
          <Link
            className="text-sm font-semibold text-[var(--color-text)] underline decoration-[var(--color-border-dark)] underline-offset-2 hover:text-[var(--color-text-muted)]"
            href="/timesheets"
          >
            ← {t("timesheets.back_to_list", "Back to Timesheets")}
          </Link>
        </div>

        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">{t("common.loading", "Loading…")}</p>
        ) : null}

        {!loading && sheet ? (
          <div className="space-y-4">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-3 text-sm">
              <p className="font-semibold text-[var(--color-text)]">{weekLabel}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-cell)] p-2">
                  <dt className="font-bold uppercase text-[var(--color-text-soft)]">Clocked</dt>
                  <dd className="mt-1 tabular-nums font-semibold text-[var(--color-text)]">
                    {formatDurationSeconds(sheet.week_actual_seconds)}
                  </dd>
                </div>
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-cell)] p-2">
                  <dt className="font-bold uppercase text-[var(--color-text-soft)]">Payable</dt>
                  <dd className="mt-1 tabular-nums font-semibold text-[var(--color-text)]">
                    {formatDurationSeconds(sheet.week_counted_seconds)}
                  </dd>
                </div>
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-cell)] p-2">
                  <dt className="font-bold uppercase text-[var(--color-text-soft)]">Payroll</dt>
                  <dd className="mt-1 tabular-nums font-semibold text-[var(--color-text)]">
                    {formatDurationSeconds(sheet.week_rounded_seconds)}
                  </dd>
                </div>
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-cell)] p-2">
                  <dt className="font-bold uppercase text-[var(--color-text-soft)]">Break</dt>
                  <dd className="mt-1 font-semibold text-[var(--color-text)]">
                    <BreakDeductionCell seconds={sheet.week_break_seconds} />
                  </dd>
                </div>
              </dl>
            </div>

            {!hasShiftData ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-empty-panel-bg)] px-4 py-5 text-center">
                <p className="text-sm font-semibold text-[var(--color-text)]">No shift data for this week.</p>
                <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-[var(--color-text-muted)]">
                  Completed shift rows will appear here once you have clocked in and out for the selected week.
                </p>
              </div>
            ) : null}

            {sheet.open_shifts.length > 0 ? (
              <div className="space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] border-l-4 border-l-amber-700/80 bg-[var(--color-header)] px-3 py-3 text-sm text-[var(--color-text)]">
                <p className="text-xs font-bold uppercase tracking-wide text-[#374151]">Open shift</p>
                <ul className="space-y-2">
                  {sheet.open_shifts.map((shift) => (
                    <li
                      className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2 text-xs"
                      key={shift.shift_id}
                    >
                      <p className="font-semibold text-[var(--color-text)]">{shift.location_name}</p>
                      <p className="mt-1 text-[var(--color-text-muted)]">
                        Clocked in{" "}
                        <span className="font-medium text-[var(--color-text)]">
                          {formatDateTime(shift.clock_in_at, sheet.company_timezone)}
                        </span>
                      </p>
                      {shift.clock_in_at ? <OpenShiftLiveElapsed clockInAt={shift.clock_in_at} /> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {daysWithAttendance.length > 0 ? (
              <div className="space-y-2">
                {daysWithAttendance.map((day) => (
                  <div
                    className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm shadow-sm"
                    key={day.date}
                  >
                    <p className="font-semibold text-[var(--color-text)]">{formatDay(day.date)}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[var(--color-text-muted)]">
                      <span>Clocked {formatDurationSeconds(day.actual_seconds)}</span>
                      <span>Payable {formatDurationSeconds(day.counted_seconds)}</span>
                      <span>Payroll {formatDurationSeconds(day.rounded_seconds)}</span>
                      <span>
                        Break <BreakDeductionCell seconds={day.break_seconds} />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
