"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
import { formatDurationSeconds } from "../../features/time-records/format-duration";
import {
  downloadAdminCompanyWeekReportCsv,
  downloadAdminTimesheetWeekCsv,
  downloadMyTimesheetWeekCsv,
  fetchAdminCompanyWeekReport,
  fetchAdminTimesheetWeek,
  fetchMyTimesheetWeek,
  type AdminWeekReportAllEmployeesResponse,
  type TimesheetWeekResponse,
  type WeekLeaveRow,
} from "../../features/timesheets/api";
import { leaveTypeLabel } from "../../features/leave/labels";
import {
  browserDefaultTimeZone,
  mondayWeekStartIso,
} from "../../features/timesheets/week-utils";

const ALL_EMPLOYEES_VALUE = "__all__";

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

function employeeCell(name: string | null | undefined, email: string) {
  const n = name?.trim();
  if (n) {
    return `${n} (${email})`;
  }
  return email;
}

export function WeekReportClient() {
  const user = useCurrentUser();
  const management = canAccessManagement(user);

  const [weekStart, setWeekStart] = useState(() =>
    mondayWeekStartIso(new Date(), browserDefaultTimeZone()),
  );
  const [sheet, setSheet] = useState<TimesheetWeekResponse | null>(null);
  const [companyReport, setCompanyReport] = useState<AdminWeekReportAllEmployeesResponse | null>(null);
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
  const timezoneLabel = sheet?.company_timezone ?? companyReport?.company_timezone;

  const companyWeekLeaveFlat = useMemo(() => {
    if (!companyReport) {
      return [] as { employee: string; leave: WeekLeaveRow }[];
    }
    const out: { employee: string; leave: WeekLeaveRow }[] = [];
    for (const emp of companyReport.employees) {
      const label = employeeCell(emp.employee_name, emp.employee_email);
      for (const lv of emp.week_leave ?? []) {
        out.push({ employee: label, leave: lv });
      }
    }
    return out;
  }, [companyReport]);

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
            setCompanyReport(null);
            setError('Select an employee or "All employees".');
            setLoading(false);
            return;
          }
          if (subjectUserId === ALL_EMPLOYEES_VALUE) {
            if (isAdministrator(user) && !activeCompanyId) {
              setSheet(null);
              setCompanyReport(null);
              setError("Select a company.");
              setLoading(false);
              return;
            }
            if (!isAdministrator(user) && !user.company_id) {
              setSheet(null);
              setCompanyReport(null);
              setError("Your account is not linked to a company.");
              setLoading(false);
              return;
            }
            const data = await fetchAdminCompanyWeekReport(
              weekStart,
              isAdministrator(user) ? activeCompanyId : null,
            );
            if (!cancelled) {
              setCompanyReport(data);
              setSheet(null);
            }
          } else {
            const data = await fetchAdminTimesheetWeek(subjectUserId.trim(), weekStart);
            if (!cancelled) {
              setSheet(data);
              setCompanyReport(null);
            }
          }
        } else {
          const data = await fetchMyTimesheetWeek(weekStart);
          if (cancelled) {
            return;
          }
          setSheet(data);
          setCompanyReport(null);
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
          setCompanyReport(null);
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
  }, [weekStart, adminMode, management, subjectUserId, activeCompanyId, user]);

  const activityEmpty = Boolean(
    !loading &&
      (viewingAllEmployees
        ? companyReport && companyReport.totals.completed_shifts_count === 0
        : sheet && sheet.shift_count === 0),
  );

  const openBannerSingle = Boolean(sheet?.open_shift_in_week && !viewingAllEmployees);
  const openBannerAll = Boolean(
    viewingAllEmployees && companyReport && companyReport.totals.employees_with_open_shift > 0,
  );

  const hasExportableData =
    !loading &&
    !error &&
    (adminMode && management
      ? viewingAllEmployees
        ? Boolean(companyReport && companyReport.totals.completed_shifts_count > 0)
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
          await downloadAdminCompanyWeekReportCsv(
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
        description="Summary for the selected week using payable and payroll time from company policy."
        title="Week report"
      />
      <SheetBody className="min-w-0 space-y-3 md:p-5">
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
                  Pick a company, then one employee or all employees. The server aggregates only the selected company.
                </p>
              ) : (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Switch to admin view to open another employee&apos;s week or all employees.
                </p>
              )}
            </div>
          </div>
        ) : null}

        {adminMode && management && isAdministrator(user) ? (
          <label className="block max-w-md text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">Company</span>
            <select
              className="mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]"
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
              className="mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]"
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
              timezoneLabel={timezoneLabel}
              weekStartIso={weekStart}
            />
          </div>
          <Button
            className="h-10 w-full shrink-0 sm:w-auto"
            disabled={exportBusy || !hasExportableData}
            onClick={() => void handleExportCsv()}
            type="button"
            variant="secondary"
          >
            {exportBusy ? "Exporting…" : "Export CSV"}
          </Button>
        </div>

        {exportError ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2.5 text-sm text-[var(--color-danger-700)]">
            {exportError}
          </div>
        ) : null}

        {openBannerSingle ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] border-l-4 border-l-[var(--color-warning-700)] bg-[var(--color-header)] px-3 py-2.5 text-sm text-[var(--color-text)]">
            Open shift in this week — finalize clock-out for final numbers.
          </div>
        ) : null}

        {openBannerAll ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] border-l-4 border-l-[var(--color-warning-700)] bg-[var(--color-header)] px-3 py-2.5 text-sm text-[var(--color-text)]">
            One or more employees have an open shift this week — see timesheets for detail; completed totals exclude
            open shifts.
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

        {!loading && sheet && !viewingAllEmployees ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              hint="Clocked time = raw clock-in to clock-out."
              label="Clocked time"
              value={formatDurationSeconds(sheet.week_actual_seconds)}
            />
            <StatCard
              hint="Payable time = after standard start and break rules."
              label="Payable time"
              value={formatDurationSeconds(sheet.week_counted_seconds)}
            />
            <StatCard
              hint="Payroll time = rounded time used by payroll."
              label="Payroll time"
              value={formatDurationSeconds(sheet.week_rounded_seconds)}
            />
            <StatCard
              hint="Break minutes applied by company time policy."
              label="Break deducted"
              value={formatDurationSeconds(sheet.week_break_seconds)}
            />
          </div>
        ) : null}

        {!loading && companyReport && viewingAllEmployees ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              hint="Clocked time = raw clock-in to clock-out (completed shifts, all employees)."
              label="Clocked time (company)"
              value={formatDurationSeconds(companyReport.totals.clocked_seconds)}
            />
            <StatCard
              hint="Payable time = after standard start and break rules."
              label="Payable time (company)"
              value={formatDurationSeconds(companyReport.totals.payable_seconds)}
            />
            <StatCard
              hint="Payroll time = rounded time used by payroll."
              label="Payroll time (company)"
              value={formatDurationSeconds(companyReport.totals.payroll_seconds)}
            />
            <StatCard
              hint="Break minutes applied by company time policy."
              label="Break deducted (company)"
              value={formatDurationSeconds(companyReport.totals.break_seconds)}
            />
          </div>
        ) : null}

        {!loading && sheet && !viewingAllEmployees ? (
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
                    Completed shift segments will be counted here. If you are still clocked in, close the shift to
                    refresh totals.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-[var(--color-text)]">
                    Completed shift segments in range:{" "}
                    <span className="font-semibold tabular-nums">{sheet.shift_count}</span>
                  </p>
                  <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                    Locations: {sheet.locations_worked.length > 0 ? sheet.locations_worked.join(", ") : "—"}
                  </p>
                </>
              )}
            </div>
          </div>
        ) : null}

        {!loading && sheet && !viewingAllEmployees && (sheet.week_leave?.length ?? 0) > 0 ? (
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
            <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                Leave & absence (overlaps this week)
              </p>
            </div>
            <div className="overflow-x-auto p-2">
              <Table className="min-w-[640px] text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(sheet.week_leave ?? []).map((lv) => (
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
            <p className="border-t border-[var(--color-border-dark)] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              Leave rows are for attendance context only. They do not change clocked hours or payroll totals in this
              version.
            </p>
          </div>
        ) : null}

        {!loading && companyReport && viewingAllEmployees && companyWeekLeaveFlat.length > 0 ? (
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
            <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                Leave & absence (company, overlaps this week)
              </p>
            </div>
            <div className="overflow-x-auto p-2">
              <Table className="min-w-[720px] text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companyWeekLeaveFlat.map(({ employee, leave: lv }) => (
                    <TableRow key={`${lv.request_id}-${employee}`}>
                      <TableCell className="max-w-[200px]">{employee}</TableCell>
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
            <p className="border-t border-[var(--color-border-dark)] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              Includes approved and pending leave that overlaps the selected week. Not merged into clocked totals.
            </p>
          </div>
        ) : null}

        {!loading && companyReport && viewingAllEmployees ? (
          <div className="space-y-2">
            <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
              <span className="font-semibold text-[var(--color-text)]">Clocked time</span> = raw clock-in to
              clock-out. <span className="font-semibold text-[var(--color-text)]">Payable time</span> = after standard
              start and break rules. <span className="font-semibold text-[var(--color-text)]">Payroll time</span> =
              rounded time used by payroll.
            </p>
            <Table className="min-w-[880px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Job title</TableHead>
                  <TableHead>Completed shifts</TableHead>
                  <TableHead>Clocked time</TableHead>
                  <TableHead>Payable time</TableHead>
                  <TableHead>Payroll time</TableHead>
                  <TableHead>Break deducted</TableHead>
                  <TableHead>Locations worked</TableHead>
                  <TableHead>Open shift</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companyReport.employees.map((row) => (
                  <TableRow key={row.user_id}>
                    <TableCell className="max-w-[200px] text-xs">
                      {employeeCell(row.employee_name, row.employee_email)}
                    </TableCell>
                    <TableCell className="text-xs text-[var(--color-text-muted)]">
                      {row.employee_job_title?.trim() || "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-xs">{row.completed_shifts_count}</TableCell>
                    <TableCell className="tabular-nums text-xs">{formatDurationSeconds(row.clocked_seconds)}</TableCell>
                    <TableCell className="tabular-nums text-xs">{formatDurationSeconds(row.payable_seconds)}</TableCell>
                    <TableCell className="tabular-nums text-xs">{formatDurationSeconds(row.payroll_seconds)}</TableCell>
                    <TableCell className="tabular-nums text-xs">{formatDurationSeconds(row.break_seconds)}</TableCell>
                    <TableCell className="max-w-[220px] text-xs text-[var(--color-text-muted)]">
                      {row.locations_worked.length > 0 ? row.locations_worked.join(", ") : "—"}
                    </TableCell>
                    <TableCell className="text-xs">{row.open_shift_in_week ? "Yes" : "—"}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="timiq-table-total-row">
                  <TableCell className="font-semibold" colSpan={2}>
                    Company total
                  </TableCell>
                  <TableCell className="tabular-nums text-xs font-semibold">
                    {companyReport.totals.completed_shifts_count}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs font-semibold">
                    {formatDurationSeconds(companyReport.totals.clocked_seconds)}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs font-semibold">
                    {formatDurationSeconds(companyReport.totals.payable_seconds)}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs font-semibold">
                    {formatDurationSeconds(companyReport.totals.payroll_seconds)}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs font-semibold">
                    {formatDurationSeconds(companyReport.totals.break_seconds)}
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-xs font-semibold">
                    {companyReport.totals.employees_with_open_shift > 0
                      ? `${companyReport.totals.employees_with_open_shift} employee(s)`
                      : "—"}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            {activityEmpty ? (
              <p className="text-xs text-[var(--color-text-muted)]">
                No completed shifts in this week for any employee. Rows above are active employees with zero completed
                time; open shifts are flagged when present.
              </p>
            ) : null}
          </div>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
