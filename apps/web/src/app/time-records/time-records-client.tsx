"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

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
import { UserAvatar } from "../../components/user-avatar";
import {
  canAccessManagement,
  isAdministrator,
  listManagedUsers,
  useCurrentUser,
  type AuthUser,
} from "../../features/auth";
import { listCompanies, type Company } from "../../features/companies/api";
import { CompanySelector } from "../../features/companies/company-selector";
import { useAdministratorCompanyScope } from "../../features/companies/selected-company";
import { listLocations, type Location } from "../../features/locations/api";
import { BreakDeductionCell } from "../../features/time-records/break-deduction-cell";
import { formatDurationSeconds } from "../../features/time-records/format-duration";
import { useLiveShiftDurationParts } from "../../features/time-clock/shift-duration";
import { browserDefaultTimeZone } from "../../features/timesheets/week-utils";
import { shiftStatusLabel, useT } from "../../lib/i18n";
import { formatPayrollWeekUkLabel } from "../../lib/week-label";
import { FaceCheckCell } from "../../features/face-check/face-check-cell";
import { FaceCheckReviewModal } from "../../features/face-check/face-check-review-modal";
import {
  adminCreateCompletedShift,
  adminForceClockOut,
  adminPatchCompletedShift,
  listAdminTimeRecords,
  listMyTimeRecords,
  type AdminForceClockOutBody,
  type TimeRecordShiftRow,
} from "../../features/time-records/api";

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function ShiftDurationCell({
  row,
  runningLabel,
}: {
  row: TimeRecordShiftRow;
  runningLabel: string;
}) {
  const isOpen = !row.clock_out_at;
  const parts = useLiveShiftDurationParts(row.clock_in_at, isOpen);
  if (row.actual_seconds !== null) {
    return <span className="tabular-nums">{formatDurationSeconds(row.actual_seconds)}</span>;
  }
  if (isOpen) {
    return (
      <span className="tabular-nums" suppressHydrationWarning>
        {parts.hms || parts.compact || "—"}{" "}
        <span className="text-[var(--color-text-muted)]">{runningLabel}</span>
      </span>
    );
  }
  if (row.running_actual_seconds !== null) {
    return (
      <span className="tabular-nums">
        {formatDurationSeconds(row.running_actual_seconds)}{" "}
        <span className="text-[var(--color-text-muted)]">{runningLabel}</span>
      </span>
    );
  }
  return <span>—</span>;
}

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalToIso(localValue: string): string {
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return d.toISOString();
}

function payrollRecalcMessage(
  t: ReturnType<typeof useT>,
  weekStart: string | null,
): string {
  if (!weekStart) {
    return t(
      "time_records.payroll_recalc_generic",
      "Time adjusted. Recalculate payroll for the affected week when ready.",
    );
  }
  const label = formatPayrollWeekUkLabel(weekStart, browserDefaultTimeZone(), false);
  return t("time_records.payroll_recalc", "Time adjusted. Recalculate payroll for {{week}}.", {
    week: label,
  });
}

