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
import { useAdministratorCompanyScope } from "../../features/companies/selected-company";
import {
  approveAllPending,
  approvePayrollItem,
  createPayrollLateShiftAdjustment,
  downloadPayrollCsv,
  downloadPayrollPdfReport,
  fetchPayrollMonthSummary,
  fetchPayrollReport,
  markPayrollPaid,
  openPayrollItemPayslip,
  openPayrollPrintView,
  patchPayrollItem,
  recalculatePayroll,
  undoPayrollPaid,
  unlockPayrollItem,
  type PayrollItemRow,
  type PayrollLateUnpaidEmployee,
  type PayrollMonthSummary,
  type PayrollReportResponse,
} from "../../features/payroll/api";
import {
  effectiveDisplayedTaxAmount,
  formatHoursFromSeconds,
  formatMoneyGBP,
  formatPayrollWeekRangeLabel,
} from "../../features/payroll/format";
import { listAdminTimeRecords, type TimeRecordShiftRow } from "../../features/time-records/api";
import { leaveTypeLabel } from "../../features/leave/labels";
import {
  addDaysIsoYmd,
  browserDefaultTimeZone,
  mondayWeekStartIso,
} from "../../features/timesheets/week-utils";
import { payrollStatusLabel } from "../../lib/i18n/display-labels";
import { useT } from "../../lib/i18n";

function resolveCompanyId(user: AuthUser, override: string | null): string | null {
  if (isAdministrator(user)) {
    return override;
  }
  return user.company_id ?? null;
}

function statusBadgeLabel(
  t: (key: string, fallback?: string) => string,
  status: string,
): string {
  return payrollStatusLabel(t, status);
}

function lateUnpaidBlockForUser(
  report: PayrollReportResponse | null,
  userId: string,
): PayrollLateUnpaidEmployee | null {
  const blocks = report?.late_unpaid_employees;
  if (!blocks?.length) {
    return null;
  }
  return blocks.find((b) => b.user_id === userId) ?? null;
}

/** Late shifts tied to this paid payroll row with payable (rounded > 0) time. */
function paidRowHasPayableLateShiftsForRef(row: PayrollItemRow, lateBlock: PayrollLateUnpaidEmployee | null): boolean {
  if (row.status !== "paid" || !lateBlock?.shifts?.length) {
    return false;
  }
  return lateBlock.shifts.some((s) => s.reference_paid_item_id === row.id && s.rounded_seconds > 0);
}

