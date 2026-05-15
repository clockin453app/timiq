"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { WeekPickerBar } from "../../components/week-picker-bar";
import {
  Button,
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
import { listCompanies, type Company } from "../../features/companies/api";
import { useLiveShiftDurationParts } from "../../features/time-clock/shift-duration";
import { BreakDeductionCell } from "../../features/time-records/break-deduction-cell";
import { formatDurationSeconds } from "../../features/time-records/format-duration";
import { PayrollRoundingHint } from "../../features/time-records/payroll-rounding-hint";
import { formatPayrollWeekUkLabel } from "../../lib/week-label";
import {
  downloadAdminCompanyTimesheetWeekCsv,
  downloadAdminTimesheetWeekCsv,
  downloadMyTimesheetWeekCsv,
  fetchAdminCompanyTimesheetWeek,
  fetchAdminTimesheetWeek,
  fetchMyTimesheetWeek,
  type AdminTimesheetWeekAllEmployeesResponse,
  type TimesheetDayTotals,
  type TimesheetWeekResponse,
  type WeekLeaveRow,
} from "../../features/timesheets/api";
import { leaveTypeLabel } from "../../features/leave/labels";
import {
  browserDefaultTimeZone,
  mondayWeekStartIso,
} from "../../features/timesheets/week-utils";

const ALL_EMPLOYEES_VALUE = "__all__";

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

function dayHasAttendance(day: TimesheetDayTotals): boolean {
  return (
    day.actual_seconds > 0 ||
    day.counted_seconds > 0 ||
    day.rounded_seconds > 0 ||
    day.break_seconds > 0
  );
}

function employeeCell(name: string | null | undefined, email: string) {
  const n = name?.trim();
  if (n) {
    return `${n} (${email})`;
  }
  return email;
}

function TimesheetWeekSummaryLine(props: {
  weekStart: string;
  timeZone?: string;
  clocked: number;
  payable: number;
  payroll: number;
  breakSeconds: number;
}) {
  const weekLabel = props.timeZone
    ? formatPayrollWeekUkLabel(props.weekStart, props.timeZone, false)
    : props.weekStart;
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2.5 text-sm">
      <p className="font-semibold text-[var(--color-text)]">{weekLabel}</p>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-[var(--color-text-muted)]">
        <div>
          <dt className="inline">Clocked: </dt>
          <dd className="inline tabular-nums font-semibold text-[var(--color-text)]">
            {formatDurationSeconds(props.clocked)}
          </dd>
        </div>
        <div>
          <dt className="inline">Payable: </dt>
          <dd className="inline tabular-nums font-semibold text-[var(--color-text)]">
            {formatDurationSeconds(props.payable)}
          </dd>
        </div>
        <div>
          <dt className="inline">Payroll: </dt>
          <dd className="inline tabular-nums font-semibold text-[var(--color-text)]">
            {formatDurationSeconds(props.payroll)}
          </dd>
        </div>
        <div>
          <dt className="inline">Break deducted: </dt>
          <dd className="inline">
            <BreakDeductionCell seconds={props.breakSeconds} />
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
        Payable and payroll totals are after automatic break deduction from clocked time (completed shifts only).
      </p>
      <PayrollRoundingHint
        className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-text-muted)]"
        clockedSeconds={props.clocked}
        payableSeconds={props.payable}
        payrollSeconds={props.payroll}
      />
    </div>
  );
}

