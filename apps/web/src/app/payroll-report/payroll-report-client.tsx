"use client";

import { FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { isAdministrator, listManagedUsers, useCurrentUser, type AuthUser } from "../../features/auth";
import { listCompanies, type Company } from "../../features/companies/api";
import {
  approveAllPending,
  approvePayrollItem,
  downloadPayrollCsv,
  fetchPayrollMonthSummary,
  fetchPayrollReport,
  markPayrollPaid,
  openPayrollPrintView,
  patchPayrollItem,
  recalculatePayroll,
  unlockPayrollItem,
  type PayrollItemRow,
  type PayrollMonthSummary,
  type PayrollReportResponse,
} from "../../features/payroll/api";
import {
  formatHoursFromSeconds,
  formatMoneyGBP,
  formatPayrollWeekRangeLabel,
} from "../../features/payroll/format";
import { listAdminTimeRecords, type TimeRecordShiftRow } from "../../features/time-records/api";
import {
  addDaysIsoYmd,
  browserDefaultTimeZone,
  mondayWeekStartIso,
} from "../../features/timesheets/week-utils";

function resolveCompanyId(user: AuthUser, override: string | null): string | null {
  if (isAdministrator(user)) {
    return override;
  }
  return user.company_id ?? null;
}

function statusBadgeLabel(status: string): string {
  if (status === "pending") {
    return "Pending";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusBadgeClass(status: string): string {
  if (status === "pending") {
    return "bg-amber-100 text-amber-900 border border-amber-800/20";
  }
  if (status === "approved") {
    return "bg-emerald-50 text-emerald-900 border border-emerald-800/20";
  }
  if (status === "paid") {
    return "bg-slate-200 text-slate-900 border border-slate-600/20";
  }
  return "bg-[var(--color-cell)] text-[var(--color-text)] border border-[var(--color-border-dark)]";
}

function formatShiftDateTime(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function PayrollReportClient() {
  const user = useCurrentUser();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyOverride, setCompanyOverride] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(() =>
    mondayWeekStartIso(new Date(), browserDefaultTimeZone()),
  );
  const [draftEmployeeId, setDraftEmployeeId] = useState("");
  const [appliedEmployeeId, setAppliedEmployeeId] = useState("");
  const [report, setReport] = useState<PayrollReportResponse | null>(null);
  const [monthSummary, setMonthSummary] = useState<PayrollMonthSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [monthLoading, setMonthLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<PayrollItemRow | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editOtherDed, setEditOtherDed] = useState("");
  const [editDispTax, setEditDispTax] = useState("");
  const [editDispNet, setEditDispNet] = useState("");
  const [editPaymentMode, setEditPaymentMode] = useState("");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [shiftRowsByUser, setShiftRowsByUser] = useState<Record<string, TimeRecordShiftRow[] | "loading">>(
    {},
  );
  const [managedUsers, setManagedUsers] = useState<AuthUser[]>([]);

  const editOpenRef = useRef(false);
  const busyRef = useRef<string | null>(null);
  const expandedUserIdRef = useRef<string | null>(null);

  const activeCompanyId = useMemo(
    () => resolveCompanyId(user, companyOverride),
    [user, companyOverride],
  );

  const policyTimeZone = report?.period.timezone_name ?? browserDefaultTimeZone();

  const weekRangeLabel = useMemo(
    () => formatPayrollWeekRangeLabel(weekStart, policyTimeZone),
    [weekStart, policyTimeZone],
  );

  const monthFromWeek = useMemo(() => {
    const y = Number(weekStart.slice(0, 4));
    const m = Number(weekStart.slice(5, 7));
    return { year: y, month: m };
  }, [weekStart]);

  const employeeOptions = useMemo(() => {
    if (!activeCompanyId) {
      return [];
    }
    return managedUsers
      .filter((u) => u.system_role === "employee" && u.company_id === activeCompanyId)
      .slice()
      .sort((a, b) => (a.email || "").localeCompare(b.email || ""));
  }, [managedUsers, activeCompanyId]);

  useEffect(() => {
    if (!isAdministrator(user)) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await listCompanies();
        if (!cancelled) {
          setCompanies(list);
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
    let cancelled = false;
    (async () => {
      try {
        const list = await listManagedUsers();
        if (!cancelled) {
          setManagedUsers(list);
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
  }, []);

  useEffect(() => {
    editOpenRef.current = editRow !== null;
  }, [editRow]);

  useEffect(() => {
    busyRef.current = busyId;
  }, [busyId]);

  useEffect(() => {
    expandedUserIdRef.current = expandedUserId;
  }, [expandedUserId]);

  async function loadReport(options?: { silent?: boolean }) {
    const silent = Boolean(options?.silent);
    if (!activeCompanyId) {
      if (!silent) {
        setError("Select a company to load payroll.");
        setReport(null);
      }
      return;
    }
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const data = await fetchPayrollReport(activeCompanyId, weekStart, {
        userId: appliedEmployeeId || null,
      });
      setReport(data);
      if (!silent) {
        setError("");
      }
    } catch (err) {
      if (!silent) {
        setReport(null);
        setError(err instanceof Error ? err.message : "Could not load payroll.");
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  const refreshPayrollSilent = useCallback(async () => {
    if (!activeCompanyId) {
      return;
    }
    if (typeof document !== "undefined") {
      if (document.visibilityState !== "visible") {
        return;
      }
      const el = document.activeElement;
      if (el && (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) {
        return;
      }
    }
    if (editOpenRef.current || busyRef.current) {
      return;
    }
    try {
      const data = await fetchPayrollReport(activeCompanyId, weekStart, {
        userId: appliedEmployeeId || null,
      });
      setReport(data);
      const exp = expandedUserIdRef.current;
      if (exp) {
        try {
          const rows = await listAdminTimeRecords({
            company_id: isAdministrator(user) ? activeCompanyId : undefined,
            user_id: exp,
            start_date: weekStart,
            end_date: addDaysIsoYmd(weekStart, 7),
            limit: 100,
          });
          setShiftRowsByUser((prev) => ({ ...prev, [exp]: rows }));
        } catch {
          /* keep cached shift rows */
        }
      }
    } catch {
      /* keep last report */
    }
  }, [activeCompanyId, weekStart, appliedEmployeeId, user]);

  useEffect(() => {
    if (!activeCompanyId) {
      return;
    }
    const tickMs = 12_000;
    const id = window.setInterval(() => {
      void refreshPayrollSilent();
    }, tickMs);
    return () => window.clearInterval(id);
  }, [activeCompanyId, weekStart, appliedEmployeeId, refreshPayrollSilent]);

  async function loadMonthSummary() {
    if (!activeCompanyId) {
      setMonthSummary(null);
      return;
    }
    setMonthLoading(true);
    try {
      const data = await fetchPayrollMonthSummary(
        activeCompanyId,
        monthFromWeek.year,
        monthFromWeek.month,
      );
      setMonthSummary(data);
    } catch {
      setMonthSummary(null);
    } finally {
      setMonthLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId, weekStart, appliedEmployeeId]);

  useEffect(() => {
    setExpandedUserId(null);
    setShiftRowsByUser({});
  }, [weekStart, activeCompanyId]);

  useEffect(() => {
    loadMonthSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId, monthFromWeek.year, monthFromWeek.month]);

  function openEdit(row: PayrollItemRow) {
    setEditRow(row);
    setEditNotes(row.notes ?? "");
    setEditOtherDed(row.other_deductions_amount ?? "0");
    setEditDispTax(row.display_tax_amount ?? row.tax_amount ?? "");
    setEditDispNet(row.display_net_amount ?? row.net_amount ?? "");
    setEditPaymentMode(row.payment_mode ?? "");
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editRow) {
      return;
    }
    setBusyId(editRow.id);
    setError("");
    try {
      await patchPayrollItem(editRow.id, {
        notes: editNotes || null,
        other_deductions_amount: editOtherDed || null,
        display_tax_amount: editDispTax || null,
        display_net_amount: editDispNet || null,
        payment_mode: editPaymentMode || null,
      });
      setEditRow(null);
      await loadReport();
    } catch {
      setError("Could not save payroll row.");
    } finally {
      setBusyId(null);
    }
  }

  async function runRecalculate() {
    if (!activeCompanyId || !confirm("Recalculate all unpaid rows from time data?")) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await recalculatePayroll(activeCompanyId, weekStart);
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recalculate failed.");
    } finally {
      setLoading(false);
    }
  }

  async function runApproveAll() {
    if (!activeCompanyId || !confirm("Approve all pending rows for this period?")) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await approveAllPending(activeCompanyId, weekStart);
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve all failed.");
    } finally {
      setLoading(false);
    }
  }

  async function rowAction(id: string, action: "approve" | "unlock" | "paid") {
    setBusyId(id);
    setError("");
    try {
      if (action === "approve") {
        await approvePayrollItem(id);
      } else if (action === "unlock") {
        await unlockPayrollItem(id);
      } else {
        await markPayrollPaid(id);
      }
      await loadReport();
    } catch {
      setError("Action failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCsv() {
    if (!activeCompanyId) {
      return;
    }
    try {
      await downloadPayrollCsv(activeCompanyId, weekStart);
    } catch {
      setError("CSV export failed.");
    }
  }

  function handlePrint() {
    if (!activeCompanyId) {
      return;
    }
    openPayrollPrintView(activeCompanyId, weekStart);
  }

  function applyEmployeeFilter() {
    setAppliedEmployeeId(draftEmployeeId);
  }

  async function toggleExpandShifts(userId: string) {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      return;
    }
    if (!activeCompanyId) {
      return;
    }
    setExpandedUserId(userId);
    if (shiftRowsByUser[userId] && shiftRowsByUser[userId] !== "loading") {
      return;
    }
    setShiftRowsByUser((prev) => ({ ...prev, [userId]: "loading" }));
    try {
      const rows = await listAdminTimeRecords({
        company_id: isAdministrator(user) ? activeCompanyId : undefined,
        user_id: userId,
        start_date: weekStart,
        end_date: addDaysIsoYmd(weekStart, 7),
        limit: 100,
      });
      setShiftRowsByUser((prev) => ({ ...prev, [userId]: rows }));
    } catch {
      setShiftRowsByUser((prev) => ({ ...prev, [userId]: [] }));
    }
  }

  const period = report?.period;
  const alerts = report?.alerts;
  const split = report?.split;

  const totalHoursSeconds = period?.total_rounded_seconds ?? 0;
  const hasCompany = Boolean(activeCompanyId);
  const showMetricFigures = Boolean(report?.period && hasCompany);

  return (
    <Sheet>
      <PageHeader
        title="Payroll report"
        description="Weekly payroll, approvals, and exports. Week is defined by the company time policy timezone."
        titleClassName="text-xl font-bold tracking-tight text-[#111827] md:text-2xl"
      />
      <SheetBody className="space-y-5">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 shadow-sm">
          <div className="space-y-4">
            {isAdministrator(user) ? (
              <div>
                <label className="block text-xs font-bold text-[#111827]">Company</label>
                <select
                  className="timiq-select mt-1.5 h-10 w-full max-w-xl rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] pl-3 text-sm font-medium text-[#111827]"
                  onChange={(event) => setCompanyOverride(event.target.value || null)}
                  value={companyOverride ?? ""}
                >
                  <option value="">Select company…</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">
                Company scope: your assigned company only.
              </p>
            )}

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-stretch">
              <div className="min-w-0">
                <WeekPickerBar
                  disabled={loading}
                  onWeekChange={setWeekStart}
                  timezoneLabel={period?.timezone_name}
                  weekStartIso={weekStart}
                />
              </div>
              <div className="flex shrink-0 flex-col justify-center rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] px-3 py-2.5 text-xs lg:max-w-[16rem]">
                <span className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">
                  Date range
                </span>
                <span className="mt-1 leading-snug font-medium text-[#111827]">{weekRangeLabel}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3">
              <label className="block min-w-[12rem] flex-1 text-xs font-bold text-[#111827]">
                Employee
                <select
                  className="timiq-select mt-1.5 h-10 w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] pl-3 text-sm font-medium text-[#111827]"
                  disabled={!activeCompanyId}
                  onChange={(event) => setDraftEmployeeId(event.target.value)}
                  value={draftEmployeeId}
                >
                  <option value="">All employees</option>
                  {employeeOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={loading || !activeCompanyId}
                  onClick={applyEmployeeFilter}
                  type="button"
                  variant="secondary"
                >
                  Apply filter
                </Button>
                <Button disabled={loading || !activeCompanyId} onClick={() => loadReport()} type="button">
                  Refresh
                </Button>
              </div>
            </div>

            <div className="border-t border-[var(--color-border-dark)] pt-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[#374151]">Actions</p>
              <div className="flex flex-wrap gap-2">
                <Button disabled={loading || !activeCompanyId} onClick={runRecalculate} type="button">
                  Recalculate
                </Button>
                <Button disabled={loading || !activeCompanyId} onClick={runApproveAll} type="button">
                  Approve all pending
                </Button>
                <Button disabled={loading || !activeCompanyId} onClick={handleCsv} type="button" variant="secondary">
                  Export CSV
                </Button>
                <Button
                  disabled={loading || !activeCompanyId}
                  onClick={handlePrint}
                  type="button"
                  variant="secondary"
                >
                  Print / PDF
                </Button>
              </div>
            </div>
          </div>
        </div>

        {!hasCompany && isAdministrator(user) ? (
          <div
            className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] px-4 py-3 text-sm font-medium text-[#1f2937]"
            role="status"
          >
            Select a company to load payroll.
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:gap-5">
          <div className="min-w-0 w-full flex-1 space-y-5 xl:min-w-0">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3 text-sm shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#4b5563]">Total hours</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[#111827]">
                  {showMetricFigures ? formatHoursFromSeconds(totalHoursSeconds) : "—"}
                </p>
              </div>
              <div className="border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3 text-sm shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#4b5563]">Gross pay</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[#111827]">
                  {showMetricFigures ? formatMoneyGBP(report?.period.total_gross) : "—"}
                </p>
              </div>
              <div className="border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3 text-sm shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#4b5563]">CIS tax</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[#111827]">
                  {showMetricFigures ? formatMoneyGBP(report?.period.total_tax) : "—"}
                </p>
              </div>
              <div className="border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3 text-sm shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#4b5563]">Net pay</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[#111827]">
                  {showMetricFigures ? formatMoneyGBP(report?.period.total_net) : "—"}
                </p>
              </div>
            </div>
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">
                Monthly payroll summary
              </p>
              {!hasCompany ? (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">Choose a company in the toolbar first.</p>
              ) : null}
              {hasCompany && monthLoading ? (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">Loading month totals…</p>
              ) : null}
              {hasCompany && !monthLoading && monthSummary ? (
                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                  <p className="text-[var(--color-text-muted)]">
                    <span className="font-semibold text-[var(--color-text)]">Month: </span>
                    {monthSummary.year}-{String(monthSummary.month).padStart(2, "0")}
                  </p>
                  <p className="text-[var(--color-text-muted)]">
                    <span className="font-semibold text-[var(--color-text)]">Payroll weeks: </span>
                    {monthSummary.payroll_weeks}
                  </p>
                  <p className="text-[var(--color-text-muted)]">
                    <span className="font-semibold text-[var(--color-text)]">Employees: </span>
                    {monthSummary.distinct_employees}
                  </p>
                  <p className="text-[var(--color-text-muted)]">
                    <span className="font-semibold text-[var(--color-text)]">Total hours: </span>
                    {formatHoursFromSeconds(monthSummary.total_rounded_seconds)}
                  </p>
                  <p className="text-[var(--color-text-muted)]">
                    <span className="font-semibold text-[var(--color-text)]">Gross: </span>
                    {formatMoneyGBP(monthSummary.total_gross)}
                  </p>
                  <p className="text-[var(--color-text-muted)]">
                    <span className="font-semibold text-[var(--color-text)]">CIS tax: </span>
                    {formatMoneyGBP(monthSummary.total_tax)}
                  </p>
                  <p className="text-[var(--color-text-muted)]">
                    <span className="font-semibold text-[var(--color-text)]">Net: </span>
                    {formatMoneyGBP(monthSummary.total_net)}
                  </p>
                </div>
              ) : null}
              {hasCompany && !monthLoading && !monthSummary ? (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">No month data loaded.</p>
              ) : null}
            </div>

            <div className="w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3 shadow-sm">
              <p className="mb-1 text-sm font-semibold text-[#111827]">Weekly payroll review</p>
              <p className="mb-3 text-xs text-[var(--color-text-muted)]">
                Summary by employee for this payroll week. Use + to open employee payroll details (shift lines).
              </p>
              <div className="w-full min-w-0 [&_thead]:bg-[#d4d4d8] [&_thead_th]:border-[var(--color-border-dark)] [&_thead_th]:text-[#111827]">
                <Table className="min-w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Employee</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>OT hours</TableHead>
                    <TableHead>Gross</TableHead>
                    <TableHead>CIS tax</TableHead>
                    <TableHead>Net pay</TableHead>
                    <TableHead>Other ded.</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell className="py-8 text-center text-sm text-[var(--color-text-muted)]" colSpan={12}>
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {!loading && !hasCompany ? (
                    <TableRow>
                      <TableCell className="py-8 text-center text-sm text-[#374151]" colSpan={12}>
                        Choose a company in the toolbar to load this table.
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {!loading && hasCompany && report && report.items.length === 0 ? (
                    <TableRow>
                      <TableCell className="py-8 text-center text-sm text-[#374151]" colSpan={12}>
                        No payroll rows for this filter. Run recalculate for the company week.
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {!loading && report
                    ? report.items.map((row) => (
                        <Fragment key={row.id}>
                          <TableRow>
                            <TableCell className="align-top">
                              <Button
                                className="min-h-8 px-1 py-0 text-xs"
                                onClick={() => toggleExpandShifts(row.user_id)}
                                type="button"
                                variant="secondary"
                              >
                                {expandedUserId === row.user_id ? "−" : "+"}
                              </Button>
                            </TableCell>
                            <TableCell className="max-w-[12rem] align-top text-xs font-medium text-[#111827]">
                              {row.employee_name ?? row.employee_email ?? "Employee"}
                            </TableCell>
                            <TableCell className="max-w-[8rem] truncate align-top text-xs text-[var(--color-text-muted)]">
                              {row.employee_job_title ?? "—"}
                            </TableCell>
                            <TableCell className="align-top text-xs tabular-nums">
                              {formatHoursFromSeconds(row.regular_seconds)}
                            </TableCell>
                            <TableCell className="align-top text-xs tabular-nums">
                              {formatHoursFromSeconds(row.overtime_seconds)}
                            </TableCell>
                            <TableCell className="align-top text-xs">
                              {row.rate_missing ? "Rate not set" : formatMoneyGBP(row.gross_amount)}
                            </TableCell>
                            <TableCell className="align-top text-xs">
                              {formatMoneyGBP(row.display_tax_amount ?? row.tax_amount)}
                            </TableCell>
                            <TableCell className="align-top text-xs">
                              {formatMoneyGBP(row.display_net_amount ?? row.net_amount)}
                            </TableCell>
                            <TableCell className="align-top text-xs">
                              {formatMoneyGBP(row.other_deductions_amount)}
                            </TableCell>
                            <TableCell className="max-w-[8rem] truncate align-top text-xs text-[var(--color-text-muted)]">
                              {row.notes?.trim() ? row.notes : "—"}
                            </TableCell>
                            <TableCell className="align-top text-xs">
                              <span
                                className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadgeClass(row.status)}`}
                              >
                                {statusBadgeLabel(row.status)}
                              </span>
                            </TableCell>
                            <TableCell className="align-top">
                              <div className="flex flex-wrap gap-1">
                                <Button
                                  className="min-h-8 px-2 py-1 text-xs"
                                  disabled={busyId === row.id}
                                  onClick={() => openEdit(row)}
                                  type="button"
                                >
                                  Edit
                                </Button>
                                {row.status === "pending" ? (
                                  <Button
                                    className="min-h-8 px-2 py-1 text-xs"
                                    disabled={busyId === row.id}
                                    onClick={() => rowAction(row.id, "approve")}
                                    type="button"
                                  >
                                    Approve
                                  </Button>
                                ) : null}
                                {row.status === "approved" ? (
                                  <>
                                    <Button
                                      className="min-h-8 px-2 py-1 text-xs"
                                      disabled={busyId === row.id}
                                      onClick={() => rowAction(row.id, "unlock")}
                                      type="button"
                                    >
                                      Unlock
                                    </Button>
                                    <Button
                                      className="min-h-8 px-2 py-1 text-xs"
                                      disabled={busyId === row.id}
                                      onClick={() => rowAction(row.id, "paid")}
                                      type="button"
                                    >
                                      Mark paid
                                    </Button>
                                  </>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                          {expandedUserId === row.user_id ? (
                            <TableRow>
                              <TableCell className="bg-[var(--color-header)]/50" colSpan={12}>
                                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[#374151]">
                                  Shift lines (this week)
                                </p>
                                <p className="mb-2 text-xs text-[var(--color-text-muted)]">
                                  Read-only clock and policy-rounded durations for this employee.
                                </p>
                                {shiftRowsByUser[row.user_id] === "loading" ? (
                                  <p className="text-xs text-[var(--color-text-muted)]">Loading shifts…</p>
                                ) : (shiftRowsByUser[row.user_id] ?? []).length === 0 ? (
                                  <p className="text-xs text-[var(--color-text-muted)]">
                                    No shifts in this date window, or none returned (max 100).
                                  </p>
                                ) : (
                                  <div className="overflow-x-auto">
                                    <table className="w-full min-w-[32rem] border-collapse text-left text-xs">
                                      <thead>
                                        <tr className="border-b border-[var(--color-border-dark)] text-[var(--color-text-soft)]">
                                          <th className="py-1 pr-2">Day / time</th>
                                          <th className="py-1 pr-2">Clock in</th>
                                          <th className="py-1 pr-2">Clock out</th>
                                          <th className="py-1 pr-2">Rounded</th>
                                          <th className="py-1 pr-2">Status</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {(shiftRowsByUser[row.user_id] as TimeRecordShiftRow[]).map(
                                          (s) => {
                                            const isOpen = s.status === "open";
                                            return (
                                              <tr
                                                key={s.shift_id}
                                                className={
                                                  isOpen
                                                    ? "border-b border-amber-800/25 bg-amber-50/80"
                                                    : "border-b border-[var(--color-border)]"
                                                }
                                              >
                                                <td className="py-1 pr-2 text-[var(--color-text-muted)]">
                                                  {formatShiftDateTime(s.clock_in_at, policyTimeZone)}
                                                </td>
                                                <td className="py-1 pr-2 tabular-nums">
                                                  {formatShiftDateTime(s.counted_clock_in_at, policyTimeZone)}
                                                </td>
                                                <td className="py-1 pr-2 tabular-nums">
                                                  {s.counted_clock_out_at
                                                    ? formatShiftDateTime(
                                                        s.counted_clock_out_at,
                                                        policyTimeZone,
                                                      )
                                                    : "—"}
                                                </td>
                                                <td className="py-1 pr-2 tabular-nums">
                                                  {s.rounded_seconds != null
                                                    ? formatHoursFromSeconds(s.rounded_seconds)
                                                    : "—"}
                                                </td>
                                                <td className="py-1 pr-2">
                                                  {isOpen ? (
                                                    <span className="inline-block rounded border border-amber-800/30 bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-950">
                                                      Open shift
                                                    </span>
                                                  ) : (
                                                    <span className="text-[var(--color-text-muted)]">{s.status}</span>
                                                  )}
                                                </td>
                                              </tr>
                                            );
                                          },
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </Fragment>
                      ))
                    : null}
                </TableBody>
              </Table>
              </div>
            </div>

            {report && hasCompany ? (
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-dark)] bg-[var(--color-header)]/40 px-3 py-3 text-sm">
                <p className="font-semibold text-[#111827]">Employee payroll details</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
                  Use the + control on a row in the weekly table to load shift-level clock data. Open shifts are
                  highlighted as &quot;Open shift&quot;.
                </p>
              </div>
            ) : null}
          </div>

          <aside className="w-full min-w-0 shrink-0 space-y-3 xl:w-72 xl:max-w-[20rem]">
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3 text-sm shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">Payroll summary</p>
              {!hasCompany ? (
                <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">—</p>
              ) : null}
              {hasCompany && period ? (
                <ul className="mt-2 space-y-1.5 text-xs text-[#111827]">
                  <li className="flex justify-between gap-2">
                    <span className="text-[var(--color-text-muted)]">Employees</span>
                    <span className="font-semibold tabular-nums">{period.total_items}</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span className="text-[var(--color-text-muted)]">Total hours</span>
                    <span className="font-semibold tabular-nums">
                      {formatHoursFromSeconds(totalHoursSeconds)}
                    </span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span className="text-[var(--color-text-muted)]">Gross pay</span>
                    <span className="font-semibold tabular-nums">{formatMoneyGBP(period.total_gross)}</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span className="text-[var(--color-text-muted)]">CIS tax</span>
                    <span className="font-semibold tabular-nums">{formatMoneyGBP(period.total_tax)}</span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <span className="text-[var(--color-text-muted)]">Net pay</span>
                    <span className="font-semibold tabular-nums">{formatMoneyGBP(period.total_net)}</span>
                  </li>
                </ul>
              ) : null}
              {hasCompany && !period ? (
                <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
                  Load a report to see totals.
                </p>
              ) : null}
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3 text-sm shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">
                Payroll split (pre-tax wages)
              </p>
              {!hasCompany ? <p className="mt-2 text-xs text-[var(--color-text-muted)]">—</p> : null}
              {hasCompany && split ? (
                <div className="mt-2 space-y-2 text-xs">
                  <div className="flex justify-between gap-2 text-[var(--color-text)]">
                    <span className="text-[var(--color-text-muted)]">Regular wages</span>
                    <span className="font-semibold tabular-nums">{formatMoneyGBP(split.regular_pay)}</span>
                  </div>
                  <div className="flex justify-between gap-2 text-[var(--color-text)]">
                    <span className="text-[var(--color-text-muted)]">Overtime wages</span>
                    <span className="font-semibold tabular-nums">{formatMoneyGBP(split.overtime_pay)}</span>
                  </div>
                  <div className="flex justify-between gap-2 text-[var(--color-text)]">
                    <span className="text-[var(--color-text-muted)]">Other pay</span>
                    <span className="font-semibold tabular-nums">{formatMoneyGBP(split.other_pay)}</span>
                  </div>
                  <div className="mt-1 border-t border-[var(--color-border-dark)] pt-2">
                    <div className="flex justify-between gap-2 font-bold text-[var(--color-text)]">
                      <span>Total gross (payroll)</span>
                      <span className="tabular-nums">{formatMoneyGBP(split.total_gross)}</span>
                    </div>
                    <p className="mt-1 text-[10px] leading-snug text-[var(--color-text-muted)]">
                      Regular and overtime lines are derived from stored hours and rate snapshots; total
                      gross matches summed payroll item gross.
                    </p>
                  </div>
                  {split.total_gross != null && Number(split.regular_pay) + Number(split.overtime_pay) > 0 ? (
                    <div className="h-2 w-full overflow-hidden rounded bg-[var(--color-border)]">
                      <div
                        className="h-2 bg-[var(--color-text-soft)]"
                        style={{
                          width: `${Math.min(
                            100,
                            (Number(split.regular_pay) /
                              (Number(split.regular_pay) + Number(split.overtime_pay))) *
                              100,
                          )}%`,
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
              {hasCompany && !split ? (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">Load payroll to view split.</p>
              ) : null}
            </div>

            {alerts ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-3 text-sm shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">Alerts</p>
                <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-[#374151]">
                  {alerts.pending_approval_count > 0 ? (
                    <li>
                      {alerts.pending_approval_count} row
                      {alerts.pending_approval_count === 1 ? "" : "s"} pending approval.
                    </li>
                  ) : null}
                  {alerts.open_shifts_started_in_week_count > 0 ? (
                    <li>
                      {alerts.open_shifts_started_in_week_count} open shift
                      {alerts.open_shifts_started_in_week_count === 1 ? "" : "s"} started this week (missing
                      clock-out).
                    </li>
                  ) : null}
                  {alerts.rate_missing_employees_count > 0 ? (
                    <li>
                      {alerts.rate_missing_employees_count} employee
                      {alerts.rate_missing_employees_count === 1 ? "" : "s"} missing hourly rate.
                    </li>
                  ) : null}
                  {alerts.zero_rounded_hours_employees_count > 0 ? (
                    <li>
                      {alerts.zero_rounded_hours_employees_count} employee
                      {alerts.zero_rounded_hours_employees_count === 1 ? "" : "s"} with zero rounded hours this
                      week.
                    </li>
                  ) : null}
                  {alerts.payroll_period_not_calculated ? (
                    <li>Payroll for this week has not been calculated yet. Run recalculate.</li>
                  ) : null}
                  {alerts.pending_approval_count === 0 &&
                  alerts.open_shifts_started_in_week_count === 0 &&
                  alerts.rate_missing_employees_count === 0 &&
                  alerts.zero_rounded_hours_employees_count === 0 &&
                  !alerts.payroll_period_not_calculated ? (
                    <li className="list-none">No issues flagged for this week.</li>
                  ) : null}
                </ul>
              </div>
            ) : hasCompany ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-3 text-sm text-[var(--color-text-muted)]">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">Alerts</p>
                <p className="mt-2 text-xs">Load payroll to see alerts.</p>
              </div>
            ) : (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-3 text-sm text-[var(--color-text-muted)]">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">Alerts</p>
                <p className="mt-2 text-xs">—</p>
              </div>
            )}
          </aside>
        </div>

        {editRow ? (
          <div
            aria-modal="true"
            className="fixed inset-0 z-[2100] flex items-start justify-center overflow-y-auto bg-black/45 p-3 md:p-6"
            role="dialog"
          >
            <div className="timiq-sheet my-4 w-full max-w-lg border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-4 shadow-md">
              <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border-dark)] pb-3">
                <p className="text-sm font-bold text-[var(--color-text)]">Edit payroll row</p>
                <Button onClick={() => setEditRow(null)} type="button">
                  Close
                </Button>
              </div>
              <form className="mt-4 space-y-2 text-sm" onSubmit={saveEdit}>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {editRow.employee_email} · Total rounded h:{" "}
                  {formatHoursFromSeconds(editRow.rounded_total_seconds)}
                </p>
                <label className="block text-xs font-bold">
                  Notes
                  <textarea
                    className="mt-1 min-h-[3rem] w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-1 text-sm"
                    onChange={(event) => setEditNotes(event.target.value)}
                    value={editNotes}
                  />
                </label>
                <label className="block text-xs font-bold">
                  Other deductions
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setEditOtherDed(event.target.value)}
                    type="text"
                    value={editOtherDed}
                  />
                </label>
                <label className="block text-xs font-bold">
                  Display CIS tax
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setEditDispTax(event.target.value)}
                    type="text"
                    value={editDispTax}
                  />
                </label>
                <label className="block text-xs font-bold">
                  Display net
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setEditDispNet(event.target.value)}
                    type="text"
                    value={editDispNet}
                  />
                </label>
                <label className="block text-xs font-bold">
                  Payment mode
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setEditPaymentMode(event.target.value)}
                    type="text"
                    value={editPaymentMode}
                  />
                </label>
                <Button disabled={busyId === editRow.id} type="submit">
                  {busyId === editRow.id ? "Saving…" : "Save edits"}
                </Button>
              </form>
            </div>
          </div>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