function canShowLateAdjustmentForPaidRow(
  row: PayrollItemRow,
  lateBlock: PayrollLateUnpaidEmployee | null,
  report: PayrollReportResponse | null,
): boolean {
  if (!paidRowHasPayableLateShiftsForRef(row, lateBlock)) {
    return false;
  }
  return (
    report?.has_payable_late_unpaid_shifts === true || (report?.late_unpaid_total_rounded_seconds ?? 0) > 0
  );
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

function normalizePaymentMode(value: string | null | undefined): "net_payment" | "gross_payment" {
  const raw = (value ?? "").trim().toLowerCase();
  if (raw === "gross_payment" || raw === "gross") {
    return "gross_payment";
  }
  if (raw === "net_payment" || raw === "net") {
    return "net_payment";
  }
  return "net_payment";
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

const UUID_LIKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function payrollEmployeeDisplayLines(row: {
  employee_name: string | null;
  employee_email: string | null;
}): { primary: string; secondary: string | null } {
  const email = row.employee_email?.trim() || null;
  const rawName = row.employee_name?.trim() || null;
  const name =
    rawName && !UUID_LIKE.test(rawName) ? rawName : null;
  const primary = name || email || "Employee";
  const secondary =
    email && primary !== email ? email : null;
  return { primary, secondary };
}

function PayrollEmployeeIdentity(props: {
  employee_name: string | null;
  employee_email: string | null;
  className?: string;
}) {
  const { primary, secondary } = payrollEmployeeDisplayLines(props);
  return (
    <div className={props.className}>
      <div className="font-medium leading-snug text-[#111827]">{primary}</div>
      {secondary ? (
        <div className="mt-0.5 text-[11px] leading-snug text-[var(--color-text-muted)]">{secondary}</div>
      ) : null}
    </div>
  );
}

export function PayrollReportClient() {
  const t = useT();
  const user = useCurrentUser();
  const [companies, setCompanies] = useState<Company[]>([]);
  const companyScope = useAdministratorCompanyScope(user, companies);
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
  const [payrollSaveMessage, setPayrollSaveMessage] = useState("");
  const [editRow, setEditRow] = useState<PayrollItemRow | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editOtherDed, setEditOtherDed] = useState("");
  const [editDispTax, setEditDispTax] = useState("");
  const [editDispNet, setEditDispNet] = useState("");
  const [editPaymentMode, setEditPaymentMode] = useState<"net_payment" | "gross_payment">("net_payment");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [shiftRowsByUser, setShiftRowsByUser] = useState<Record<string, TimeRecordShiftRow[] | "loading">>(
    {},
  );
  const [managedUsers, setManagedUsers] = useState<AuthUser[]>([]);
  const [undoPaidRow, setUndoPaidRow] = useState<PayrollItemRow | null>(null);
  const [undoPaidReason, setUndoPaidReason] = useState("");
  const [undoPaidAckExport, setUndoPaidAckExport] = useState(false);

  const editOpenRef = useRef(false);
  const busyRef = useRef<string | null>(null);
  const expandedUserIdRef = useRef<string | null>(null);

  const activeCompanyId = useMemo(
    () => resolveCompanyId(user, companyScope.companyId),
    [user, companyScope.companyId],
  );

  useEffect(() => {
    setDraftEmployeeId("");
    setAppliedEmployeeId("");
    setPayrollSaveMessage("");
  }, [activeCompanyId]);

  useEffect(() => {
    setPayrollSaveMessage("");
  }, [weekStart]);

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
    if (isAdministrator(user) && !activeCompanyId) {
      setManagedUsers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await listManagedUsers(
          isAdministrator(user) ? activeCompanyId : undefined,
        );
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
  }, [user, activeCompanyId]);

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
        setError(t("payroll.report.select_company_load", "Select a company to load payroll."));
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
      if (!silent && data.payroll_auto_recalculated) {
        setPayrollSaveMessage(t("payroll.report.refreshed", "Payroll refreshed from latest time records."));
      }
      if (!silent) {
        setError("");
      }
    } catch (err) {
      if (!silent) {
        setReport(null);
        setError(err instanceof Error ? err.message : t("payroll.report.load_error", "Could not load payroll."));
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

  useEffect(() => {
    if (!payrollSaveMessage) {
      return;
    }
    const saveMsgTimerId = window.setTimeout(() => setPayrollSaveMessage(""), 5000);
    return () => window.clearTimeout(saveMsgTimerId);
  }, [payrollSaveMessage]);

  function openEdit(row: PayrollItemRow) {
    setPayrollSaveMessage("");
    setEditRow(row);
    setEditNotes(row.notes ?? "");
    setEditOtherDed(row.other_deductions_amount ?? "0");
    setEditDispTax(
      effectiveDisplayedTaxAmount(row.display_tax_amount, row.tax_amount, row.payment_mode) ?? "",
    );
    setEditDispNet(row.display_net_amount ?? row.net_amount ?? "");
    setEditPaymentMode(normalizePaymentMode(row.payment_mode));
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editRow) {
      return;
    }
    setBusyId(editRow.id);
    setError("");
    try {
      if (editRow.status === "paid") {
        await patchPayrollItem(editRow.id, {
          notes: editNotes || null,
        });
      } else {
        await patchPayrollItem(editRow.id, {
          notes: editNotes || null,
          other_deductions_amount: editOtherDed || null,
          display_tax_amount: editDispTax || null,
          display_net_amount: editDispNet || null,
          payment_mode: editPaymentMode,
        });
      }
      setEditRow(null);
      setPayrollSaveMessage(t("payroll.report.row_saved", "Payroll row saved."));
      await loadReport();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("payroll.report.save_error", "Could not save payroll row."));
    } finally {
      setBusyId(null);
    }
  }

  async function runRecalculate() {
    if (!activeCompanyId) {
      return;
    }
    const paid = report?.period.paid_count ?? 0;
    const approved = report?.period.approved_count ?? 0;
    if (paid > 0) {
      setError(t("payroll.report.paid_locked", "Paid payroll rows are locked and cannot be rebuilt."));
      return;
    }
    if (approved > 0) {
      setError(
        t("payroll.report.approved_unlock_first", "Some payroll rows are approved. Unlock them before recalculating."),
      );
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await recalculatePayroll(activeCompanyId, weekStart);
      setReport(data);
      setPayrollSaveMessage(t("payroll.report.refreshed", "Payroll refreshed from latest time records."));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("payroll.report.recalc_failed", "Recalculate failed."));
    } finally {
      setLoading(false);
    }
  }

  async function runApproveAll() {
    if (!activeCompanyId || !confirm(t("payroll.report.approve_all_confirm", "Approve all pending rows for this period?"))) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await approveAllPending(activeCompanyId, weekStart);
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("payroll.report.approve_all_failed", "Approve all failed."));
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
      setError(t("payroll.report.action_failed", "Action failed."));
    } finally {
      setBusyId(null);
    }
  }

  async function runCreateLateAdjustment(paidItemId: string) {
    setBusyId(paidItemId);
    setError("");
    try {
      await createPayrollLateShiftAdjustment(paidItemId, { confirm: true });
      setPayrollSaveMessage(
        t("payroll.report.adjustment_created", "Pending adjustment row created for late shifts."),
      );
      await loadReport();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("payroll.report.adjustment_failed", "Could not create adjustment."));
    } finally {
      setBusyId(null);
    }
  }

  async function submitUndoPaid() {
    if (!undoPaidRow) {
      return;
    }
    const reason = undoPaidReason.trim();
    if (!reason) {
      setError(t("payroll.report.undo_reason_required", "A reason is required to undo paid."));
      return;
    }
    if (report?.accounting_payroll_export_overlaps && !undoPaidAckExport) {
      setError(
        t("payroll.report.export_ack_required", "Confirm the accounting export acknowledgment, or refresh the report."),
      );
      return;
    }
    setBusyId(undoPaidRow.id);
    setError("");
    try {
      await undoPayrollPaid(undoPaidRow.id, {
        reason,
        confirm: true,
        acknowledge_accounting_export: undoPaidAckExport,
      });
      setUndoPaidRow(null);
      setUndoPaidReason("");
      setUndoPaidAckExport(false);
      setPayrollSaveMessage(t("payroll.report.undo_paid_success", "Payroll row moved back to Approved."));
      await loadReport();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("payroll.report.undo_paid_failed", "Undo paid failed."));
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
      setError(t("payroll.report.csv_export_failed", "CSV export failed."));
    }
  }

  function handlePrint() {
    if (!activeCompanyId) {
      return;
    }
    openPayrollPrintView(activeCompanyId, weekStart, appliedEmployeeId || null);
  }

  async function handlePdfDownload() {
    if (!activeCompanyId) {
      return;
    }
    try {
      await downloadPayrollPdfReport(activeCompanyId, weekStart, appliedEmployeeId || null);
    } catch {
      setError(
        t("payroll.report.pdf_export_failed", "Could not download payroll PDF report."),
      );
    }
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
  const payrollPeriodNotCalculated = Boolean(alerts?.payroll_period_not_calculated);
  const payrollNeedsRecalculation = Boolean(alerts?.payroll_needs_recalculation);
  const paidRowCount = period?.paid_count ?? 0;
  const approvedRowCount = period?.approved_count ?? 0;
  const lateShiftDetected = Boolean(report?.has_late_unpaid_shifts);
  const lateDetectedCount = report?.late_shift_count_detected ?? report?.late_shift_count ?? 0;
  const canAdjustLateShiftsGlobally =
    report?.has_payable_late_unpaid_shifts === true || (report?.late_unpaid_total_rounded_seconds ?? 0) > 0;

  return (
    <Sheet>
      <PageHeader
        title={t("payroll.report.title", "Payroll report")}
        description={t(
          "payroll.report.subtitle",
          "Weekly payroll, approvals, and exports. Week is defined by the company time policy timezone.",
        )}
        titleClassName="text-xl font-bold tracking-tight text-[#111827] md:text-2xl"
      />
      <SheetBody className="min-w-0 space-y-5">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 shadow-sm">
          <div className="space-y-4">
            {isAdministrator(user) ? (
              <div>
                <label className="block text-xs font-bold text-[#111827]">
                  {t("payroll.report.company", "Company")}
                </label>
                <select
                  className="timiq-select mt-1.5 h-10 w-full max-w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] pl-3 text-sm font-medium text-[#111827]"
                  onChange={(event) => companyScope.setCompanyId(event.target.value)}
                  value={companyScope.companyId ?? ""}
                >
                  <option value="">{t("payroll.report.select_company", "Select company…")}</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">
                {t("payroll.report.company_scope_admin", "Company scope: your assigned company only.")}
              </p>
            )}

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-stretch">
              <div className="min-w-0">
                <WeekPickerBar
                  disabled={loading}
                  onWeekChange={setWeekStart}
                  payrollTimeZone={policyTimeZone}
                  timezoneLabel={period?.timezone_name}
                  weekStartIso={weekStart}
                />
              </div>
              <div className="flex shrink-0 flex-col justify-center rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] px-3 py-2.5 text-xs lg:max-w-[16rem]">
                <span className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">
                  {t("payroll.report.date_range", "Date range")}
                </span>
                <span className="mt-1 leading-snug font-medium text-[#111827]">{weekRangeLabel}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3">
              <label className="block w-full min-w-0 flex-1 text-xs font-bold text-[#111827] sm:min-w-[12rem]">
                {t("payroll.report.employee_label", "Employee")}
                <select
                  className="timiq-select mt-1.5 h-10 w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] pl-3 text-sm font-medium text-[#111827]"
                  disabled={!activeCompanyId}
                  onChange={(event) => setDraftEmployeeId(event.target.value)}
                  value={draftEmployeeId}
                >
                  <option value="">{t("payroll.report.all_employees", "All employees")}</option>
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
                  {t("payroll.report.apply_filter", "Apply filter")}
                </Button>
                <Button disabled={loading || !activeCompanyId} onClick={() => loadReport()} type="button">
                  {t("payroll.report.refresh", "Refresh")}
                </Button>
              </div>
            </div>

            <div className="border-t border-[var(--color-border-dark)] pt-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[#374151]">
                {t("payroll.report.actions", "Actions")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button disabled={loading || !activeCompanyId} onClick={runRecalculate} type="button">
                  {payrollPeriodNotCalculated
                    ? t("payroll.report.calculate", "Calculate payroll")
                    : t("payroll.report.recalculate", "Recalculate")}
                </Button>
                <Button disabled={loading || !activeCompanyId} onClick={runApproveAll} type="button">
                  {t("payroll.report.approve_all_pending", "Approve all pending")}
                </Button>
                <Button disabled={loading || !activeCompanyId} onClick={handleCsv} type="button" variant="secondary">
                  {t("payroll.report.export_csv", "Export CSV")}
                </Button>
                <Button
                  disabled={loading || !activeCompanyId}
                  onClick={handlePrint}
                  type="button"
                  variant="secondary"
                >
                  {t("payroll.report.print_report", "Print report")}
                </Button>
                <Button
                  disabled={loading || !activeCompanyId}
                  onClick={handlePdfDownload}
                  type="button"
                  variant="secondary"
                >
                  {t("payroll.report.export_pdf", "Download PDF report")}
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
            {t("payroll.report.select_company_banner", "Select a company to load payroll.")}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        {payrollSaveMessage ? (
          <div
            className="rounded-[var(--radius-md)] border border-emerald-800/25 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-950"
            role="status"
          >
            {payrollSaveMessage}
          </div>
        ) : null}

        {hasCompany && lateShiftDetected ? (
          <div
            className="rounded-[var(--radius-md)] border border-amber-800/30 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            role="status"
          >
            <p className="font-semibold">
              {t("payroll.report.late_shifts_title", "Late completed shifts after payroll was paid")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-amber-900/90">
              {canAdjustLateShiftsGlobally ? (
                <>
                  {lateDetectedCount} shift
                  {lateDetectedCount === 1 ? "" : "s"} detected (
                  {formatHoursFromSeconds(report?.late_unpaid_total_rounded_seconds ?? 0)} unpaid rounded hours). Use{" "}
                  <span className="font-medium">Adjustment</span> on the paid row to create a pending supplemental payroll
                  item. Paid rows stay frozen.
                </>
              ) : lateDetectedCount === 1 ? (
                <>
                  1 late shift was detected, but it has 0 payroll-rounded hours, so no adjustment is required. Paid rows
                  stay frozen.
                </>
              ) : (
                <>
                  {lateDetectedCount} late shifts were detected, but they have 0 payroll-rounded hours, so no adjustment
                  is required. Paid rows stay frozen.
                </>
              )}
            </p>
          </div>
        ) : null}

        {hasCompany && payrollPeriodNotCalculated ? (
          <div
            className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-3 text-sm text-[#1f2937]"
            role="region"
          >
            <p className="font-semibold text-[#111827]">
              {t("payroll.report.not_calculated_title", "Payroll not calculated for this week yet")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
              {t(
                "payroll.report.not_calculated_body",
                "Rows are built on the server from time records. Use Calculate payroll or Refresh if this message persists.",
              )}
            </p>
            <div className="mt-3">
              <Button disabled={loading} onClick={runRecalculate} type="button">
                {loading ? "Working…" : "Calculate payroll"}
              </Button>
            </div>
          </div>
        ) : null}

        {hasCompany && payrollNeedsRecalculation && !payrollPeriodNotCalculated && paidRowCount > 0 ? (
          <div
            className="rounded-[var(--radius-md)] border border-slate-600/25 bg-slate-100 px-4 py-3 text-sm text-slate-950"
            role="status"
          >
            <p className="font-semibold">{t("payroll.report.locked_title", "Payroll locked")}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-800/90">
              Paid payroll rows are locked and cannot be rebuilt.
            </p>
          </div>
        ) : null}

        {hasCompany &&
        payrollNeedsRecalculation &&
        !payrollPeriodNotCalculated &&
        paidRowCount === 0 &&
        approvedRowCount > 0 ? (
          <div
            className="rounded-[var(--radius-md)] border border-amber-800/25 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            role="status"
          >
            <p className="font-semibold">
              {t("payroll.report.recalc_blocked_title", "Recalculation blocked")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-amber-900/90">
              Some payroll rows are approved. Unlock them before recalculating.
            </p>
          </div>
        ) : null}

        {hasCompany &&
        payrollNeedsRecalculation &&
        !payrollPeriodNotCalculated &&
        paidRowCount === 0 &&
        approvedRowCount === 0 ? (
          <div
            className="rounded-[var(--radius-md)] border border-amber-800/25 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            role="status"
          >
            <p className="font-semibold">
              {t("payroll.report.needs_recalc_title", "Needs recalculation")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-amber-900/90">
              {t(
                "payroll.report.needs_recalc_body",
                "Time records in this week changed after the last payroll run. Use Refresh or Recalculate to update pending rows.",
              )}
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-5">
          <div className="min-w-0 w-full flex-1 space-y-5 xl:min-w-0">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3 text-sm shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#4b5563]">
                  {t("payroll.report.total_hours", "Total hours")}
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[#111827]">
                  {showMetricFigures ? formatHoursFromSeconds(totalHoursSeconds) : "—"}
                </p>
              </div>
              <div className="border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3 text-sm shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#4b5563]">
                  {t("payroll.report.gross_pay", "Gross pay")}
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[#111827]">
                  {showMetricFigures ? formatMoneyGBP(report?.period.total_gross) : "—"}
                </p>
              </div>
              <div className="border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3 text-sm shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#4b5563]">
                  {t("payroll.report.cis_tax", "CIS tax")}
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[#111827]">
                  {showMetricFigures ? formatMoneyGBP(report?.period.total_tax) : "—"}
                </p>
              </div>
              <div className="border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3 text-sm shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#4b5563]">
                  {t("payroll.report.net_pay", "Net pay")}
                </p>
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
              {report ? (
                <div className="mb-3 rounded-[var(--radius-md)] border border-slate-200 bg-slate-50/90 px-3 py-2.5 text-xs text-slate-900">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-600">Approved leave (review)</p>
                  <p className="mt-1 leading-relaxed text-slate-700">
                    {report.payroll_leave_review_note ??
                      "Leave is shown for review only. Automatic paid leave in gross totals is not enabled in this batch."}
                  </p>
                  {(report.approved_leave_in_week?.length ?? 0) > 0 ? (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full min-w-[520px] border-collapse text-left text-[11px]">
                        <thead>
                          <tr className="border-b border-slate-300 text-slate-600">
                            <th className="py-1 pr-2 font-semibold">Employee</th>
                            <th className="py-1 pr-2 font-semibold">Type</th>
                            <th className="py-1 pr-2 font-semibold">Dates</th>
                            <th className="py-1 pr-2 font-semibold">Days</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(report.approved_leave_in_week ?? []).map((lv) => (
                            <tr className="border-b border-slate-200/80" key={`${lv.user_id}-${lv.date_from}-${lv.date_to}-${lv.leave_type}`}>
                              <td className="py-1 pr-2">
                                {lv.employee_name?.trim() || lv.employee_email || lv.user_id}
                              </td>
                              <td className="py-1 pr-2">{leaveTypeLabel(lv.leave_type)}</td>
                              <td className="py-1 pr-2 tabular-nums text-slate-600">
                                {lv.date_from} → {lv.date_to}
                              </td>
                              <td className="py-1 pr-2 tabular-nums">{lv.total_days}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] text-slate-600">No approved leave overlaps this payroll week.</p>
                  )}
                </div>
              ) : null}
              <div className="timiq-scroll-x w-full min-w-0 [&_thead]:bg-[#d4d4d8] [&_thead_th]:border-[var(--color-border-dark)] [&_thead_th]:text-[#111827]">
                <Table className="min-w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>{t("payroll.report.col_employee", "Employee")}</TableHead>
                    <TableHead>{t("employees.col_role", "Role")}</TableHead>
                    <TableHead>{t("payroll.report.col_hours", "Hours")}</TableHead>
                    <TableHead>{t("payroll.report.col_ot_hours", "OT hours")}</TableHead>
                    <TableHead>{t("payroll.report.col_gross", "Gross")}</TableHead>
                    <TableHead>{t("payroll.report.col_cis", "CIS tax")}</TableHead>
                    <TableHead>{t("payroll.report.col_net", "Net pay")}</TableHead>
                    <TableHead>{t("payroll.report.col_other_ded", "Other ded.")}</TableHead>
                    <TableHead>{t("payroll.report.col_notes", "Notes")}</TableHead>
                    <TableHead>{t("payroll.report.col_status", "Status")}</TableHead>
                    <TableHead>{t("payroll.report.col_actions", "Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell className="py-8 text-center text-sm text-[var(--color-text-muted)]" colSpan={12}>
                        {t("payroll.report.loading_table", "Loading…")}
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {!loading && !hasCompany ? (
                    <TableRow>
                      <TableCell className="py-8 text-center text-sm text-[#374151]" colSpan={12}>
                        {t("payroll.report.choose_company_table", "Choose a company in the toolbar to load this table.")}
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {!loading && hasCompany && report && report.items.length === 0 ? (
                    <TableRow>
                      <TableCell className="py-8 text-center text-sm text-[#374151]" colSpan={12}>
                        {payrollPeriodNotCalculated
                          ? t(
                              "payroll.report.empty_not_calc",
                              "No payroll rows yet. Use Calculate payroll in Actions (or the banner above).",
                            )
                          : appliedEmployeeId
                            ? t("payroll.report.empty_filtered", "No payroll rows for this employee filter.")
                            : t(
                                "payroll.report.empty_week",
                                "No payroll rows for this week. Use Recalculate if employees should appear.",
                              )}
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {!loading && report
                    ? report.items.map((row) => {
                        const lateBlock = lateUnpaidBlockForUser(report, row.user_id);
                        return (
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
                            <TableCell className="max-w-[14rem] min-w-0 align-top text-xs">
                              <PayrollEmployeeIdentity
                                employee_email={row.employee_email}
                                employee_name={row.employee_name}
                              />
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
                              {row.rate_missing
                                ? t("payroll.report.rate_not_set", "Rate not set")
                                : formatMoneyGBP(row.gross_amount)}
                            </TableCell>
                            <TableCell className="align-top text-xs">
                              {formatMoneyGBP(
                                effectiveDisplayedTaxAmount(
                                  row.display_tax_amount,
                                  row.tax_amount,
                                  row.payment_mode,
                                ),
                              )}
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
                                {statusBadgeLabel(t, row.status)}
                                {row.status === "paid" ? t("payroll.report.locked_suffix", " · Locked") : ""}
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
                                  {row.status === "paid"
                                    ? t("payroll.report.edit_notes", "Edit notes")
                                    : t("payroll.report.edit", "Edit")}
                                </Button>
                                {row.status === "paid" ? (
                                  <>
                                    <Button
                                      className="min-h-8 px-2 py-1 text-xs"
                                      disabled={busyId === row.id}
                                      onClick={() => openPayrollItemPayslip(row.id)}
                                      type="button"
                                      variant="secondary"
                                    >
                                      {t("payroll.report.payslip", "Payslip")}
                                    </Button>
                                    <Button
                                      className="min-h-8 px-2 py-1 text-xs"
                                      disabled={busyId === row.id}
                                      onClick={() => {
                                        setUndoPaidRow(row);
                                        setUndoPaidReason("");
                                        setUndoPaidAckExport(false);
                                      }}
                                      type="button"
                                      variant="secondary"
                                    >
                                      {t("payroll.report.undo_paid", "Undo paid")}
                                    </Button>
                                    {canShowLateAdjustmentForPaidRow(row, lateBlock, report) ? (
                                      <Button
                                        className="min-h-8 px-2 py-1 text-xs"
                                        disabled={busyId === row.id}
                                        onClick={() => void runCreateLateAdjustment(row.id)}
                                        type="button"
                                        variant="secondary"
                                      >
                                        {t("payroll.report.adjustment", "Adjustment")}
                                      </Button>
                                    ) : null}
                                  </>
                                ) : null}
                                {row.status === "pending" ? (
                                  <Button
                                    className="min-h-8 px-2 py-1 text-xs"
                                    disabled={busyId === row.id}
                                    onClick={() => rowAction(row.id, "approve")}
                                    type="button"
                                  >
                                    {t("payroll.report.approve", "Approve")}
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
                                      {t("payroll.report.unlock", "Unlock")}
                                    </Button>
                                    <Button
                                      className="min-h-8 px-2 py-1 text-xs"
                                      disabled={busyId === row.id}
                                      onClick={() => rowAction(row.id, "paid")}
                                      type="button"
                                    >
                                      {t("payroll.report.mark_paid", "Mark paid")}
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
                                <div className="mb-2">
                                  <PayrollEmployeeIdentity
                                    employee_email={row.employee_email}
                                    employee_name={row.employee_name}
                                  />
                                  <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">
                                    Read-only clock and policy-rounded durations for this employee.
                                  </p>
                                </div>
                                {shiftRowsByUser[row.user_id] === "loading" ? (
                                  <p className="text-xs text-[var(--color-text-muted)]">Loading shifts…</p>
                                ) : (shiftRowsByUser[row.user_id] ?? []).length === 0 ? (
                                  <p className="text-xs text-[var(--color-text-muted)]">
                                    No shifts in this date window, or none returned (max 100).
                                  </p>
                                ) : (
                                  <div className="min-w-0 max-w-full overflow-x-auto [-webkit-overflow-scrolling:touch]">
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
                                {lateBlock && lateBlock.shifts.length > 0 ? (
                                  <div className="mt-4 border-t border-amber-800/25 pt-3">
                                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-950">
                                      Unpaid late shifts (completed after payroll was paid)
                                    </p>
                                    <p className="mb-2 text-[11px] leading-relaxed text-amber-950/90">
                                      Est. gross {formatMoneyGBP(lateBlock.estimated_gross_amount)} · CIS{" "}
                                      {formatMoneyGBP(lateBlock.estimated_cis_tax_amount)} · net{" "}
                                      {formatMoneyGBP(lateBlock.estimated_net_amount)} for these shifts (pending
                                      adjustment uses the same rules as payroll).
                                    </p>
                                    <div className="min-w-0 max-w-full overflow-x-auto [-webkit-overflow-scrolling:touch]">
                                      <table className="w-full min-w-[28rem] border-collapse text-left text-xs">
                                        <thead>
                                          <tr className="border-b border-amber-800/30 text-amber-950/80">
                                            <th className="py-1 pr-2">Clock in</th>
                                            <th className="py-1 pr-2">Clock out</th>
                                            <th className="py-1 pr-2">Rounded</th>
                                            <th className="py-1 pr-2">Reason</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {lateBlock.shifts.map((ls) => (
                                            <tr key={ls.shift_id} className="border-b border-amber-800/15">
                                              <td className="py-1 pr-2 tabular-nums">
                                                {formatShiftDateTime(ls.clock_in_at, policyTimeZone)}
                                              </td>
                                              <td className="py-1 pr-2 tabular-nums">
                                                {ls.clock_out_at
                                                  ? formatShiftDateTime(ls.clock_out_at, policyTimeZone)
                                                  : "—"}
                                              </td>
                                              <td className="py-1 pr-2 tabular-nums">
                                                {formatHoursFromSeconds(ls.rounded_seconds)}
                                              </td>
                                              <td className="py-1 pr-2 text-[var(--color-text-muted)]">
                                                {ls.reason === "completed_after_paid"
                                                  ? "After paid (heuristic)"
                                                  : ls.reason}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                ) : null}
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </Fragment>
                        );
                      })
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

          <aside className="w-full min-w-0 max-w-full shrink-0 space-y-3 lg:w-64 lg:max-w-[min(20rem,calc(100vw-2rem))] xl:w-72">
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
                    <li>Payroll for this week has not been calculated yet. Use Calculate payroll or Refresh.</li>
                  ) : null}
                  {alerts.payroll_needs_recalculation && (period?.paid_count ?? 0) > 0 ? (
                    <li>Paid payroll rows are locked and cannot be rebuilt.</li>
                  ) : null}
                  {alerts.payroll_needs_recalculation &&
                  (period?.paid_count ?? 0) === 0 &&
                  (period?.approved_count ?? 0) > 0 ? (
                    <li>Some payroll rows are approved. Unlock them before recalculating.</li>
                  ) : null}
                  {alerts.payroll_needs_recalculation &&
                  (period?.paid_count ?? 0) === 0 &&
                  (period?.approved_count ?? 0) === 0 ? (
                    <li>
                      Time records in this week changed after the last payroll calculation. Use Refresh or
                      Recalculate to update pending rows.
                    </li>
                  ) : null}
                  {alerts.pending_approval_count === 0 &&
                  alerts.open_shifts_started_in_week_count === 0 &&
                  alerts.rate_missing_employees_count === 0 &&
                  alerts.zero_rounded_hours_employees_count === 0 &&
                  !alerts.payroll_period_not_calculated &&
                  !alerts.payroll_needs_recalculation ? (
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
            className="fixed inset-0 z-[2100] flex items-start justify-center overflow-x-hidden overflow-y-auto bg-black/45 p-3 md:p-6"
            role="dialog"
          >
            <div className="timiq-sheet mx-auto my-4 w-full min-w-0 max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-4 shadow-md sm:max-w-[min(42rem,calc(100vw-3rem))]">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-border-dark)] pb-3">
                <p className="text-sm font-bold text-[var(--color-text)]">
                  {editRow.status === "paid" ? "Edit paid payroll row (notes only)" : "Edit payroll row"}
                </p>
                <Button onClick={() => setEditRow(null)} type="button">
                  Close
                </Button>
              </div>
              <form className="mt-4 space-y-2 text-sm" onSubmit={saveEdit}>
                <div className="text-xs text-[var(--color-text-muted)]">
                  <PayrollEmployeeIdentity
                    employee_email={editRow.employee_email}
                    employee_name={editRow.employee_name}
                    className="text-[var(--color-text)]"
                  />
                  <p className="mt-1.5">
                    Total rounded h: {formatHoursFromSeconds(editRow.rounded_total_seconds)}
                  </p>
                  {editRow.status === "paid" ? (
                    <p className="mt-2 rounded border border-slate-600/20 bg-slate-100 px-2 py-1.5 text-[11px] font-medium text-slate-900">
                      This row is paid and locked. Hours and pay amounts cannot be changed here.
                    </p>
                  ) : null}
                </div>
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
                    disabled={editRow.status === "paid"}
                    onChange={(event) => setEditOtherDed(event.target.value)}
                    type="text"
                    value={editOtherDed}
                  />
                </label>
                <label className="block text-xs font-bold">
                  Display CIS tax
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    disabled={editRow.status === "paid"}
                    onChange={(event) => setEditDispTax(event.target.value)}
                    type="text"
                    value={editDispTax}
                  />
                </label>
                <label className="block text-xs font-bold">
                  Display net
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    disabled={editRow.status === "paid"}
                    onChange={(event) => setEditDispNet(event.target.value)}
                    type="text"
                    value={editDispNet}
                  />
                </label>
                <label className="block text-xs font-bold">
                  Payment mode
                  <select
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    disabled={editRow.status === "paid"}
                    onChange={(event) =>
                      setEditPaymentMode(
                        normalizePaymentMode(event.target.value),
                      )
                    }
                    value={normalizePaymentMode(editPaymentMode)}
                  >
                    <option value="net_payment">Net payment</option>
                    <option value="gross_payment">Gross payment</option>
                  </select>
                </label>
                <Button disabled={busyId === editRow.id} type="submit">
                  {busyId === editRow.id ? "Saving…" : "Save edits"}
                </Button>
              </form>
            </div>
          </div>
        ) : null}

        {undoPaidRow ? (
          <div
            aria-modal="true"
            className="fixed inset-0 z-[2100] flex items-start justify-center overflow-x-hidden overflow-y-auto bg-black/45 p-3 md:p-6"
            role="dialog"
          >
            <div className="timiq-sheet mx-auto my-4 w-full min-w-0 max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-4 shadow-md sm:max-w-[min(42rem,calc(100vw-3rem))]">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-border-dark)] pb-3">
                <p className="text-sm font-bold text-[var(--color-text)]">Undo paid</p>
                <Button
                  onClick={() => {
                    setUndoPaidRow(null);
                    setUndoPaidReason("");
                    setUndoPaidAckExport(false);
                  }}
                  type="button"
                >
                  Close
                </Button>
              </div>
              <div className="mt-4 space-y-3 text-sm">
                <PayrollEmployeeIdentity
                  employee_email={undoPaidRow.employee_email}
                  employee_name={undoPaidRow.employee_name}
                  className="text-[var(--color-text)]"
                />
                <p className="rounded border border-amber-800/25 bg-amber-50 px-2 py-2 text-xs font-medium text-amber-950">
                  Undoing paid moves this payroll item back to <span className="font-semibold">Approved</span>. Amounts
                  are not recalculated. Use only if payment was marked paid by mistake.
                </p>
                {report?.accounting_payroll_export_overlaps ? (
                  <label className="flex cursor-pointer items-start gap-2 text-xs text-[#111827]">
                    <input
                      checked={undoPaidAckExport}
                      className="mt-0.5"
                      onChange={(e) => setUndoPaidAckExport(e.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      A payroll accounting export overlaps this week. I understand the risk and still want to undo
                      paid.
                    </span>
                  </label>
                ) : null}
                <label className="block text-xs font-bold">
                  Reason (required)
                  <textarea
                    className="mt-1 min-h-[4rem] w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-1 text-sm"
                    onChange={(e) => setUndoPaidReason(e.target.value)}
                    placeholder="Explain why paid status is being reversed."
                    value={undoPaidReason}
                  />
                </label>
                <Button
                  disabled={busyId === undoPaidRow.id}
                  onClick={() => void submitUndoPaid()}
                  type="button"
                >
                  {busyId === undoPaidRow.id ? "Working…" : "Confirm undo paid"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
