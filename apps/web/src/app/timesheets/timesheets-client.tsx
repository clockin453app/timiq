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

  return (
    <Sheet>
      <PageHeader
        title="Timesheets"
        description="Weekly totals by day using counted and rounded time from policy (not raw clock span)."
      />
      <SheetBody className="space-y-3">
        {management ? (
          <div className="flex flex-wrap items-center gap-3 border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2 text-sm">
            <label className="flex items-center gap-2 font-semibold text-[var(--color-text)]">
              <input
                checked={!adminMode}
                className="h-4 w-4"
                onChange={() => setAdminMode(false)}
                type="radio"
              />
              My week
            </label>
            <label className="flex items-center gap-2 font-semibold text-[var(--color-text)]">
              <input
                checked={adminMode}
                className="h-4 w-4"
                onChange={() => {
                  setAdminMode(true);
                  alignedOnce.current = true;
                }}
                type="radio"
              />
              Admin view
            </label>
            {isAdministrator(user) ? (
              <span className="text-xs text-[var(--color-text-muted)]">
                Administrators use employee accounts for weekly payroll-style totals.
              </span>
            ) : null}
          </div>
        ) : null}

        {adminMode && management ? (
          <label className="block max-w-md text-xs font-bold text-[var(--color-text)]">
            Employee
            <select
              className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
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
          <div className="border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm">
            This week includes an open shift; totals may change after clock-out.
          </div>
        ) : null}

        {error ? (
          <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
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
                    <TableCell className="text-xs">
                      {formatDurationSeconds(day.actual_seconds)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDurationSeconds(day.counted_seconds)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDurationSeconds(day.rounded_seconds)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDurationSeconds(day.break_seconds)}
                    </TableCell>
                  </TableRow>
                ))
              : null}
            {!loading && sheet ? (
              <TableRow>
                <TableCell className="font-semibold">Week total</TableCell>
                <TableCell className="text-xs font-semibold">
                  {formatDurationSeconds(sheet.week_actual_seconds)}
                </TableCell>
                <TableCell className="text-xs font-semibold">
                  {formatDurationSeconds(sheet.week_counted_seconds)}
                </TableCell>
                <TableCell className="text-xs font-semibold">
                  {formatDurationSeconds(sheet.week_rounded_seconds)}
                </TableCell>
                <TableCell className="text-xs font-semibold">
                  {formatDurationSeconds(sheet.week_break_seconds)}
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
