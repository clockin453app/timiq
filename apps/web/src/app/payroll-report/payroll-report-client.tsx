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
import { listLocations, type Location } from "../../features/locations/api";
import {
  approveAllPending,
  approvePayrollItem,
  createPayrollLateShiftAdjustment,
  downloadPayrollCsv,
  downloadPayrollPdfReport,
  fetchPayrollMonthSummary,
  fetchPayrollPaymentHistory,
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
  type PayrollPaymentHistoryRow,
  type PayrollReportResponse,
} from "../../features/payroll/api";
import {
  effectiveDisplayedTaxAmount,
  formatHoursFromSeconds,
  formatMoneyGBP,
} from "../../features/payroll/format";
import {
  adminPatchCompletedShift,
  listAdminTimeRecords,
  type TimeRecordShiftRow,
} from "../../features/time-records/api";
import { leaveTypeLabel } from "../../features/leave/labels";
import { FaceReferenceAvatar } from "../../features/face-check/face-reference-avatar";
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

type RowActionMenuState = {
  row: PayrollItemRow;
  lateBlock: PayrollLateUnpaidEmployee | null;
};

type PayrollUndoTarget = {
  id: string;
  employee_email: string | null;
  employee_name: string | null;
};

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

function payrollSplitBarPercent(value: string | null | undefined, total: string | null | undefined): number {
  const amount = Number(value ?? 0);
  const gross = Number(total ?? 0);
  if (!Number.isFinite(amount) || !Number.isFinite(gross) || gross <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (amount / gross) * 100));
}

