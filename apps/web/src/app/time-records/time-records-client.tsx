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
import {
  canAccessManagement,
  isAdministrator,
  listManagedUsers,
  useCurrentUser,
  type AuthUser,
} from "../../features/auth";
import { listLocations, type Location } from "../../features/locations/api";
import { BreakDeductionCell } from "../../features/time-records/break-deduction-cell";
import { formatDurationSeconds } from "../../features/time-records/format-duration";
import { useLiveShiftDurationParts } from "../../features/time-clock/shift-duration";
import { browserDefaultTimeZone } from "../../features/timesheets/week-utils";
import { formatPayrollWeekUkLabel } from "../../lib/week-label";
import { FaceCheckBadge } from "../../features/face-check/face-check-badge";
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

function ShiftDurationCell({ row }: { row: TimeRecordShiftRow }) {
  const isOpen = !row.clock_out_at;
  const parts = useLiveShiftDurationParts(row.clock_in_at, isOpen);
  if (row.actual_seconds !== null) {
    return <span className="tabular-nums">{formatDurationSeconds(row.actual_seconds)}</span>;
  }
  if (isOpen) {
    return (
      <span className="tabular-nums" suppressHydrationWarning>
        {parts.hms || parts.compact || "—"}{" "}
        <span className="text-[var(--color-text-muted)]">(running)</span>
      </span>
    );
  }
  if (row.running_actual_seconds !== null) {
    return (
      <span className="tabular-nums">
        {formatDurationSeconds(row.running_actual_seconds)} <span className="text-[var(--color-text-muted)]">(running)</span>
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

function payrollRecalcMessage(weekStart: string | null): string {
  if (!weekStart) {
    return "Time adjusted. Recalculate payroll for the affected week when ready.";
  }
  const label = formatPayrollWeekUkLabel(weekStart, browserDefaultTimeZone(), false);
  return `Time adjusted. Recalculate payroll for ${label}.`;
}

export function TimeRecordsClient() {
  const user = useCurrentUser();
  const management = canAccessManagement(user);

  const [rows, setRows] = useState<TimeRecordShiftRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const [adminMode, setAdminMode] = useState(false);
  const [managedUsers, setManagedUsers] = useState<AuthUser[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [filterUserId, setFilterUserId] = useState("");
  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<TimeRecordShiftRow | null>(null);
  const [forceRow, setForceRow] = useState<TimeRecordShiftRow | null>(null);
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
        if (filterUserId.trim()) {
          params.user_id = filterUserId.trim();
        }
        if (isAdministrator(user) && filterCompanyId.trim()) {
          params.company_id = filterCompanyId.trim();
        }
        const data = await listAdminTimeRecords(params);
        setRows(data);
      } else {
        const data = await listMyTimeRecords(params);
        setRows(data);
      }
    } catch {
      setRows([]);
      setLoadError("Could not load time records.");
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
    if (!management || !adminMode) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const locs = await listLocations();
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
  }, [management, adminMode]);

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
      setModalError("Employee, location, clock-in, and clock-out are required.");
      return;
    }
    const brk = Number(formBreakMinutes);
    if (Number.isNaN(brk) || brk < 0) {
      setModalError("Break minutes must be a non-negative number.");
      return;
    }
    if (!formReason.trim()) {
      setModalError("Reason is required.");
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
          ? payrollRecalcMessage(res.affected_week_start)
          : "Shift created.",
      );
      closeModals();
      await loadRecords();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Request failed.");
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
      setModalError("Clock-in and clock-out are required.");
      return;
    }
    const brk = Number(formBreakMinutes);
    if (Number.isNaN(brk) || brk < 0) {
      setModalError("Break minutes must be a non-negative number.");
      return;
    }
    if (!formReason.trim()) {
      setModalError("Reason is required.");
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
          ? payrollRecalcMessage(res.affected_week_start)
          : "Shift updated.",
      );
      closeModals();
      await loadRecords();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Request failed.");
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
      setModalError("Clock-out is required.");
      return;
    }
    const brkRaw = formBreakMinutes.trim();
    if (brkRaw !== "") {
      const brk = Number(brkRaw);
      if (Number.isNaN(brk) || brk < 0) {
        setModalError("Break minutes must be a non-negative number.");
        return;
      }
    }
    if (!formReason.trim()) {
      setModalError("Reason is required.");
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
          ? payrollRecalcMessage(res.affected_week_start)
          : "Shift closed.",
      );
      closeModals();
      await loadRecords();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setModalBusy(false);
    }
  }

  const adminCols = adminMode && management ? 11 : adminMode ? 10 : 9;

  return (
    <Sheet>
      <PageHeader
        title="Time records"
        description="Stored clock times are unchanged; payable and payroll durations follow company time policy."
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
              My records
            </label>
            <label className="flex items-center gap-2 font-semibold text-[var(--color-text)]">
              <input
                checked={adminMode}
                className="h-4 w-4"
                onChange={() => setAdminMode(true)}
                type="radio"
              />
              Admin view
            </label>
            {adminMode ? (
              <Button className="ml-auto" onClick={openAddModal} type="button" variant="secondary">
                Add completed shift
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
              Start date
              <input
                className="mt-1 h-9 w-full min-w-0 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm text-[#111827]"
                onChange={(event) => setStartDate(event.target.value)}
                type="date"
                value={startDate}
              />
            </label>
            <label className="block min-w-0 flex-1 text-xs font-bold text-[var(--color-text)] sm:max-w-[12rem]">
              End date (exclusive)
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
                Employee
                <select
                  className="timiq-select mt-1 h-9 w-full min-w-0 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  onChange={(event) => setFilterUserId(event.target.value)}
                  value={filterUserId}
                >
                  <option value="">All visible employees</option>
                  {employeeOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.email}
                    </option>
                  ))}
                </select>
              </label>
              {isAdministrator(user) ? (
                <label className="block min-w-0 w-full flex-1 text-xs font-bold text-[var(--color-text)]">
                  Company ID (optional)
                  <input
                    className="mt-1 h-9 w-full min-w-0 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 font-mono text-xs"
                    onChange={(event) => setFilterCompanyId(event.target.value)}
                    placeholder="UUID"
                    type="text"
                    value={filterCompanyId}
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          <Button type="submit">{isLoading ? "Loading…" : "Apply filters"}</Button>
          <p className="text-xs text-[var(--color-text-muted)]">
            Leaving dates blank loads the last 28 days (company timezone on the server).
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
          <span className="font-semibold text-[var(--color-text)]">Clocked time</span> = raw clock-in to
          clock-out. <span className="font-semibold text-[var(--color-text)]">Payable time</span> = after standard
          start and break rules. <span className="font-semibold text-[var(--color-text)]">Payroll time</span> =
          rounded time used by payroll.
        </p>

        {adminMode && management ? (
          <p className="text-xs text-[var(--color-text-muted)]">
            Manual corrections are audited and marked as admin entries. They do not use employee GPS/selfie
            checks.
          </p>
        ) : null}

        <div className="timiq-scroll-x w-full min-w-0">
        <Table>
          <TableHeader>
            <TableRow>
              {adminMode ? <TableHead>Employee</TableHead> : null}
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Clock in</TableHead>
              <TableHead>Clock out</TableHead>
              <TableHead>Clocked time</TableHead>
              <TableHead>Payable time</TableHead>
              <TableHead>Payroll time</TableHead>
              <TableHead>Break deducted</TableHead>
              <TableHead>Face check</TableHead>
              {adminMode && management ? <TableHead className="w-[9rem]">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={adminCols}>Loading…</TableCell>
              </TableRow>
            ) : null}
            {!isLoading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={adminCols}>No shifts in range.</TableCell>
              </TableRow>
            ) : null}
            {!isLoading
              ? rows.map((row) => (
                  <TableRow key={row.shift_id}>
                    {adminMode ? (
                      <TableCell className="max-w-[14rem] text-xs">
                        <span className="font-medium text-[var(--color-text)]">
                          {row.employee_name ?? row.employee_email ?? "Employee"}
                        </span>
                        {row.employee_job_title ? (
                          <span className="mt-0.5 block truncate text-[var(--color-text-muted)]">
                            {row.employee_job_title}
                          </span>
                        ) : null}
                      </TableCell>
                    ) : null}
                    <TableCell>{row.location_name}</TableCell>
                    <TableCell>{row.status}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatDateTime(row.clock_in_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {row.clock_out_at ? formatDateTime(row.clock_out_at) : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      <ShiftDurationCell row={row} />
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
                      <FaceCheckBadge status={row.face_check_status} />
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
                              Edit
                            </Button>
                          ) : null}
                          {row.status === "open" ? (
                            <Button
                              className="min-h-8 px-2 py-1 text-xs"
                              onClick={() => openForceModal(row)}
                              type="button"
                              variant="secondary"
                            >
                              Force clock-out
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
                <p className="text-sm font-bold text-[var(--color-text)]">Add completed shift</p>
                <Button onClick={closeModals} type="button" variant="secondary">
                  Close
                </Button>
              </div>
              <form className="mt-3 space-y-2 text-sm" onSubmit={submitAdd}>
                {modalError ? (
                  <p className="rounded border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-2 py-1 text-xs text-[var(--color-danger-700)]">
                    {modalError}
                  </p>
                ) : null}
                <label className="block text-xs font-bold">
                  Employee
                  <select
                    className="timiq-select mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => {
                      setFormUserId(event.target.value);
                      setFormLocationId("");
                    }}
                    required
                    value={formUserId}
                  >
                    <option value="">Select…</option>
                    {employeeOptions.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.email}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-bold">
                  Location
                  <select
                    className="timiq-select mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    disabled={!formUserId}
                    onChange={(event) => setFormLocationId(event.target.value)}
                    required
                    value={formLocationId}
                  >
                    <option value="">Select…</option>
                    {locationOptions.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-bold">
                  Clock in (local)
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setFormClockInLocal(event.target.value)}
                    required
                    type="datetime-local"
                    value={formClockInLocal}
                  />
                </label>
                <label className="block text-xs font-bold">
                  Clock out (local)
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setFormClockOutLocal(event.target.value)}
                    required
                    type="datetime-local"
                    value={formClockOutLocal}
                  />
                </label>
                <label className="block text-xs font-bold">
                  Break (minutes)
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
                  Reason (required)
                  <textarea
                    className="mt-1 min-h-[4rem] w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-1 text-sm"
                    onChange={(event) => setFormReason(event.target.value)}
                    required
                    value={formReason}
                  />
                </label>
                <Button disabled={modalBusy} type="submit">
                  {modalBusy ? "Saving…" : "Create shift"}
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
                <p className="text-sm font-bold text-[var(--color-text)]">Edit completed shift</p>
                <Button onClick={closeModals} type="button" variant="secondary">
                  Close
                </Button>
              </div>
              <form className="mt-3 space-y-2 text-sm" onSubmit={submitEdit}>
                {modalError ? (
                  <p className="rounded border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-2 py-1 text-xs text-[var(--color-danger-700)]">
                    {modalError}
                  </p>
                ) : null}
                <p className="text-xs text-[var(--color-text-muted)]">
                  Employee: {editRow.employee_name ?? editRow.employee_email ?? editRow.user_id}
                </p>
                <label className="block text-xs font-bold">
                  Location
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
                  Clock in (local)
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setFormClockInLocal(event.target.value)}
                    required
                    type="datetime-local"
                    value={formClockInLocal}
                  />
                </label>
                <label className="block text-xs font-bold">
                  Clock out (local)
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setFormClockOutLocal(event.target.value)}
                    required
                    type="datetime-local"
                    value={formClockOutLocal}
                  />
                </label>
                <label className="block text-xs font-bold">
                  Break (minutes)
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
                  Reason (required)
                  <textarea
                    className="mt-1 min-h-[4rem] w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-1 text-sm"
                    onChange={(event) => setFormReason(event.target.value)}
                    required
                    value={formReason}
                  />
                </label>
                <Button disabled={modalBusy} type="submit">
                  {modalBusy ? "Saving…" : "Save changes"}
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
                <p className="text-sm font-bold text-[var(--color-text)]">Force clock-out</p>
                <Button onClick={closeModals} type="button" variant="secondary">
                  Close
                </Button>
              </div>
              <form className="mt-3 space-y-2 text-sm" onSubmit={submitForce}>
                {modalError ? (
                  <p className="rounded border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-2 py-1 text-xs text-[var(--color-danger-700)]">
                    {modalError}
                  </p>
                ) : null}
                <p className="text-xs text-[var(--color-text-muted)]">
                  Open shift at {formatDateTime(forceRow.clock_in_at)} · {forceRow.location_name}
                </p>
                <label className="block text-xs font-bold">
                  Clock out (local)
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setFormClockOutLocal(event.target.value)}
                    required
                    type="datetime-local"
                    value={formClockOutLocal}
                  />
                </label>
                <label className="block text-xs font-bold">
                  Break total override (minutes, optional)
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    inputMode="numeric"
                    min={0}
                    onChange={(event) => setFormBreakMinutes(event.target.value)}
                    placeholder="Leave blank to use timed breaks"
                    type="number"
                    value={formBreakMinutes}
                  />
                </label>
                <p className="text-[10px] text-[var(--color-text-muted)]">
                  Omit break override to use summed timed breaks after any open break is closed at clock-out.
                </p>
                <label className="block text-xs font-bold">
                  Reason (required)
                  <textarea
                    className="mt-1 min-h-[4rem] w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-1 text-sm"
                    onChange={(event) => setFormReason(event.target.value)}
                    required
                    value={formReason}
                  />
                </label>
                <Button disabled={modalBusy} type="submit">
                  {modalBusy ? "Saving…" : "Force clock-out"}
                </Button>
              </form>
            </div>
          </div>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