function OpenShiftLiveElapsed({ clockInAt }: { clockInAt: string }) {
  const parts = useLiveShiftDurationParts(clockInAt, true);
  return (
    <p className="mt-0.5 tabular-nums text-[var(--color-text)]">
      Elapsed (running):{" "}
      <span className="font-mono text-[var(--color-text)]" suppressHydrationWarning>
        {parts.hms || parts.compact || "—"}
      </span>
      {parts.hms && parts.compact ? (
        <span className="ml-1 text-[var(--color-text-muted)]">({parts.compact})</span>
      ) : null}
    </p>
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
  const [companySheet, setCompanySheet] = useState<AdminTimesheetWeekAllEmployeesResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const alignedOnce = useRef(false);

  const [adminMode, setAdminMode] = useState(false);
  const [managedUsers, setManagedUsers] = useState<AuthUser[]>([]);
  const [subjectUserId, setSubjectUserId] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyOverride, setCompanyOverride] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");

  const activeCompanyId = useMemo(() => {
    if (isAdministrator(user)) {
      return companyOverride;
    }
    return user.company_id;
  }, [user, companyOverride]);

  const employeeOptions = useMemo(() => {
    const cid = isAdministrator(user) ? activeCompanyId : user.company_id;
    let list = managedUsers.filter((u) => u.system_role === "employee");
    if (cid) {
      list = list.filter((u) => u.company_id === cid);
    }
    return list.slice().sort((a, b) => (a.email || "").localeCompare(b.email || ""));
  }, [managedUsers, user, activeCompanyId]);

  const viewingAllEmployees = Boolean(adminMode && management && subjectUserId === ALL_EMPLOYEES_VALUE);
  const timezoneLabel = sheet?.company_timezone ?? companySheet?.company_timezone;

  useEffect(() => {
    if (!isAdministrator(user)) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await listCompanies();
        if (!cancelled) {
          setCompanies(list.filter((c) => c.is_active));
        }
      } catch {
        if (!cancelled) {
          setCompanies([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!isAdministrator(user) || companies.length === 0 || companyOverride !== null) {
      return;
    }
    setCompanyOverride(companies[0].id);
  }, [user, companies, companyOverride]);

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
            setCompanySheet(null);
            setError('Select an employee or "All employees".');
            setLoading(false);
            return;
          }
          if (subjectUserId === ALL_EMPLOYEES_VALUE) {
            if (isAdministrator(user) && !activeCompanyId) {
              setSheet(null);
              setCompanySheet(null);
              setError("Select a company.");
              setLoading(false);
              return;
            }
            if (!isAdministrator(user) && !user.company_id) {
              setSheet(null);
              setCompanySheet(null);
              setError("Your account is not linked to a company.");
              setLoading(false);
              return;
            }
            const data = await fetchAdminCompanyTimesheetWeek(
              weekStart,
              isAdministrator(user) ? activeCompanyId : null,
            );
            if (!cancelled) {
              setCompanySheet(data);
              setSheet(null);
            }
          } else {
            const data = await fetchAdminTimesheetWeek(subjectUserId.trim(), weekStart);
            if (!cancelled) {
              setSheet(data);
              setCompanySheet(null);
            }
          }
        } else {
          const data = await fetchMyTimesheetWeek(weekStart);
          if (cancelled) {
            return;
          }
          setSheet(data);
          setCompanySheet(null);
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
          setCompanySheet(null);
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
  }, [weekStart, adminMode, management, subjectUserId, activeCompanyId, user]);

  const completedCount = viewingAllEmployees
    ? (companySheet?.completed_shift_count ?? 0)
    : sheet != null && typeof sheet.completed_shift_count === "number"
      ? sheet.completed_shift_count
      : (sheet?.shift_count ?? 0);

  const openShiftsSingle = sheet?.open_shifts ?? [];
  const openShiftsAll = companySheet?.open_shifts ?? [];
  const showNoCompleted = Boolean(
    !loading &&
      (viewingAllEmployees
        ? companySheet && companySheet.completed_shift_count === 0
        : Boolean(sheet && completedCount === 0)),
  );
  const daysWithAttendance = sheet?.days.filter(dayHasAttendance) ?? [];

  const hasExportableData =
    !loading &&
    !error &&
    (adminMode && management
      ? viewingAllEmployees
        ? Boolean(companySheet && companySheet.completed_shift_count > 0)
        : Boolean(sheet && sheet.completed_shift_count > 0)
      : Boolean(sheet && sheet.completed_shift_count > 0));

  async function handleExportCsv() {
    setExportError("");
    setExportBusy(true);
    try {
      if (adminMode && management) {
        if (!subjectUserId.trim()) {
          setExportError('Select an employee or "All employees".');
          return;
        }
        if (subjectUserId === ALL_EMPLOYEES_VALUE) {
          if (isAdministrator(user) && !activeCompanyId) {
            setExportError("Select a company.");
            return;
          }
          if (!isAdministrator(user) && !user.company_id) {
            setExportError("Your account is not linked to a company.");
            return;
          }
          await downloadAdminCompanyTimesheetWeekCsv(
            weekStart,
            isAdministrator(user) ? activeCompanyId : null,
          );
        } else {
          await downloadAdminTimesheetWeekCsv(subjectUserId.trim(), weekStart);
        }
      } else {
        await downloadMyTimesheetWeekCsv(weekStart);
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <Sheet>
      <PageHeader
        description="Completed shifts only: day rows and week totals use payable and payroll time from company policy. Open shifts are listed separately and are not included in those totals."
        title="Timesheets"
      />
      <SheetBody className="min-w-0 space-y-3 md:p-5">
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
                Pick a company, then one employee or all employees for that company. Only your selected company is
                loaded on the server.
              </p>
            ) : null}
          </div>
        ) : null}

        {adminMode && management && isAdministrator(user) ? (
          <label className="block max-w-md text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">Company</span>
            <select
              className="timiq-select mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]"
              onChange={(event) => setCompanyOverride(event.target.value || null)}
              value={companyOverride ?? ""}
            >
              <option value="">Choose company…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {adminMode && management ? (
          <label className="block max-w-md text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">Employee</span>
            <select
              className="timiq-select mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]"
              onChange={(event) => setSubjectUserId(event.target.value)}
              value={subjectUserId}
            >
              <option value="">Choose employee…</option>
              <option value={ALL_EMPLOYEES_VALUE}>All employees</option>
              {employeeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.email}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">
            <WeekPickerBar
              disabled={loading}
              onWeekChange={setWeekStart}
              payrollTimeZone={sheet?.company_timezone ?? companySheet?.company_timezone}
              timezoneLabel={timezoneLabel}
              weekStartIso={weekStart}
            />
          </div>
          {adminMode && management ? (
            <Button
              className="h-10 w-full shrink-0 sm:w-auto"
              disabled={exportBusy || !hasExportableData}
              onClick={() => void handleExportCsv()}
              type="button"
              variant="secondary"
            >
              {exportBusy ? "Exporting…" : "Export CSV"}
            </Button>
          ) : null}
        </div>

        {exportError ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2.5 text-sm text-[var(--color-danger-700)]">
            {exportError}
          </div>
        ) : null}

        {!loading && sheet && !viewingAllEmployees && openShiftsSingle.length > 0 ? (
          <div className="space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] border-l-4 border-l-amber-700/80 bg-[var(--color-header)] px-3 py-3 text-sm text-[var(--color-text)]">
            <p className="text-xs font-bold uppercase tracking-wide text-[#374151]">Open shift (not in week totals)</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              Payable and payroll totals below include only completed shifts. Clocked elapsed while still clocked in is
              shown per shift.
            </p>
            <ul className="space-y-2">
              {openShiftsSingle.map((s) => (
                <li
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2 text-xs"
                  key={s.shift_id}
                >
                  <p className="font-semibold text-[var(--color-text)]">Live shift · {s.location_name}</p>
                  <p className="mt-1 text-[var(--color-text-muted)]">
                    Clocked in{" "}
                    <span className="font-medium text-[var(--color-text)]">
                      {formatDateTime(s.clock_in_at, sheet.company_timezone)}
                    </span>
                  </p>
                  {s.clock_in_at ? <OpenShiftLiveElapsed clockInAt={s.clock_in_at} /> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!loading && companySheet && viewingAllEmployees && openShiftsAll.length > 0 ? (
          <div className="space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] border-l-4 border-l-amber-700/80 bg-[var(--color-header)] px-3 py-3 text-sm text-[var(--color-text)]">
            <p className="text-xs font-bold uppercase tracking-wide text-[#374151]">
              Open shifts (not in completed totals)
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              Listed by employee. Payable and payroll totals below include only completed shifts.
            </p>
            <ul className="space-y-2">
              {openShiftsAll.map((s) => (
                <li
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2 text-xs"
                  key={s.shift_id}
                >
                  <p className="font-semibold text-[var(--color-text)]">
                    {employeeCell(s.employee_name, s.employee_email)} · {s.location_name}
                  </p>
                  <p className="mt-1 text-[var(--color-text-muted)]">
                    Clocked in{" "}
                    <span className="font-medium text-[var(--color-text)]">
                      {formatDateTime(s.clock_in_at, companySheet.company_timezone)}
                    </span>
                  </p>
                  {s.clock_in_at ? <OpenShiftLiveElapsed clockInAt={s.clock_in_at} /> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2.5 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        {!loading && sheet && !viewingAllEmployees ? (
          <TimesheetWeekSummaryLine
            breakSeconds={sheet.week_break_seconds}
            clocked={sheet.week_actual_seconds}
            payable={sheet.week_counted_seconds}
            payroll={sheet.week_rounded_seconds}
            timeZone={sheet.company_timezone}
            weekStart={sheet.week_start}
          />
        ) : null}

        {!loading && companySheet && viewingAllEmployees ? (
          <TimesheetWeekSummaryLine
            breakSeconds={companySheet.week_break_seconds}
            clocked={companySheet.week_clocked_seconds}
            payable={companySheet.week_payable_seconds}
            payroll={companySheet.week_payroll_seconds}
            timeZone={companySheet.company_timezone}
            weekStart={companySheet.week_start}
          />
        ) : null}

        {!loading && sheet && !viewingAllEmployees && (sheet.week_leave?.length ?? 0) > 0 ? (
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
            <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                Leave & absence (week overlap)
              </p>
            </div>
            <div className="overflow-x-auto p-2">
              <Table className="min-w-[560px] text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(sheet.week_leave ?? []).map((lv: WeekLeaveRow) => (
                    <TableRow key={lv.request_id}>
                      <TableCell>{leaveTypeLabel(lv.leave_type)}</TableCell>
                      <TableCell className="tabular-nums text-[var(--color-text-muted)]">
                        {lv.date_from} → {lv.date_to}
                      </TableCell>
                      <TableCell className="tabular-nums">{lv.total_days}</TableCell>
                      <TableCell>
                        <span
                          className={`inline-block rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${
                            lv.status === "approved"
                              ? "border-emerald-800/30 bg-emerald-50 text-emerald-950"
                              : "border-amber-800/30 bg-amber-50 text-amber-950"
                          }`}
                        >
                          {lv.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="border-t border-[var(--color-border-dark)] px-3 py-2 text-[11px] text-[var(--color-text-muted)]">
              Separate from clocked hours; for context only.
            </p>
          </div>
        ) : null}

        {showNoCompleted ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-empty-panel-bg)] px-4 py-5 text-center">
            <p className="text-sm font-semibold text-[var(--color-text)]">No completed shifts this week.</p>
            <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-[var(--color-text-muted)]">
              Day totals and the table below list only completed clock-in/out pairs. If anyone is still clocked in, see
              the open shift panel above.
            </p>
          </div>
        ) : null}

        {!loading && sheet && !viewingAllEmployees && completedCount > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead>Clocked time</TableHead>
                <TableHead>Payable time</TableHead>
                <TableHead>Payroll time</TableHead>
                <TableHead>Break deducted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {daysWithAttendance.map((day) => (
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
                  <TableCell className="text-xs">
                    <BreakDeductionCell seconds={day.break_seconds} />
                  </TableCell>
                </TableRow>
              ))}
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
                <TableCell className="text-xs font-semibold">
                  <BreakDeductionCell seconds={sheet.week_break_seconds} />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        ) : null}

        {!loading && companySheet && viewingAllEmployees && companySheet.completed_shift_count > 0 ? (
          <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Job title</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Clocked time</TableHead>
                  <TableHead>Payable time</TableHead>
                  <TableHead>Payroll time</TableHead>
                  <TableHead>Break deducted</TableHead>
                  <TableHead>Location / site</TableHead>
                  <TableHead>Completed shifts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companySheet.day_rows.map((row) => (
                  <TableRow key={`${row.user_id}-${row.date}`}>
                    <TableCell className="max-w-[200px] text-xs">
                      {employeeCell(row.employee_name, row.employee_email)}
                    </TableCell>
                    <TableCell className="text-xs text-[var(--color-text-muted)]">
                      {row.employee_job_title?.trim() || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{formatDay(row.date)}</TableCell>
                    <TableCell className="tabular-nums text-xs">{formatDurationSeconds(row.clocked_seconds)}</TableCell>
                    <TableCell className="tabular-nums text-xs">{formatDurationSeconds(row.payable_seconds)}</TableCell>
                    <TableCell className="tabular-nums text-xs">{formatDurationSeconds(row.payroll_seconds)}</TableCell>
                    <TableCell className="text-xs">
                      <BreakDeductionCell seconds={row.break_seconds} />
                    </TableCell>
                    <TableCell className="max-w-[220px] text-xs text-[var(--color-text-muted)]">
                      {row.locations.length > 0 ? row.locations.join(", ") : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-xs">{row.completed_shifts_count}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="timiq-table-total-row">
                  <TableCell className="font-semibold" colSpan={3}>
                    Week total (all employees)
                  </TableCell>
                  <TableCell className="tabular-nums text-xs font-semibold">
                    {formatDurationSeconds(companySheet.week_clocked_seconds)}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs font-semibold">
                    {formatDurationSeconds(companySheet.week_payable_seconds)}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs font-semibold">
                    {formatDurationSeconds(companySheet.week_payroll_seconds)}
                  </TableCell>
                  <TableCell className="text-xs font-semibold">
                    <BreakDeductionCell seconds={companySheet.week_break_seconds} />
                  </TableCell>
                  <TableCell />
                  <TableCell className="tabular-nums text-xs font-semibold">
                    {companySheet.completed_shift_count}
                  </TableCell>
                </TableRow>
              </TableBody>
          </Table>
        ) : null}

        {!loading && !sheet && !companySheet ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-4 py-4 text-sm text-[var(--color-text-muted)]">
            No timesheet loaded for this selection.
          </div>
        ) : null}

        {!loading && sheet && !viewingAllEmployees ? (
          <p className="text-xs text-[var(--color-text-muted)]">
            Completed shifts this week: {completedCount}
            {sheet.shift_count !== completedCount ? ` · All shift records in week: ${sheet.shift_count}` : ""}.
            Locations (completed): {sheet.locations_worked.length > 0 ? sheet.locations_worked.join(", ") : "—"}.
          </p>
        ) : null}

        {!loading && companySheet && viewingAllEmployees ? (
          <p className="text-xs text-[var(--color-text-muted)]">
            Completed shifts this week (company): {companySheet.completed_shift_count}
            {openShiftsAll.length > 0 ? ` · Open shifts in week: ${openShiftsAll.length}` : ""}.
          </p>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