function payrollStatusChipClass(tone: "info" | "warning" | "danger" | "success"): string {
  const base = "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold";
  if (tone === "danger") {
    return `${base} border-red-800/25 bg-red-50 text-red-900`;
  }
  if (tone === "warning") {
    return `${base} border-amber-800/25 bg-amber-50 text-amber-950`;
  }
  if (tone === "success") {
    return `${base} border-emerald-800/25 bg-emerald-50 text-emerald-900`;
  }
  return `${base} border-slate-300 bg-slate-50 text-slate-800`;
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
  user_id?: string | null;
  employee_name: string | null;
  employee_email: string | null;
  className?: string;
  withAvatar?: boolean;
}) {
  const { primary, secondary } = payrollEmployeeDisplayLines(props);
  if (props.withAvatar && props.user_id) {
    return (
      <div className={`flex min-w-0 items-center gap-2 ${props.className ?? ""}`}>
        <FaceReferenceAvatar
          employeeEmail={props.employee_email}
          employeeName={props.employee_name}
          userId={props.user_id}
        />
        <div className="min-w-0">
          <div className="truncate font-medium leading-snug text-[#111827]">{primary}</div>
          {secondary ? (
            <div className="mt-0.5 truncate text-[11px] leading-snug text-[var(--color-text-muted)]">{secondary}</div>
          ) : null}
        </div>
      </div>
    );
  }
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
  const [locations, setLocations] = useState<Location[]>([]);
  const companyScope = useAdministratorCompanyScope(user, companies);
  const [weekStart, setWeekStart] = useState(() =>
    mondayWeekStartIso(new Date(), browserDefaultTimeZone()),
  );
  const [draftEmployeeId, setDraftEmployeeId] = useState("");
  const [appliedEmployeeId, setAppliedEmployeeId] = useState("");
  const [exportDateFrom, setExportDateFrom] = useState(weekStart);
  const [exportDateTo, setExportDateTo] = useState(() => addDaysIsoYmd(weekStart, 6));
  const [report, setReport] = useState<PayrollReportResponse | null>(null);
  const [monthSummary, setMonthSummary] = useState<PayrollMonthSummary | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<PayrollPaymentHistoryRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [monthLoading, setMonthLoading] = useState(false);
  const [paymentHistoryLoading, setPaymentHistoryLoading] = useState(false);
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
  const [undoPaidRow, setUndoPaidRow] = useState<PayrollUndoTarget | null>(null);
  const [undoPaidReason, setUndoPaidReason] = useState("");
  const [undoPaidAckExport, setUndoPaidAckExport] = useState(false);
  const [shiftEditRow, setShiftEditRow] = useState<TimeRecordShiftRow | null>(null);
  const [shiftEditClockInLocal, setShiftEditClockInLocal] = useState("");
  const [shiftEditClockOutLocal, setShiftEditClockOutLocal] = useState("");
  const [shiftEditBreakMinutes, setShiftEditBreakMinutes] = useState("0");
  const [shiftEditLocationId, setShiftEditLocationId] = useState("");
  const [shiftEditReason, setShiftEditReason] = useState("");
  const [shiftEditError, setShiftEditError] = useState("");
  const [shiftEditBusy, setShiftEditBusy] = useState(false);
  const [rowActionMenu, setRowActionMenu] = useState<RowActionMenuState | null>(null);

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
    setExportDateFrom(weekStart);
    setExportDateTo(addDaysIsoYmd(weekStart, 6));
  }, [weekStart]);

  const policyTimeZone = report?.period.timezone_name ?? browserDefaultTimeZone();

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

  const shiftEditLocationOptions = useMemo(() => {
    if (!activeCompanyId) {
      return [];
    }
    return locations
      .filter((location) => location.company_id === activeCompanyId && (location.is_active || location.id === shiftEditRow?.location_id))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [locations, activeCompanyId, shiftEditRow]);

  const closeRowActionMenu = useCallback(() => {
    setRowActionMenu(null);
  }, []);

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
    if (!activeCompanyId) {
      setLocations([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await listLocations(activeCompanyId);
        if (!cancelled) {
          setLocations(list);
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
  }, [activeCompanyId]);

  useEffect(() => {
    editOpenRef.current = editRow !== null || shiftEditRow !== null;
  }, [editRow, shiftEditRow]);

  useEffect(() => {
    if (!rowActionMenu) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeRowActionMenu();
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if ((target as Element | null)?.closest?.("[data-payroll-row-menu]")) {
        return;
      }
      closeRowActionMenu();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [rowActionMenu, closeRowActionMenu]);

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

  async function loadPaymentHistory() {
    if (!activeCompanyId) {
      setPaymentHistory([]);
      return;
    }
    setPaymentHistoryLoading(true);
    try {
      const rows = await fetchPayrollPaymentHistory({
        companyId: activeCompanyId,
        dateFrom: exportDateFrom || undefined,
        dateTo: exportDateTo || undefined,
        employeeUserId: appliedEmployeeId || null,
      });
      setPaymentHistory(rows);
    } catch {
      setPaymentHistory([]);
    } finally {
      setPaymentHistoryLoading(false);
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
    loadPaymentHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId, exportDateFrom, exportDateTo, appliedEmployeeId]);

  useEffect(() => {
    if (!payrollSaveMessage) {
      return;
    }
    const saveMsgTimerId = window.setTimeout(() => setPayrollSaveMessage(""), 5000);
    return () => window.clearTimeout(saveMsgTimerId);
  }, [payrollSaveMessage]);

  function openEdit(row: PayrollItemRow) {
    closeRowActionMenu();
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

  function openRowActionMenu(
    row: PayrollItemRow,
    lateBlock: PayrollLateUnpaidEmployee | null,
  ) {
    setRowActionMenu((prev) => (prev?.row.id === row.id ? null : { row, lateBlock }));
  }

  function openShiftEdit(row: TimeRecordShiftRow) {
    setPayrollSaveMessage("");
    setShiftEditError("");
    setShiftEditRow(row);
    setShiftEditClockInLocal(toDatetimeLocalValue(row.clock_in_at));
    setShiftEditClockOutLocal(row.clock_out_at ? toDatetimeLocalValue(row.clock_out_at) : "");
    setShiftEditBreakMinutes(String(Math.round(row.break_seconds / 60)));
    setShiftEditLocationId(row.location_id);
    setShiftEditReason("");
  }

  function closeShiftEdit() {
    setShiftEditRow(null);
    setShiftEditError("");
    setShiftEditBusy(false);
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

  async function saveShiftEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shiftEditRow) {
      return;
    }
    setShiftEditError("");
    setPayrollSaveMessage("");
    const clockInAt = fromDatetimeLocalToIso(shiftEditClockInLocal);
    const clockOutAt = fromDatetimeLocalToIso(shiftEditClockOutLocal);
    if (!clockInAt || !clockOutAt) {
      setShiftEditError("Clock in and clock out are required.");
      return;
    }
    const breakMinutes = Number(shiftEditBreakMinutes);
    if (Number.isNaN(breakMinutes) || breakMinutes < 0) {
      setShiftEditError("Break minutes must be a non-negative number.");
      return;
    }
    if (!shiftEditReason.trim()) {
      setShiftEditError("Reason is required.");
      return;
    }
    setShiftEditBusy(true);
    setBusyId(shiftEditRow.shift_id);
    try {
      await adminPatchCompletedShift(shiftEditRow.shift_id, {
        clock_in_at: clockInAt,
        clock_out_at: clockOutAt,
        location_id: shiftEditLocationId !== shiftEditRow.location_id ? shiftEditLocationId : undefined,
        break_minutes: breakMinutes,
        reason: shiftEditReason.trim(),
      });
      const userId = shiftEditRow.user_id;
      closeShiftEdit();
      await reloadShiftRows(userId);
      await loadReport();
      setPayrollSaveMessage("Shift updated. Payroll needs recalculation.");
    } catch (err) {
      setShiftEditError(err instanceof Error ? err.message : "Could not update shift.");
    } finally {
      setShiftEditBusy(false);
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
    if (payrollNeedsRecalculation) {
      setError(t("payroll.report.recalc_before_approval", "Payroll needs recalculation before approval."));
      return;
    }
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
      if (action === "paid") {
        await loadPaymentHistory();
      }
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
      await loadPaymentHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("payroll.report.undo_paid_failed", "Undo paid failed."));
    } finally {
      setBusyId(null);
    }
  }

  function selectedExportRange(): { dateFrom: string; dateTo: string } | null {
    const dateFrom = exportDateFrom || weekStart;
    const dateTo = exportDateTo || addDaysIsoYmd(weekStart, 6);
    if (!dateFrom || !dateTo) {
      setError(t("payroll.report.range_required", "Date from and date to are required for exports."));
      return null;
    }
    if (dateFrom > dateTo) {
      setError(t("payroll.report.invalid_range", "Date from must be before or equal to date to."));
      return null;
    }
    return { dateFrom, dateTo };
  }

  async function handleCsv() {
    if (!activeCompanyId) {
      return;
    }
    const range = selectedExportRange();
    if (!range) {
      return;
    }
    try {
      setError("");
      await downloadPayrollCsv({
        companyId: activeCompanyId,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        employeeUserId: draftEmployeeId || null,
      });
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
    const range = selectedExportRange();
    if (!range) {
      return;
    }
    try {
      setError("");
      await downloadPayrollPdfReport({
        companyId: activeCompanyId,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        employeeUserId: draftEmployeeId || null,
      });
    } catch {
      setError(
        t("payroll.report.pdf_export_failed", "Could not download payroll PDF report."),
      );
    }
  }

  function applyEmployeeFilter() {
    setAppliedEmployeeId(draftEmployeeId);
  }

  async function reloadShiftRows(userId: string) {
    if (!activeCompanyId) {
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
    await reloadShiftRows(userId);
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
  const chipGroups = useMemo(() => {
    const chips: Array<{ label: string; tone: "info" | "warning" | "danger" | "success" }> = [];
    if (hasCompany && payrollPeriodNotCalculated) {
      chips.push({ label: "Pending calculation", tone: "warning" });
    }
    if (hasCompany && payrollNeedsRecalculation) {
      chips.push({ label: "Needs recalculation", tone: "warning" });
    }
    if (hasCompany && paidRowCount > 0) {
      chips.push({ label: `Paid rows locked: ${paidRowCount}`, tone: "danger" });
    }
    const missingRateCount = alerts?.rate_missing_employees_count ?? 0;
    if (hasCompany && missingRateCount > 0) {
      chips.push({ label: `Missing hourly rate: ${missingRateCount}`, tone: "danger" });
    }
    const missingSetupCount = alerts?.missing_payroll_setup_employees_count ?? 0;
    if (hasCompany && missingSetupCount > 0) {
      chips.push({ label: `Missing payroll/CIS setup: ${missingSetupCount}`, tone: "danger" });
    }
    const openShiftCount = alerts?.open_shifts_started_in_week_count ?? 0;
    if (hasCompany && openShiftCount > 0) {
      chips.push({ label: `Open shifts: ${openShiftCount}`, tone: "warning" });
    }
    const zeroHoursCount = alerts?.zero_rounded_hours_employees_count ?? 0;
    if (hasCompany && zeroHoursCount > 0) {
      chips.push({ label: `Zero-hour employees: ${zeroHoursCount}`, tone: "info" });
    }
    return { attention: chips };
  }, [
    alerts?.missing_payroll_setup_employees_count,
    alerts?.open_shifts_started_in_week_count,
    alerts?.rate_missing_employees_count,
    alerts?.zero_rounded_hours_employees_count,
    hasCompany,
    paidRowCount,
    payrollNeedsRecalculation,
    payrollPeriodNotCalculated,
  ]);

  return (
    <Sheet>
      <PageHeader
        action={
          chipGroups.attention.length > 0 ? (
            <div
              aria-label="Payroll alerts"
              className="flex max-w-full flex-wrap justify-end gap-1.5 sm:max-w-[34rem]"
            >
              {chipGroups.attention.map((chip) => (
                <span className={payrollStatusChipClass(chip.tone)} key={chip.label}>
                  {chip.label}
                </span>
              ))}
            </div>
          ) : undefined
        }
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

            <div className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-end">
              <div className="min-w-0 flex-1 xl:min-w-[19rem]">
                <WeekPickerBar
                  disabled={loading}
                  onWeekChange={setWeekStart}
                  payrollTimeZone={policyTimeZone}
                  timezoneLabel={period?.timezone_name}
                  weekStartIso={weekStart}
                />
              </div>
              <label className="block text-xs font-bold text-[#111827] xl:w-36">
                {t("payroll.report.date_from", "Date from")}
                <input
                  className="mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-3 text-sm font-medium text-[#111827]"
                  onChange={(event) => setExportDateFrom(event.target.value)}
                  type="date"
                  value={exportDateFrom}
                />
              </label>
              <label className="block text-xs font-bold text-[#111827] xl:w-36">
                {t("payroll.report.date_to", "Date to")}
                <input
                  className="mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-3 text-sm font-medium text-[#111827]"
                  onChange={(event) => setExportDateTo(event.target.value)}
                  type="date"
                  value={exportDateTo}
                />
              </label>
              <label className="block w-full min-w-0 text-xs font-bold text-[#111827] sm:min-w-[12rem] xl:w-56">
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
            <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
              {t(
                "payroll.report.range_export_help",
                "Recalculate and approval apply to the selected payroll week. PDF/CSV downloads use the selected date range and employee filter.",
              )}
            </p>

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
                <Button disabled={loading || !activeCompanyId || payrollNeedsRecalculation} onClick={runApproveAll} type="button">
                  {t("payroll.report.approve_all_pending", "Approve all pending")}
                </Button>
                <Button disabled={loading || !activeCompanyId} onClick={handleCsv} type="button" variant="secondary">
                  {t("payroll.report.export_csv", "Export payroll CSV")}
                </Button>
                <Button
                  disabled={loading || !activeCompanyId}
                  onClick={handlePrint}
                  type="button"
                  variant="secondary"
                >
                  {t("payroll.report.print_report", "Print")}
                </Button>
                <Button
                  disabled={loading || !activeCompanyId}
                  onClick={handlePdfDownload}
                  type="button"
                  variant="secondary"
                >
                  {t("payroll.report.export_pdf", "Download payroll PDF")}
                </Button>
              </div>
              {paidRowCount > 0 ? (
                <p className="mt-2 text-xs font-medium text-slate-700">
                  Payroll locked — paid rows cannot be rebuilt.
                </p>
              ) : null}
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

        <div className="space-y-5">
          <div className="min-w-0 w-full space-y-5">
            <div className="w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3 shadow-sm">
              <p className="mb-1 text-sm font-semibold text-[#111827]">Weekly payroll review</p>
              <p className="mb-3 text-xs text-[var(--color-text-muted)]">
                Summary by employee for this payroll week. Use + to view shift lines for this employee.
              </p>
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
                                aria-label="View shift details"
                                className="min-h-8 px-1 py-0 text-xs"
                                onClick={() => toggleExpandShifts(row.user_id)}
                                title="View shift details"
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
                                user_id={row.user_id}
                                withAvatar
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
                              <div className="flex flex-nowrap gap-1">
                                {row.status === "pending" ? (
                                  <Button
                                    className="min-h-8 px-2 py-1 text-xs"
                                    disabled={busyId === row.id || payrollNeedsRecalculation}
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
                                <span className="relative inline-block" data-payroll-row-menu>
                                  <Button
                                    aria-controls={`payroll-row-actions-${row.id}`}
                                    aria-expanded={rowActionMenu?.row.id === row.id}
                                    aria-haspopup="menu"
                                    aria-label={t("payroll.report.row_more_actions", "More payroll row actions")}
                                    className="min-h-8 px-2 py-1 text-xs"
                                    disabled={busyId === row.id}
                                    onClick={() => openRowActionMenu(row, lateBlock)}
                                    title={t("payroll.report.row_more_actions", "More payroll row actions")}
                                    type="button"
                                    variant="secondary"
                                  >
                                    ⋯
                                  </Button>
                                  {rowActionMenu?.row.id === row.id ? (
                                    <div
                                      className="absolute right-0 top-full z-[80] mt-1 min-w-[13.75rem] rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] py-1 shadow-[0_10px_28px_rgba(15,23,42,0.16)]"
                                      id={`payroll-row-actions-${row.id}`}
                                      role="menu"
                                    >
                                      <button
                                        className="block w-full px-3 py-2 text-left text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-header)]"
                                        onClick={() => {
                                          openEdit(rowActionMenu.row);
                                        }}
                                        role="menuitem"
                                        type="button"
                                      >
                                        {t("payroll.report.payroll_adjustments", "Payroll adjustments")}
                                      </button>
                                      {rowActionMenu.row.status === "paid" ? (
                                        <>
                                          <button
                                            className="block w-full px-3 py-2 text-left text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-header)]"
                                            onClick={() => {
                                              const itemId = rowActionMenu.row.id;
                                              closeRowActionMenu();
                                              openPayrollItemPayslip(itemId);
                                            }}
                                            role="menuitem"
                                            type="button"
                                          >
                                            {t("payroll.report.payslip", "Payslip")}
                                          </button>
                                          <button
                                            className="block w-full px-3 py-2 text-left text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-header)]"
                                            onClick={() => {
                                              setUndoPaidRow(rowActionMenu.row);
                                              setUndoPaidReason("");
                                              setUndoPaidAckExport(false);
                                              closeRowActionMenu();
                                            }}
                                            role="menuitem"
                                            type="button"
                                          >
                                            {t("payroll.report.undo_paid", "Undo paid")}
                                          </button>
                                          {canShowLateAdjustmentForPaidRow(rowActionMenu.row, rowActionMenu.lateBlock, report) ? (
                                            <button
                                              className="block w-full px-3 py-2 text-left text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-header)]"
                                              onClick={() => {
                                                const itemId = rowActionMenu.row.id;
                                                closeRowActionMenu();
                                                void runCreateLateAdjustment(itemId);
                                              }}
                                              role="menuitem"
                                              type="button"
                                            >
                                              {t("payroll.report.adjustment", "Adjustment")}
                                            </button>
                                          ) : null}
                                        </>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </span>
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
                                    Shift times come from Time Records. Editing a completed shift marks payroll as
                                    needing recalculation.
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
                                          <th className="py-1 pr-2">Action</th>
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
                                                <td className="py-1 pr-2">
                                                  {!isOpen ? (
                                                    <Button
                                                      className="min-h-7 px-2 py-0.5 text-[11px]"
                                                      disabled={busyId === s.shift_id}
                                                      onClick={() => openShiftEdit(s)}
                                                      type="button"
                                                      variant="secondary"
                                                    >
                                                      Edit shift
                                                    </Button>
                                                  ) : (
                                                    <span className="text-[var(--color-text-muted)]">—</span>
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

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
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
              <div className="border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3 text-sm shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[#4b5563]">Employees</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-[#111827]">
                  {showMetricFigures ? period?.total_items : "—"}
                </p>
              </div>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-[#111827]">Payment history</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    Paid payroll rows only. Uses the selected date range and employee filter.
                  </p>
                </div>
                <Button
                  disabled={!activeCompanyId || paymentHistoryLoading}
                  onClick={() => void loadPaymentHistory()}
                  type="button"
                  variant="secondary"
                >
                  {paymentHistoryLoading ? "Loading…" : "Refresh history"}
                </Button>
              </div>
              <div className="mt-3 timiq-scroll-x w-full min-w-0">
                <table className="w-full min-w-[58rem] border-collapse text-left text-xs">
                  <thead className="bg-[#d4d4d8] text-[#111827]">
                    <tr>
                      <th className="border border-[var(--color-border-dark)] px-2 py-1.5">Paid date</th>
                      <th className="border border-[var(--color-border-dark)] px-2 py-1.5">Payroll week</th>
                      <th className="border border-[var(--color-border-dark)] px-2 py-1.5">Employee</th>
                      <th className="border border-[var(--color-border-dark)] px-2 py-1.5">Gross</th>
                      <th className="border border-[var(--color-border-dark)] px-2 py-1.5">CIS</th>
                      <th className="border border-[var(--color-border-dark)] px-2 py-1.5">Net paid</th>
                      <th className="border border-[var(--color-border-dark)] px-2 py-1.5">Payment mode</th>
                      <th className="border border-[var(--color-border-dark)] px-2 py-1.5">Status</th>
                      <th className="border border-[var(--color-border-dark)] px-2 py-1.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!hasCompany ? (
                      <tr>
                        <td className="border border-[var(--color-border)] px-2 py-6 text-center text-[#374151]" colSpan={9}>
                          Select a company to load payment history.
                        </td>
                      </tr>
                    ) : null}
                    {hasCompany && paymentHistoryLoading ? (
                      <tr>
                        <td className="border border-[var(--color-border)] px-2 py-6 text-center text-[var(--color-text-muted)]" colSpan={9}>
                          Loading payment history…
                        </td>
                      </tr>
                    ) : null}
                    {hasCompany && !paymentHistoryLoading && paymentHistory.length === 0 ? (
                      <tr>
                        <td className="border border-[var(--color-border)] px-2 py-6 text-center text-[#374151]" colSpan={9}>
                          No paid payroll rows match the selected filters.
                        </td>
                      </tr>
                    ) : null}
                    {hasCompany && !paymentHistoryLoading
                      ? paymentHistory.map((row) => (
                          <tr className="border-b border-[var(--color-border)]" key={row.item_id}>
                            <td className="border border-[var(--color-border)] px-2 py-1.5 tabular-nums">
                              {formatShiftDateTime(row.paid_at, policyTimeZone)}
                            </td>
                            <td className="border border-[var(--color-border)] px-2 py-1.5 tabular-nums">
                              {row.week_start} → {row.week_end}
                            </td>
                            <td className="border border-[var(--color-border)] px-2 py-1.5">
                              <PayrollEmployeeIdentity
                                employee_email={row.employee_email}
                                employee_name={row.employee_name}
                                user_id={row.user_id}
                                withAvatar
                              />
                            </td>
                            <td className="border border-[var(--color-border)] px-2 py-1.5">
                              {formatMoneyGBP(row.gross_amount)}
                            </td>
                            <td className="border border-[var(--color-border)] px-2 py-1.5">
                              {formatMoneyGBP(row.cis_tax_amount)}
                            </td>
                            <td className="border border-[var(--color-border)] px-2 py-1.5">
                              {formatMoneyGBP(row.net_paid_amount)}
                            </td>
                            <td className="border border-[var(--color-border)] px-2 py-1.5">
                              {row.payment_mode_label}
                            </td>
                            <td className="border border-[var(--color-border)] px-2 py-1.5">
                              <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadgeClass(row.status)}`}>
                                {statusBadgeLabel(t, row.status)}
                              </span>
                            </td>
                            <td className="border border-[var(--color-border)] px-2 py-1.5">
                              <div className="flex flex-wrap gap-1">
                                {row.can_open_payslip ? (
                                  <Button
                                    className="min-h-8 px-2 py-1 text-xs"
                                    onClick={() => openPayrollItemPayslip(row.item_id)}
                                    type="button"
                                    variant="secondary"
                                  >
                                    Payslip
                                  </Button>
                                ) : null}
                                {row.can_undo_paid ? (
                                  <Button
                                    className="min-h-8 px-2 py-1 text-xs"
                                    disabled={busyId === row.item_id}
                                    onClick={() => {
                                      setUndoPaidRow({
                                        id: row.item_id,
                                        employee_email: row.employee_email,
                                        employee_name: row.employee_name,
                                      });
                                      setUndoPaidReason("");
                                      setUndoPaidAckExport(false);
                                    }}
                                    type="button"
                                    variant="secondary"
                                  >
                                    Undo paid
                                  </Button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))
                      : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">
                Supporting details
              </p>
              <div className="mt-3 grid gap-3 xl:grid-cols-2">
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-3">
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
                    <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
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

                {report ? (
                  <div className="rounded-[var(--radius-md)] border border-slate-200 bg-slate-50/90 px-3 py-2.5 text-xs text-slate-900">
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

                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-sheet)] p-3 text-sm">
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

                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-sheet)] p-3 text-sm">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">
                    Payroll split (pre-tax wages)
                  </p>
                  {!hasCompany ? <p className="mt-2 text-xs text-[var(--color-text-muted)]">—</p> : null}
                  {hasCompany && split ? (
                    <div className="mt-3 space-y-3 text-xs">
                      {[
                        { label: "Regular wages", value: split.regular_pay, tone: "bg-slate-700" },
                        { label: "Overtime wages", value: split.overtime_pay, tone: "bg-slate-500" },
                        { label: "Other pay", value: split.other_pay, tone: "bg-slate-400" },
                        { label: "Total gross (payroll)", value: split.total_gross, tone: "bg-[var(--color-accent)]" },
                      ].map((row) => (
                        <div key={row.label}>
                          <div className="flex justify-between gap-2 text-[var(--color-text)]">
                            <span className="text-[var(--color-text-muted)]">{row.label}</span>
                            <span className="font-semibold tabular-nums">{formatMoneyGBP(row.value)}</span>
                          </div>
                          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`h-2 rounded-full ${row.tone}`}
                              style={{ width: `${payrollSplitBarPercent(row.value, split.total_gross)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                      <p className="border-t border-[var(--color-border)] pt-2 text-[10px] leading-snug text-[var(--color-text-muted)]">
                        Regular and overtime lines are derived from stored hours and rate snapshots; total
                        gross matches summed payroll item gross.
                      </p>
                    </div>
                  ) : null}
                  {hasCompany && !split ? (
                    <p className="mt-2 text-xs text-[var(--color-text-muted)]">Load payroll to view split.</p>
                  ) : null}
                </div>
              </div>
            </div>

          </div>

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
                  {editRow.status === "paid" ? "Payroll adjustments (paid row notes only)" : "Payroll adjustments"}
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
                  <p className="mt-2 rounded border border-slate-300 bg-slate-50 px-2 py-1.5 text-[11px] font-medium text-slate-900">
                    This modal edits payroll notes, deductions, payment mode, and display fields only. To change
                    hours, expand the employee row and use Edit shift.
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

        {shiftEditRow ? (
          <div
            aria-modal="true"
            className="fixed inset-0 z-[2100] flex items-start justify-center overflow-x-hidden overflow-y-auto bg-black/45 p-3 md:p-6"
            role="dialog"
          >
            <div className="timiq-sheet mx-auto my-4 w-full min-w-0 max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-4 shadow-md sm:max-w-[min(42rem,calc(100vw-3rem))]">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-border-dark)] pb-3">
                <div>
                  <p className="text-sm font-bold text-[var(--color-text)]">Edit shift</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    Saves through Time Records and marks payroll as needing recalculation.
                  </p>
                </div>
                <Button onClick={closeShiftEdit} type="button">
                  Close
                </Button>
              </div>
              <form className="mt-4 space-y-2 text-sm" onSubmit={saveShiftEdit}>
                {shiftEditError ? (
                  <p className="rounded border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-2 py-1 text-xs text-[var(--color-danger-700)]">
                    {shiftEditError}
                  </p>
                ) : null}
                <div className="rounded border border-[var(--color-border-dark)] bg-[var(--color-header)] px-2 py-1.5 text-xs text-[var(--color-text-muted)]">
                  <p>
                    Employee:{" "}
                    <span className="font-medium text-[var(--color-text)]">
                      {shiftEditRow.employee_name ?? shiftEditRow.employee_email ?? shiftEditRow.user_id}
                    </span>
                  </p>
                  <p className="mt-1">
                    Current rounded hours:{" "}
                    <span className="font-medium text-[var(--color-text)]">
                      {shiftEditRow.rounded_seconds != null ? formatHoursFromSeconds(shiftEditRow.rounded_seconds) : "—"}
                    </span>
                  </p>
                </div>
                <label className="block text-xs font-bold">
                  Location
                  <select
                    className="timiq-select mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setShiftEditLocationId(event.target.value)}
                    value={shiftEditLocationId}
                  >
                    {shiftEditLocationOptions.length === 0 ? (
                      <option value={shiftEditRow.location_id}>{shiftEditRow.location_name}</option>
                    ) : (
                      shiftEditLocationOptions.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))
                    )}
                  </select>
                </label>
                <label className="block text-xs font-bold">
                  Clock in
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setShiftEditClockInLocal(event.target.value)}
                    required
                    type="datetime-local"
                    value={shiftEditClockInLocal}
                  />
                </label>
                <label className="block text-xs font-bold">
                  Clock out
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setShiftEditClockOutLocal(event.target.value)}
                    required
                    type="datetime-local"
                    value={shiftEditClockOutLocal}
                  />
                </label>
                <label className="block text-xs font-bold">
                  Break minutes
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    inputMode="numeric"
                    min={0}
                    onChange={(event) => setShiftEditBreakMinutes(event.target.value)}
                    type="number"
                    value={shiftEditBreakMinutes}
                  />
                </label>
                <label className="block text-xs font-bold">
                  Reason
                  <textarea
                    className="mt-1 min-h-[4rem] w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-1 text-sm"
                    onChange={(event) => setShiftEditReason(event.target.value)}
                    required
                    value={shiftEditReason}
                  />
                </label>
                <Button disabled={shiftEditBusy} type="submit">
                  {shiftEditBusy ? "Saving…" : "Save shift"}
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
