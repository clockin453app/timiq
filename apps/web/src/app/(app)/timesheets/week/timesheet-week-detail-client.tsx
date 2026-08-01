"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { PageHeader, Sheet, SheetBody } from "@/components/ui";
import { formatDurationSeconds } from "@/features/time-records/format-duration";
import { BreakDeductionCell } from "@/features/time-records/break-deduction-cell";
import { formatMoneyGBP } from "@/features/payroll/format";
import {
  fetchMyTimesheetWeek,
  type TimesheetDayTotals,
  type TimesheetWeekResponse,
} from "@/features/timesheets/api";
import { addDaysIsoYmd, browserDefaultTimeZone } from "@/features/timesheets/week-utils";
import {
  formatExtraHoursDuration,
  listMyExtraHours,
  reasonLabel,
  type TimesheetExtraHoursRow,
} from "@/features/timesheet-extra-hours/api";
import { useLiveShiftDurationParts } from "@/features/time-clock/shift-duration";
import { useT } from "@/lib/i18n";
import { formatPayrollWeekUkLabel } from "@/lib/week-label";

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

function formatDateShort(iso: string | null | undefined): string {
  if (!iso) {
    return "—";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function formatHoursDecimal(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) {
    return "—";
  }
  const hours = seconds / 3600;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/\.?0+$/, "");
}

