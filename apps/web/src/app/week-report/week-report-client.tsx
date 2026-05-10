"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { WeekPickerBar } from "../../components/week-picker-bar";
import { PageHeader, Sheet, SheetBody } from "../../components/ui";
import {
  canAccessManagement,
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

function StatCard(props: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-cell)] p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
        {props.label}
      </p>
      <p className="mt-1 text-lg font-semibold text-[var(--color-text)]">{props.value}</p>
      {props.hint ? (
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">{props.hint}</p>
      ) : null}
    </div>
  );
}

export function WeekReportClient() {
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
            setError("Select an employee for this report.");
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
          setError("Could not load week report.");
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
        title="Week report"
        description="Summary for the selected week using policy-based counted and rounded time."
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
              My report
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
            Open shift in this week — finalize clock-out for final numbers.
          </div>
        ) : null}

        {error ? (
          <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        {!loading && sheet ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              hint="Raw elapsed including before standard start (shown for reference)."
              label="Actual time"
              value={formatDurationSeconds(sheet.week_actual_seconds)}
            />
            <StatCard
              hint="After standard start rule and break handling."
              label="Counted time"
              value={formatDurationSeconds(sheet.week_counted_seconds)}
            />
            <StatCard
              hint="Payroll will prefer this when rounding applies."
              label="Rounded time"
              value={formatDurationSeconds(sheet.week_rounded_seconds)}
            />
            <StatCard
              label="Break (deducted)"
              value={formatDurationSeconds(sheet.week_break_seconds)}
            />
          </div>
        ) : null}

        {!loading && sheet ? (
          <div className="border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
              Activity
            </p>
            <p className="mt-2 text-[var(--color-text)]">
              Completed shift segments in range:{" "}
              <span className="font-semibold">{sheet.shift_count}</span>
            </p>
            <p className="mt-2 text-[var(--color-text-muted)]">
              Locations:{" "}
              {sheet.locations_worked.length > 0 ? sheet.locations_worked.join(", ") : "—"}
            </p>
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">Loading week…</p>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
