"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { WeekPickerBar } from "../../components/week-picker-bar";
import { PageHeader, Sheet, SheetBody } from "../../components/ui";
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

function StatCard(props: { label: string; value: string; hint?: string }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
      <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
          {props.label}
        </p>
      </div>
      <div className="px-3 py-3">
        <p className="text-xl font-semibold tabular-nums tracking-tight text-[var(--color-text)]">
          {props.value}
        </p>
        {props.hint ? (
          <p className="mt-2 text-xs leading-snug text-[var(--color-text-muted)]">{props.hint}</p>
        ) : null}
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

  const activityEmpty = Boolean(!loading && sheet && sheet.shift_count === 0);

  return (
    <Sheet>
      <PageHeader
        description="Summary for the selected week using policy-based counted and rounded time."
        title="Week report"
      />
      <SheetBody className="space-y-3 md:p-5">
        {management ? (
          <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-2.5 md:flex-row md:flex-wrap md:items-center md:justify-between">
            <div
              className="inline-flex w-fit rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-toolbar-well)] p-0.5"
              role="group"
              aria-label="Week report view"
            >
              <button
                className={segmentBtnClass(!adminMode)}
                onClick={() => setAdminMode(false)}
                type="button"
              >
                My report
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
            <div className="flex min-w-0 flex-1 flex-col gap-1 md:items-end md:text-right">
              {isAdministrator(user) ? (
                <p className="max-w-xl text-xs leading-snug text-[var(--color-text-muted)] md:text-right">
                  Administrators use employee accounts for week-level summaries.
                </p>
              ) : (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Switch to admin view to open another employee&apos;s week.
                </p>
              )}
            </div>
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
            Open shift in this week — finalize clock-out for final numbers.
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2.5 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">Loading week…</p>
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
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
            <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                Activity
              </p>
            </div>
            <div className="p-3">
              {activityEmpty ? (
                <div className="rounded border border-dashed border-[var(--color-border-dark)] bg-[var(--color-empty-panel-bg)] px-4 py-4 text-center">
                  <p className="text-sm font-semibold text-[var(--color-text)]">No shift activity this week</p>
                  <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-[var(--color-text-muted)]">
                    Completed shift segments will be counted here. If you are still clocked in, close the shift
                    to refresh totals.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-[var(--color-text)]">
                    Completed shift segments in range:{" "}
                    <span className="font-semibold tabular-nums">{sheet.shift_count}</span>
                  </p>
                  <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                    Locations:{" "}
                    {sheet.locations_worked.length > 0 ? sheet.locations_worked.join(", ") : "—"}
                  </p>
                </>
              )}
            </div>
          </div>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