function InfoRow(props: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(88px,0.7fr)_minmax(0,1fr)] gap-2 py-1 text-[length:var(--text-body)] sm:grid-cols-[minmax(120px,0.7fr)_minmax(0,1fr)] sm:gap-4 sm:py-1.5">
      <dt className="min-w-0 break-words font-bold text-[#667797]">{props.label}:</dt>
      <dd
        className={`min-w-0 break-words font-extrabold text-[#00143d] ${props.emphasize ? "text-[length:var(--text-section-title)]" : ""}`}
      >
        {props.value}
      </dd>
    </div>
  );
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
  const [extraHours, setExtraHours] = useState<TimesheetExtraHoursRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      if (!weekStart) {
        setSheet(null);
        setExtraHours([]);
        setError("Choose a week from the Timesheets list.");
        setLoading(false);
        return;
      }
      try {
        const [data, extras] = await Promise.all([
          fetchMyTimesheetWeek(weekStart),
          listMyExtraHours({
            start_date: weekStart,
            end_date: addDaysIsoYmd(weekStart, 7),
          }),
        ]);
        if (!cancelled) {
          setSheet(data);
          setExtraHours(extras);
        }
      } catch {
        if (!cancelled) {
          setSheet(null);
          setExtraHours([]);
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
  const payableExtras = useMemo(
    () => extraHours.filter((row) => row.affects_payroll),
    [extraHours],
  );
  const extrasByDate = useMemo(() => {
    const map = new Map<string, TimesheetExtraHoursRow[]>();
    for (const row of payableExtras) {
      const list = map.get(row.work_date) ?? [];
      list.push(row);
      map.set(row.work_date, list);
    }
    return map;
  }, [payableExtras]);
  const payableExtraSeconds = useMemo(
    () => payableExtras.reduce((sum, row) => sum + row.duration_minutes * 60, 0),
    [payableExtras],
  );
  const dayDates = useMemo(() => {
    const dates = new Set<string>();
    for (const day of daysWithAttendance) {
      dates.add(day.date);
    }
    for (const row of payableExtras) {
      dates.add(row.work_date);
    }
    return [...dates].sort();
  }, [daysWithAttendance, payableExtras]);
  const weekLabel = sheet
    ? formatPayrollWeekUkLabel(sheet.week_start, sheet.company_timezone || browserDefaultTimeZone(), false)
    : weekStart || "—";
  const paymentDate = sheet ? formatDateShort(sheet.paid_at ?? sheet.approved_at) : "—";
  const companyName = sheet?.company_name?.trim() || "—";
  const rateValue = sheet?.hourly_rate_snapshot ? formatMoneyGBP(sheet.hourly_rate_snapshot) : null;
  const overtimeValue =
    sheet?.overtime_seconds !== null && sheet?.overtime_seconds !== undefined
      ? formatHoursDecimal(sheet.overtime_seconds)
      : null;
  const totalPayableSeconds = (sheet?.week_counted_seconds ?? 0) + payableExtraSeconds;
  const hasShiftData = Boolean(
    sheet &&
      (dayDates.length > 0 ||
        sheet.completed_shift_count > 0 ||
        sheet.open_shifts.length > 0 ||
        sheet.week_actual_seconds > 0 ||
        sheet.week_counted_seconds > 0 ||
        sheet.week_rounded_seconds > 0 ||
        payableExtras.length > 0),
  );

  return (
    <Sheet>
      <PageHeader
        title={t("timesheets.week_detail_title", "Past Time logs")}
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
          <div className="mx-auto max-w-[980px] rounded-[22px] border border-[#dbe3ee] bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)] md:p-6">
            <div className="space-y-4">
              <section className="rounded-[18px] border border-[#dbe3ee] bg-[#f8fbff] px-5 py-4">
                <h2 className="text-lg font-extrabold text-[#00143d]">General Info</h2>
                <dl className="mt-1">
                  <InfoRow label="Period" value={weekLabel} />
                  <InfoRow label="Payment Date" value={paymentDate} />
                  <InfoRow label="Company" value={companyName.toUpperCase()} />
                </dl>
              </section>

              <section className="rounded-[18px] border border-[#dbe3ee] bg-[#f8fbff] px-5 py-4">
                <h2 className="text-lg font-extrabold text-[#00143d]">Estimated Earnings</h2>
                <dl className="mt-1">
                  <InfoRow label="Hours/Days" value={formatHoursDecimal(totalPayableSeconds)} />
                  {rateValue ? <InfoRow label="Rate" value={rateValue} /> : null}
                  {overtimeValue ? <InfoRow label="OT Hours/Days" value={overtimeValue} /> : null}
                  <InfoRow label="Gross Pay" value={formatMoneyGBP(sheet.gross_amount)} emphasize />
                  {payableExtraSeconds > 0 ? (
                    <InfoRow
                      label="Payable adjustments"
                      value={formatExtraHoursDuration(Math.round(payableExtraSeconds / 60))}
                    />
                  ) : null}
                </dl>
              </section>
            </div>

            {!hasShiftData ? (
              <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-empty-panel-bg)] px-4 py-5 text-center">
                <p className="text-sm font-semibold text-[var(--color-text)]">No shift data for this week.</p>
                <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-[var(--color-text-muted)]">
                  Completed shift rows will appear here once you have clocked in and out for the selected week.
                </p>
              </div>
            ) : null}

            {sheet.open_shifts.length > 0 ? (
              <div className="mt-4 space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] border-l-4 border-l-amber-700/80 bg-[var(--color-header)] px-3 py-3 text-sm text-[var(--color-text)]">
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

            {dayDates.length > 0 ? (
              <div className="mt-4 space-y-2" data-testid="past-time-logs-day-cards">
                <p className="text-xs font-bold uppercase tracking-wide text-[#64748b]">Shift details</p>
                {dayDates.map((dateIso) => {
                  const day = daysWithAttendance.find((d) => d.date === dateIso);
                  const dayExtras = extrasByDate.get(dateIso) ?? [];
                  return (
                    <div
                      className="min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm shadow-sm"
                      key={dateIso}
                    >
                      <p className="font-semibold text-[var(--color-text)]">{formatDay(dateIso)}</p>
                      {day ? (
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[var(--color-text-muted)]">
                          <span>Clocked {formatDurationSeconds(day.actual_seconds)}</span>
                          <span>Payable {formatDurationSeconds(day.counted_seconds)}</span>
                          <span>Payroll {formatDurationSeconds(day.rounded_seconds)}</span>
                          <span>
                            Break <BreakDeductionCell seconds={day.break_seconds} />
                          </span>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                          No clocked shift on this date.
                        </p>
                      )}
                      {dayExtras.map((eh) => (
                        <div
                          className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs"
                          data-testid="payable-adjustment-row"
                          key={eh.id}
                        >
                          <span className="font-semibold tabular-nums text-[var(--color-text)]">
                            +{formatExtraHoursDuration(eh.duration_minutes)}
                          </span>
                          <span className="text-[var(--color-text-muted)]">{reasonLabel(eh.reason)}</span>
                          <span className="inline-block rounded border border-[var(--color-success-700)]/40 bg-[var(--color-success-50)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-success-700)]">
                            Payable adjustment
                          </span>
                        </div>
                      ))}
                      {dayExtras.length > 0 && day ? (
                        <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
                          Total payable:{" "}
                          <span className="font-semibold tabular-nums text-[var(--color-text)]">
                            {formatDurationSeconds(
                              day.counted_seconds +
                                dayExtras.reduce((sum, eh) => sum + eh.duration_minutes * 60, 0),
                            )}
                          </span>
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
