"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { WeekPickerBar } from "../../components/week-picker-bar";
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
import {
  canAccessManagement,
  isAdministrator,
  listManagedUsers,
  useCurrentUser,
  type AuthUser,
} from "../../features/auth";
import { formatDurationSeconds } from "../../features/time-records/format-duration";
import {
  fetchAdminTimesheetWeek,
  fetchMyTimesheetWeek,
  type TimesheetWeekResponse,
} from "../../features/timesheets/api";
import {
  browserDefaultTimeZone,
  mondayWeekStartIso,
} from "../../features/timesheets/week-utils";

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

function TimesheetSummaryCard(props: { label: string; value: string }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
      <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
          {props.label}
        </p>
      </div>
      <div className="px-3 py-2.5">
        <p className="text-lg font-semibold tabular-nums text-[var(--color-text)]">{props.value}</p>
      </div>
    </div>
  );
}

function segmentBtnClass(active: boolean) {
  return [
    "rounded-[var(--radius-sm)] px-3 py-1.5 text-sm",
    active
      ? "border border-[var(--color-btn-active-border)] bg-[var(--color-btn-active-bg)] font-bold text-[var(--color-text)]"
      : "border border-transparent font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-header)] hover:text-[var(--color-text)]",
  ].join(" ");
}

export function TimesheetsClient() {
  const user = useCurrentUser();
  const management = canAccessManagement(user);

  const [weekStart, setWeekStart] = useState(() =>
    mondayWeekStartIso(new Date(), browserDefaultTimeZone()),
  );
  const [sheet, setSheet] = useState<TimesheetWeekResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const alignedOnce = useRef(false);

  const [adminMode, setAdminMode] = useState(false);
  const [managedUsers, setManagedUsers] = useState<AuthUser[]>([]);
  const [subjectUserId, setSubjectUserId] = useState("");

  const employeeOptions = useMemo(
    () => managedUsers.filter((u) => u.system_role === "employee"),
    [managedUsers],
  );

  useEffect(() => {
    if (!management || !adminMode) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const users = await listManagedUsers();
        if (!cancelled) {
          setManagedUsers(users);
        }
      } catch {
        if (!cancelled) {
          setManagedUsers([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [management, adminMode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        if (adminMode && management) {
          if (!subjectUserId.trim()) {
            setSheet(null);
            setError("Select an employee to load an admin timesheet.");
            setLoading(false);
            return;
          }
          const data = await fetchAdminTimesheetWeek(subjectUserId.trim(), weekStart);
          if (!cancelled) {
            setSheet(data);
          }
        } else {
          const data = await fetchMyTimesheetWeek(weekStart);
          if (cancelled) {
            return;
          }
          setSheet(data);
          if (!alignedOnce.current) {
            alignedOnce.current = true;
            const aligned = mondayWeekStartIso(new Date(), data.company_timezone);
            if (aligned !== weekStart) {
              setWeekStart(aligned);
            }
          }
        }
      } catch {
        if (!cancelled) {
          setSheet(null);
          setError("Could not load timesheet.");
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
  }, [weekStart, adminMode, management, subjectUserId]);

  const showEmptyShifts = Boolean(!loading && sheet && sheet.shift_count === 0);

  return (
    <Sheet>
      <PageHeader
        description="Weekly totals by day using counted and rounded time from policy (not raw clock span)."
        title="Timesheets"
      />
      <SheetBody className="space-y-3 md:p-5">
        {management ? (
          <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-2.5 md:flex-row md:flex-wrap md:items-center md:justify-between">
            <div
              className="inline-flex w-fit rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-toolbar-well)] p-0.5"
              role="group"
              aria-label="Timesheet view"
            >
              <button
                className={segmentBtnClass(!adminMode)}
                onClick={() => setAdminMode(false)}
                type="button"
              >
                My week
              </button>
              <button
                className={segmentBtnClass(adminMode)}
                onClick={() => {
                  setAdminMode(true);
                  alignedOnce.current = true;
                }}
                type="button"
              >
                Admin view
              </button>
            </div>
            {isAdministrator(user) ? (
              <p className="max-w-xl text-xs leading-snug text-[var(--color-text-muted)]">
                Administrators use employee accounts for weekly payroll-style totals.
              </p>
            ) : null}
          </div>
        ) : null}

        {adminMode && management ? (
          <label className="block max-w-md text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">Employee</span>
            <select
              className="mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]"
              onChange={(event) => setSubjectUserId(event.target.value)}
              value={subjectUserId}
            >
              <option value="">Choose employee…</option>
              {employeeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.email}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <WeekPickerBar
          disabled={loading}
          onWeekChange={setWeekStart}
          timezoneLabel={sheet?.company_timezone}
          weekStartIso={weekStart}
        />

        {sheet?.open_shift_in_week ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] border-l-4 border-l-[var(--color-warning-700)] bg-[var(--color-header)] px-3 py-2.5 text-sm text-[var(--color-text)]">
            This week includes an open shift; totals may change after clock-out.
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2.5 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        {!loading && sheet ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <TimesheetSummaryCard
              label="Actual total"
              value={formatDurationSeconds(sheet.week_actual_seconds)}
            />
            <TimesheetSummaryCard
              label="Counted total"
              value={formatDurationSeconds(sheet.week_counted_seconds)}
            />
            <TimesheetSummaryCard
              label="Rounded total"
              value={formatDurationSeconds(sheet.week_rounded_seconds)}
            />
            <TimesheetSummaryCard
              label="Break total"
              value={formatDurationSeconds(sheet.week_break_seconds)}
            />
          </div>
        ) : null}

        {showEmptyShifts ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-empty-panel-bg)] px-4 py-5 text-center">
            <p className="text-sm font-semibold text-[var(--color-text)]">No completed shifts this week</p>
            <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-[var(--color-text-muted)]">
              When you clock in and out for this payroll week, day rows and totals will appear in the table
              below. Open shifts are called out separately above.
            </p>
          </div>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead>Actual</TableHead>
              <TableHead>Counted</TableHead>
              <TableHead>Rounded</TableHead>
              <TableHead>Break</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5}>Loading…</TableCell>
              </TableRow>
            ) : null}
            {!loading && sheet
              ? sheet.days.map((day) => (
                  <TableRow key={day.date}>
                    <TableCell>{formatDay(day.date)}</TableCell>
                    <TableCell className="tabular-nums text-xs">
                      {formatDurationSeconds(day.actual_seconds)}
                    </TableCell>
                    <TableCell className="tabular-nums text-xs">
                      {formatDurationSeconds(day.counted_seconds)}
                    </TableCell>
                    <TableCell className="tabular-nums text-xs">
                      {formatDurationSeconds(day.rounded_seconds)}
                    </TableCell>
                    <TableCell className="tabular-nums text-xs">
                      {formatDurationSeconds(day.break_seconds)}
                    </TableCell>
                  </TableRow>
                ))
              : null}
            {!loading && sheet ? (
              <TableRow className="timiq-table-total-row">
                <TableCell className="font-semibold">Week total</TableCell>
                <TableCell className="tabular-nums text-xs font-semibold">
                  {formatDurationSeconds(sheet.week_actual_seconds)}
                </TableCell>
                <TableCell className="tabular-nums text-xs font-semibold">
                  {formatDurationSeconds(sheet.week_counted_seconds)}
                </TableCell>
                <TableCell className="tabular-nums text-xs font-semibold">
                  {formatDurationSeconds(sheet.week_rounded_seconds)}
                </TableCell>
                <TableCell className="tabular-nums text-xs font-semibold">
                  {formatDurationSeconds(sheet.week_break_seconds)}
                </TableCell>
              </TableRow>
            ) : null}
            {!loading && !sheet ? (
              <TableRow>
                <TableCell className="text-[var(--color-text-muted)]" colSpan={5}>
                  No timesheet loaded for this selection.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        {!loading && sheet ? (
          <p className="text-xs text-[var(--color-text-muted)]">
            Shifts recorded: {sheet.shift_count}. Locations:{" "}
            {sheet.locations_worked.length > 0 ? sheet.locations_worked.join(", ") : "—"}.
          </p>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