export function TimeRecordsClient() {
  const t = useT();
  const runningLabel = t("status.running", "(running)");
  const user = useCurrentUser();
  const management = canAccessManagement(user);

  const [rows, setRows] = useState<TimeRecordShiftRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const [adminMode, setAdminMode] = useState(false);
  const [managedUsers, setManagedUsers] = useState<AuthUser[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [filterUserId, setFilterUserId] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const companyScope = useAdministratorCompanyScope(user, companies);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<TimeRecordShiftRow | null>(null);
  const [forceRow, setForceRow] = useState<TimeRecordShiftRow | null>(null);
  const [faceReviewShiftId, setFaceReviewShiftId] = useState<string | null>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState("");
  const [actionBanner, setActionBanner] = useState("");

  const [formUserId, setFormUserId] = useState("");
  const [formLocationId, setFormLocationId] = useState("");
  const [formClockInLocal, setFormClockInLocal] = useState("");
  const [formClockOutLocal, setFormClockOutLocal] = useState("");
  const [formBreakMinutes, setFormBreakMinutes] = useState("0");
  const [formReason, setFormReason] = useState("");

  const employeeOptions = useMemo(
    () => managedUsers.filter((u) => u.system_role === "employee"),
    [managedUsers],
  );

  const selectedEmployee = useMemo(
    () => employeeOptions.find((u) => u.id === formUserId) ?? null,
    [employeeOptions, formUserId],
  );

  const locationOptions = useMemo(() => {
    if (!selectedEmployee?.company_id) {
      return [];
    }
    const cid = selectedEmployee.company_id;
    return locations.filter(
      (l) => l.company_id === cid && (l.is_active || (editRow && l.id === editRow.location_id)),
    );
  }, [locations, selectedEmployee, editRow]);

  async function loadRecords() {
    setIsLoading(true);
    setLoadError("");
    try {
      const params: Record<string, string | undefined> = {};
      if (startDate.trim()) {
        params.start_date = startDate.trim();
      }
      if (endDate.trim()) {
        params.end_date = endDate.trim();
      }
      if (adminMode && management) {
        if (isAdministrator(user) && !companyScope.companyId) {
          setRows([]);
          setLoadError(t("time_records.select_company", "Select a company to load time records."));
          return;
        }
        if (filterUserId.trim()) {
          params.user_id = filterUserId.trim();
        }
        if (isAdministrator(user) && companyScope.companyId) {
          params.company_id = companyScope.companyId;
        }
        const data = await listAdminTimeRecords(params);
        setRows(data);
      } else {
        const data = await listMyTimeRecords(params);
        setRows(data);
      }
    } catch {
      setRows([]);
      setLoadError(t("time_records.load_error", "Could not load time records."));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!management || !adminMode) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const users = await listManagedUsers(
          isAdministrator(user) ? companyScope.companyId : undefined,
        );
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
  }, [management, adminMode, user, companyScope.companyId]);

  useEffect(() => {
    if (!isAdministrator(user)) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await listCompanies();
        if (!cancelled) {
          setCompanies(rows.filter((c) => c.is_active));
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
    if (!management || !adminMode) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const locCompanyId = isAdministrator(user)
          ? companyScope.companyId
          : user.company_id ?? null;
        if (isAdministrator(user) && !locCompanyId) {
          if (!cancelled) {
            setLocations([]);
          }
          return;
        }
        const locs = await listLocations(locCompanyId);
        if (!cancelled) {
          setLocations(locs);
        }
      } catch {
        if (!cancelled) {
          setLocations([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [management, adminMode, user, companyScope.companyId]);

  useEffect(() => {
    loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when mode/filters change intentionally via Apply
  }, []);

  async function handleApplyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionBanner("");
    await loadRecords();
  }

  function resetForm() {
    setFormUserId("");
    setFormLocationId("");
    setFormClockInLocal("");
    setFormClockOutLocal("");
    setFormBreakMinutes("0");
    setFormReason("");
    setModalError("");
  }

  function openAddModal() {
    resetForm();
    setAddOpen(true);
  }

  function openEditModal(row: TimeRecordShiftRow) {
    resetForm();
    setFormUserId(row.user_id);
    setFormLocationId(row.location_id);
    setFormClockInLocal(toDatetimeLocalValue(row.clock_in_at));
    setFormClockOutLocal(row.clock_out_at ? toDatetimeLocalValue(row.clock_out_at) : "");
    setFormBreakMinutes(String(Math.round(row.break_seconds / 60)));
    setEditRow(row);
  }

  function openForceModal(row: TimeRecordShiftRow) {
    resetForm();
    setFormClockOutLocal(toDatetimeLocalValue(new Date().toISOString()));
    setFormBreakMinutes("");
    setForceRow(row);
  }

  function closeModals() {
    setAddOpen(false);
    setEditRow(null);
    setForceRow(null);
    setModalBusy(false);
    setModalError("");
  }

  async function submitAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setModalError("");
    setActionBanner("");
    const cin = fromDatetimeLocalToIso(formClockInLocal);
    const cout = fromDatetimeLocalToIso(formClockOutLocal);
    if (!formUserId || !formLocationId || !cin || !cout) {
      setModalError(
        t("time_records.err_required_fields", "Employee, location, clock-in, and clock-out are required."),
      );
      return;
    }
    const brk = Number(formBreakMinutes);
    if (Number.isNaN(brk) || brk < 0) {
      setModalError(t("time_records.err_break_invalid", "Break minutes must be a non-negative number."));
      return;
    }
    if (!formReason.trim()) {
      setModalError(t("time_records.err_reason_required", "Reason is required."));
      return;
    }
    setModalBusy(true);
    try {
      const res = await adminCreateCompletedShift({
        user_id: formUserId,
        location_id: formLocationId,
        clock_in_at: cin,
        clock_out_at: cout,
        break_minutes: brk,
        reason: formReason.trim(),
      });
      setActionBanner(
        res.payroll_recalculation_required
          ? payrollRecalcMessage(t, res.affected_week_start)
          : t("time_records.shift_created", "Shift created."),
      );
      closeModals();
      await loadRecords();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : t("time_records.request_failed", "Request failed."));
    } finally {
      setModalBusy(false);
    }
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editRow) {
      return;
    }
    setModalError("");
    setActionBanner("");
    const cin = fromDatetimeLocalToIso(formClockInLocal);
    const cout = fromDatetimeLocalToIso(formClockOutLocal);
    if (!cin || !cout) {
      setModalError(t("time_records.err_clock_required", "Clock-in and clock-out are required."));
      return;
    }
    const brk = Number(formBreakMinutes);
    if (Number.isNaN(brk) || brk < 0) {
      setModalError(t("time_records.err_break_invalid", "Break minutes must be a non-negative number."));
      return;
    }
    if (!formReason.trim()) {
      setModalError(t("time_records.err_reason_required", "Reason is required."));
      return;
    }
    setModalBusy(true);
    try {
      const res = await adminPatchCompletedShift(editRow.shift_id, {
        clock_in_at: cin,
        clock_out_at: cout,
        location_id: formLocationId !== editRow.location_id ? formLocationId : undefined,
        break_minutes: brk,
        reason: formReason.trim(),
      });
      setActionBanner(
        res.payroll_recalculation_required
          ? payrollRecalcMessage(t, res.affected_week_start)
          : t("time_records.shift_updated", "Shift updated."),
      );
      closeModals();
      await loadRecords();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : t("time_records.request_failed", "Request failed."));
    } finally {
      setModalBusy(false);
    }
  }

  async function submitForce(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!forceRow) {
      return;
    }
    setModalError("");
    setActionBanner("");
    const cout = fromDatetimeLocalToIso(formClockOutLocal);
    if (!cout) {
      setModalError(t("time_records.err_clock_out_required", "Clock-out is required."));
      return;
    }
    const brkRaw = formBreakMinutes.trim();
    if (brkRaw !== "") {
      const brk = Number(brkRaw);
      if (Number.isNaN(brk) || brk < 0) {
        setModalError(t("time_records.err_break_invalid", "Break minutes must be a non-negative number."));
        return;
      }
    }
    if (!formReason.trim()) {
      setModalError(t("time_records.err_reason_required", "Reason is required."));
      return;
    }
    setModalBusy(true);
    try {
      const body: AdminForceClockOutBody = {
        clock_out_at: cout,
        reason: formReason.trim(),
      };
      if (brkRaw !== "") {
        body.break_minutes = Number(brkRaw);
      }
      const res = await adminForceClockOut(forceRow.shift_id, body);
      setActionBanner(
        res.payroll_recalculation_required
          ? payrollRecalcMessage(t, res.affected_week_start)
          : t("time_records.shift_closed", "Shift closed."),
      );
      closeModals();
      await loadRecords();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : t("time_records.request_failed", "Request failed."));
    } finally {
      setModalBusy(false);
    }
  }

  const adminCols = adminMode && management ? 11 : adminMode ? 10 : 9;

  return (
    <Sheet>
      <PageHeader
        description={t(
          "time_records.description",
          "Stored clock times are unchanged; payable and payroll durations follow company time policy.",
        )}
        title={t("time_records.title", "Time records")}
      />
      <SheetBody className="min-w-0 space-y-3">
        {management ? (
          <div className="flex flex-wrap items-center gap-3 border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2 text-sm">
            <label className="flex items-center gap-2 font-semibold text-[var(--color-text)]">
              <input
                checked={!adminMode}
                className="h-4 w-4"
                onChange={() => setAdminMode(false)}
                type="radio"
              />
              {t("time_records.my_records", "My records")}
            </label>
            <label className="flex items-center gap-2 font-semibold text-[var(--color-text)]">
              <input
                checked={adminMode}
                className="h-4 w-4"
                onChange={() => setAdminMode(true)}
                type="radio"
              />
              {t("time_records.admin_view", "Admin view")}
            </label>
            {adminMode ? (
              <Button className="ml-auto" onClick={openAddModal} type="button" variant="secondary">
                {t("time_records.add_shift", "Add completed shift")}
              </Button>
            ) : null}
          </div>
        ) : null}

        <form
          className="space-y-2 border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2 text-sm"
          onSubmit={handleApplyFilters}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <label className="block min-w-0 flex-1 text-xs font-bold text-[var(--color-text)] sm:max-w-[12rem]">
              {t("time_records.start_date", "Start date")}
              <input
                className="mt-1 h-9 w-full min-w-0 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm text-[#111827]"
                onChange={(event) => setStartDate(event.target.value)}
                type="date"
                value={startDate}
              />
            </label>
            <label className="block min-w-0 flex-1 text-xs font-bold text-[var(--color-text)] sm:max-w-[12rem]">
              {t("time_records.end_date_exclusive", "End date (exclusive)")}
              <input
                className="mt-1 h-9 w-full min-w-0 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm text-[#111827]"
                onChange={(event) => setEndDate(event.target.value)}
                type="date"
                value={endDate}
              />
            </label>
          </div>

          {adminMode && management ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <label className="block min-w-0 w-full flex-1 text-xs font-bold text-[var(--color-text)] sm:min-w-[12rem]">
                {t("common.employee", "Employee")}
                <select
                  className="timiq-select mt-1 h-9 w-full min-w-0 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  onChange={(event) => setFilterUserId(event.target.value)}
                  value={filterUserId}
                >
                  <option value="">{t("time_records.all_employees", "All visible employees")}</option>
                  {employeeOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.email}
                    </option>
                  ))}
                </select>
              </label>
              {isAdministrator(user) && companyScope.companies.length > 0 ? (
                <div className="flex min-w-0 flex-1 flex-col justify-end">
                  <CompanySelector
                    companies={companyScope.companies}
                    label={t("common.company", "Company")}
                    onChange={companyScope.setCompanyId}
                    value={companyScope.companyId}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <Button type="submit">
            {isLoading ? t("common.loading", "Loading…") : t("time_records.apply_filters", "Apply filters")}
          </Button>
          <p className="text-xs text-[var(--color-text-muted)]">
            {t(
              "time_records.filters_hint",
              "Leaving dates blank loads the last 28 days (company timezone on the server).",
            )}
          </p>
        </form>

        {loadError ? (
          <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {loadError}
          </div>
        ) : null}

        {actionBanner ? (
          <div
            className="rounded-[var(--radius-md)] border border-emerald-800/25 bg-emerald-50 px-3 py-2 text-sm text-emerald-950"
            role="status"
          >
            {actionBanner}
          </div>
        ) : null}

        <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
          {t("time_records.legend_intro", "{{clocked}} = raw clock-in to clock-out. {{payable}} = after standard start and break rules. {{payroll}} = rounded time used by payroll.", {
            clocked: t("time_records.legend_clocked", "Clocked time"),
            payable: t("time_records.legend_payable", "Payable time"),
            payroll: t("time_records.legend_payroll", "Payroll time"),
          })}
        </p>

        {adminMode && management ? (
          <p className="text-xs text-[var(--color-text-muted)]">
            {t(
              "time_records.admin_audit_note",
              "Manual corrections are audited and marked as admin entries. They do not use employee GPS/selfie checks.",
            )}
          </p>
        ) : null}

        <div className="timiq-scroll-x w-full min-w-0">
        <Table>
          <TableHeader>
            <TableRow>
              {adminMode ? <TableHead>{t("timesheets.col_employee", "Employee")}</TableHead> : null}
              <TableHead>{t("time_records.col_location", "Location")}</TableHead>
              <TableHead>{t("time_records.col_status", "Status")}</TableHead>
              <TableHead>{t("time_records.col_clock_in", "Clock in")}</TableHead>
              <TableHead>{t("time_records.col_clock_out", "Clock out")}</TableHead>
              <TableHead>{t("timesheets.col_clocked", "Clocked time")}</TableHead>
              <TableHead>{t("time_records.col_payable", "Payable time")}</TableHead>
              <TableHead>{t("time_records.col_payroll", "Payroll time")}</TableHead>
              <TableHead>{t("time_records.col_break_deducted", "Break deducted")}</TableHead>
              <TableHead>{t("face_check.table_header", "Face check")}</TableHead>
              {adminMode && management ? (
                <TableHead className="w-[9rem]">{t("time_records.actions", "Actions")}</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={adminCols}>{t("common.loading", "Loading…")}</TableCell>
              </TableRow>
            ) : null}
            {!isLoading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={adminCols}>{t("time_records.empty", "No shifts in range.")}</TableCell>
              </TableRow>
            ) : null}
            {!isLoading
              ? rows.map((row) => (
                  <TableRow key={row.shift_id}>
                    {adminMode ? (
                      <TableCell className="max-w-[14rem] text-xs">
                        <div className="flex min-w-0 items-center gap-2">
                          <UserAvatar
                            email={row.employee_email}
                            name={row.employee_name}
                            sizeClassName="h-8 w-8"
                            userId={row.user_id}
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-[var(--color-text)]">
                              {row.employee_name ?? row.employee_email ?? t("common.employee", "Employee")}
                            </span>
                            {row.employee_job_title ? (
                              <span className="mt-0.5 block truncate text-[var(--color-text-muted)]">
                                {row.employee_job_title}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </TableCell>
                    ) : null}
                    <TableCell>{row.location_name}</TableCell>
                    <TableCell>{shiftStatusLabel(t, row.status)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatDateTime(row.clock_in_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {row.clock_out_at ? formatDateTime(row.clock_out_at) : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      <ShiftDurationCell row={row} runningLabel={runningLabel} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.counted_seconds !== null
                        ? formatDurationSeconds(row.counted_seconds)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.rounded_seconds !== null
                        ? formatDurationSeconds(row.rounded_seconds)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      <BreakDeductionCell
                        seconds={row.break_deducted_seconds ?? row.break_seconds}
                      />
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex flex-col items-start gap-1">
                        <FaceCheckCell
                          status={row.face_check_status}
                          confidence={row.face_match_confidence}
                        />
                        {adminMode && management ? (
                          <Button
                            className="min-h-7 px-2 py-0.5 text-[11px]"
                            onClick={() => setFaceReviewShiftId(row.shift_id)}
                            type="button"
                            variant="secondary"
                          >
                            {row.face_check_status
                              ? t("face_check.view_photos", "View photos")
                              : t("face_check.view", "View")}
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                    {adminMode && management ? (
                      <TableCell className="align-top text-xs">
                        <div className="flex flex-col gap-1">
                          {row.status === "completed" ? (
                            <Button
                              className="min-h-8 px-2 py-1 text-xs"
                              onClick={() => openEditModal(row)}
                              type="button"
                              variant="secondary"
                            >
                              {t("time_records.edit", "Edit")}
                            </Button>
                          ) : null}
                          {row.status === "open" ? (
                            <Button
                              className="min-h-8 px-2 py-1 text-xs"
                              onClick={() => openForceModal(row)}
                              type="button"
                              variant="secondary"
                            >
                              {t("time_records.force_clock_out", "Force clock-out")}
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              : null}
          </TableBody>
        </Table>
        </div>

        {addOpen ? (
          <div
            aria-modal="true"
            className="fixed inset-0 z-[2100] flex items-start justify-center overflow-y-auto bg-black/45 p-3"
            role="dialog"
          >
            <div className="timiq-sheet my-4 w-full max-w-lg border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-4 shadow-md">
              <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border-dark)] pb-2">
                <p className="text-sm font-bold text-[var(--color-text)]">
                  {t("time_records.modal_add_title", "Add completed shift")}
                </p>
                <Button onClick={closeModals} type="button" variant="secondary">
                  {t("common.close", "Close")}
                </Button>
              </div>
              <form className="mt-3 space-y-2 text-sm" onSubmit={submitAdd}>
                {modalError ? (
                  <p className="rounded border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-2 py-1 text-xs text-[var(--color-danger-700)]">
                    {modalError}
                  </p>
                ) : null}
                <label className="block text-xs font-bold">
                  {t("common.employee", "Employee")}
                  <select
                    className="timiq-select mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => {
                      setFormUserId(event.target.value);
                      setFormLocationId("");
                    }}
                    required
                    value={formUserId}
                  >
                    <option value="">{t("common.select", "Select…")}</option>
                    {employeeOptions.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.email}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-bold">
                  {t("time_records.col_location", "Location")}
                  <select
                    className="timiq-select mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    disabled={!formUserId}
                    onChange={(event) => setFormLocationId(event.target.value)}
                    required
                    value={formLocationId}
                  >
                    <option value="">{t("common.select", "Select…")}</option>
                    {locationOptions.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-bold">
                  {t("time_records.clock_in_local", "Clock in (local)")}
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setFormClockInLocal(event.target.value)}
                    required
                    type="datetime-local"
                    value={formClockInLocal}
                  />
                </label>
                <label className="block text-xs font-bold">
                  {t("time_records.clock_out_local", "Clock out (local)")}
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setFormClockOutLocal(event.target.value)}
                    required
                    type="datetime-local"
                    value={formClockOutLocal}
                  />
                </label>
                <label className="block text-xs font-bold">
                  {t("time_records.break_minutes", "Break (minutes)")}
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    inputMode="numeric"
                    min={0}
                    onChange={(event) => setFormBreakMinutes(event.target.value)}
                    type="number"
                    value={formBreakMinutes}
                  />
                </label>
                <label className="block text-xs font-bold">
                  {t("time_records.reason_required", "Reason (required)")}
                  <textarea
                    className="mt-1 min-h-[4rem] w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-1 text-sm"
                    onChange={(event) => setFormReason(event.target.value)}
                    required
                    value={formReason}
                  />
                </label>
                <Button disabled={modalBusy} type="submit">
                  {modalBusy ? t("common.saving", "Saving…") : t("time_records.create_shift", "Create shift")}
                </Button>
              </form>
            </div>
          </div>
        ) : null}

        {editRow ? (
          <div
            aria-modal="true"
            className="fixed inset-0 z-[2100] flex items-start justify-center overflow-y-auto bg-black/45 p-3"
            role="dialog"
          >
            <div className="timiq-sheet my-4 w-full max-w-lg border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-4 shadow-md">
              <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border-dark)] pb-2">
                <p className="text-sm font-bold text-[var(--color-text)]">
                  {t("time_records.edit_title", "Edit completed shift")}
                </p>
                <Button onClick={closeModals} type="button" variant="secondary">
                  {t("common.close", "Close")}
                </Button>
              </div>
              <form className="mt-3 space-y-2 text-sm" onSubmit={submitEdit}>
                {modalError ? (
                  <p className="rounded border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-2 py-1 text-xs text-[var(--color-danger-700)]">
                    {modalError}
                  </p>
                ) : null}
                <p className="text-xs text-[var(--color-text-muted)]">
                  {t("time_records.employee_row", "Employee: {{name}}", {
                    name: editRow.employee_name ?? editRow.employee_email ?? editRow.user_id,
                  })}
                </p>
                <label className="block text-xs font-bold">
                  {t("time_records.col_location", "Location")}
                  <select
                    className="timiq-select mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setFormLocationId(event.target.value)}
                    value={formLocationId}
                  >
                    {locationOptions.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-bold">
                  {t("time_records.clock_in_local", "Clock in (local)")}
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setFormClockInLocal(event.target.value)}
                    required
                    type="datetime-local"
                    value={formClockInLocal}
                  />
                </label>
                <label className="block text-xs font-bold">
                  {t("time_records.clock_out_local", "Clock out (local)")}
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setFormClockOutLocal(event.target.value)}
                    required
                    type="datetime-local"
                    value={formClockOutLocal}
                  />
                </label>
                <label className="block text-xs font-bold">
                  {t("time_records.break_minutes", "Break (minutes)")}
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    inputMode="numeric"
                    min={0}
                    onChange={(event) => setFormBreakMinutes(event.target.value)}
                    type="number"
                    value={formBreakMinutes}
                  />
                </label>
                <label className="block text-xs font-bold">
                  {t("time_records.reason_required", "Reason (required)")}
                  <textarea
                    className="mt-1 min-h-[4rem] w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-1 text-sm"
                    onChange={(event) => setFormReason(event.target.value)}
                    required
                    value={formReason}
                  />
                </label>
                <Button disabled={modalBusy} type="submit">
                  {modalBusy ? t("common.saving", "Saving…") : t("time_records.save_changes", "Save changes")}
                </Button>
              </form>
            </div>
          </div>
        ) : null}

        {forceRow ? (
          <div
            aria-modal="true"
            className="fixed inset-0 z-[2100] flex items-start justify-center overflow-y-auto bg-black/45 p-3"
            role="dialog"
          >
            <div className="timiq-sheet my-4 w-full max-w-lg border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-4 shadow-md">
              <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border-dark)] pb-2">
                <p className="text-sm font-bold text-[var(--color-text)]">
                  {t("time_records.force_title", "Force clock-out")}
                </p>
                <Button onClick={closeModals} type="button" variant="secondary">
                  {t("common.close", "Close")}
                </Button>
              </div>
              <form className="mt-3 space-y-2 text-sm" onSubmit={submitForce}>
                {modalError ? (
                  <p className="rounded border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-2 py-1 text-xs text-[var(--color-danger-700)]">
                    {modalError}
                  </p>
                ) : null}
                <p className="text-xs text-[var(--color-text-muted)]">
                  {t("time_records.open_shift_at", "Open shift at {{time}} · {{location}}", {
                    time: formatDateTime(forceRow.clock_in_at),
                    location: forceRow.location_name,
                  })}
                </p>
                <label className="block text-xs font-bold">
                  {t("time_records.clock_out_local", "Clock out (local)")}
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setFormClockOutLocal(event.target.value)}
                    required
                    type="datetime-local"
                    value={formClockOutLocal}
                  />
                </label>
                <label className="block text-xs font-bold">
                  {t("time_records.break_override", "Break total override (minutes, optional)")}
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    inputMode="numeric"
                    min={0}
                    onChange={(event) => setFormBreakMinutes(event.target.value)}
                    placeholder={t(
                      "time_records.break_override_placeholder",
                      "Leave blank to use timed breaks",
                    )}
                    type="number"
                    value={formBreakMinutes}
                  />
                </label>
                <p className="text-[10px] text-[var(--color-text-muted)]">
                  {t(
                    "time_records.break_override_hint",
                    "Omit break override to use summed timed breaks after any open break is closed at clock-out.",
                  )}
                </p>
                <label className="block text-xs font-bold">
                  {t("time_records.reason_required", "Reason (required)")}
                  <textarea
                    className="mt-1 min-h-[4rem] w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-1 text-sm"
                    onChange={(event) => setFormReason(event.target.value)}
                    required
                    value={formReason}
                  />
                </label>
                <Button disabled={modalBusy} type="submit">
                  {modalBusy ? t("common.saving", "Saving…") : t("time_records.force_clock_out", "Force clock-out")}
                </Button>
              </form>
            </div>
          </div>
        ) : null}
      </SheetBody>
      <FaceCheckReviewModal
        onClose={() => setFaceReviewShiftId(null)}
        shiftId={faceReviewShiftId}
      />
    </Sheet>
  );
}
