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
import { formatDurationSeconds } from "../../features/time-records/format-duration";
import {
  listAdminTimeRecords,
  listMyTimeRecords,
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

function shiftDurationDisplay(row: TimeRecordShiftRow): string {
  if (row.actual_seconds !== null) {
    return formatDurationSeconds(row.actual_seconds);
  }
  if (row.running_actual_seconds !== null) {
    return `${formatDurationSeconds(row.running_actual_seconds)} (running)`;
  }
  return "—";
}

export function TimeRecordsClient() {
  const user = useCurrentUser();
  const management = canAccessManagement(user);

  const [rows, setRows] = useState<TimeRecordShiftRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const [adminMode, setAdminMode] = useState(false);
  const [managedUsers, setManagedUsers] = useState<AuthUser[]>([]);
  const [filterUserId, setFilterUserId] = useState("");
  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const employeeOptions = useMemo(
    () => managedUsers.filter((u) => u.system_role === "employee"),
    [managedUsers],
  );

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
    loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when mode/filters change intentionally via Apply
  }, []);

  async function handleApplyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadRecords();
  }

  return (
    <Sheet>
      <PageHeader
        title="Time records"
        description="Stored clock times are unchanged; payable and payroll durations follow company time policy."
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

        <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
          <span className="font-semibold text-[var(--color-text)]">Clocked time</span> = raw clock-in to
          clock-out. <span className="font-semibold text-[var(--color-text)]">Payable time</span> = after standard
          start and break rules. <span className="font-semibold text-[var(--color-text)]">Payroll time</span> =
          rounded time used by payroll.
        </p>

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
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={adminMode ? 9 : 8}>Loading…</TableCell>
              </TableRow>
            ) : null}
            {!isLoading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={adminMode ? 9 : 8}>No shifts in range.</TableCell>
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
                    <TableCell className="text-xs">{shiftDurationDisplay(row)}</TableCell>
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
                      {formatDurationSeconds(row.break_seconds)}
                    </TableCell>
                  </TableRow>
                ))
              : null}
          </TableBody>
        </Table>
      </SheetBody>
    </Sheet>
  );
}
