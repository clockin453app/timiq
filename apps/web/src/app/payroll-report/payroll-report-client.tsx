"use client";

import Link from "next/link";
import { FormEvent, Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileDown, FileSpreadsheet, FileText, Printer } from "lucide-react";

import { usePageLocationAction } from "../../components/layout/page-location-action-context";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  PageHeader,
  PaymentBadge,
  SectionCard,
  Sheet,
  SheetBody,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui";
import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";
import { isAdministrator, listManagedUsers, useCurrentUser, type AuthUser } from "../../features/auth";
import { listCompanies, type Company } from "../../features/companies/api";
import { useAdministratorCompanyScope } from "../../features/companies/selected-company";
import { listLocations, type Location } from "../../features/locations/api";
import {
  approveAllPending,
  approvePayrollItem,
  createPayrollLateShiftAdjustment,
  downloadPayrollCsv,
  downloadPayrollExcelReport,
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
import { formatPayrollWeekUkLabel } from "../../lib/week-label";

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
  anchor: HTMLButtonElement;
};

type PayrollUndoTarget = {
  id: string;
  employee_email: string | null;
  employee_name: string | null;
};

type FloatingMenuPosition = {
  top: number;
  left: number;
};

function computeFloatingRowMenuPosition(anchor: HTMLElement, menu: HTMLElement): FloatingMenuPosition {
  const rect = anchor.getBoundingClientRect();
  const viewportPad = 8;
  const menuRect = menu.getBoundingClientRect();
  const menuWidth = menuRect.width;
  const menuHeight = menuRect.height;
  let left = rect.right - menuWidth;
  if (left < viewportPad) {
    left = viewportPad;
  }
  if (left + menuWidth > window.innerWidth - viewportPad) {
    left = Math.max(viewportPad, window.innerWidth - menuWidth - viewportPad);
  }
  const belowTop = rect.bottom + 4;
  const aboveTop = rect.top - menuHeight - 4;
  let top = belowTop;
  if (belowTop + menuHeight > window.innerHeight - viewportPad && aboveTop >= viewportPad) {
    top = aboveTop;
  }
  if (top + menuHeight > window.innerHeight - viewportPad) {
    top = Math.max(viewportPad, window.innerHeight - menuHeight - viewportPad);
  }
  return { top, left };
}

function payrollSplitBarPercent(value: string | null | undefined, total: string | null | undefined): number {
  const amount = Number(value ?? 0);
  const gross = Number(total ?? 0);
  if (!Number.isFinite(amount) || !Number.isFinite(gross) || gross <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (amount / gross) * 100));
}

function PayrollStatCard(props: { label: string; value: string; emphasize?: boolean }) {
  return (
    <Card padded>
      <p className={uiClasses.payeStatLabel}>{props.label}</p>
      <p className={props.emphasize ? uiClasses.payeStatValueLg : uiClasses.payeStatValue}>{props.value}</p>
    </Card>
  );
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

function storedPaymentMode(value: string | null | undefined): "net_payment" | "gross_payment" | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (raw === "gross_payment" || raw === "gross") {
    return "gross_payment";
  }
  if (raw === "net_payment" || raw === "net") {
    return "net_payment";
  }
  return null;
}

const payrollCompactFilterLabel =
  "timiq-label block text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]";
const payrollCompactFilterInput =
  "timiq-input h-8 w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm text-[var(--color-text)]";
const payrollCompactFilterSelect =
  "timiq-select h-8 w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm text-[var(--color-text)]";
const payrollToolbarField = "flex min-w-0 flex-col gap-0.5";
const payrollTableCell = "align-top px-3 py-3 text-[0.9375rem] leading-snug";
const payrollTableHead =
  "border-r border-[var(--color-payroll-table-header-border)] px-3 py-3 text-sm font-bold normal-case tracking-normal text-[var(--color-payroll-table-header-fg)] last:border-r-0";
const payrollTableMoney = "timiq-money tabular-nums text-[0.9375rem]";
const payrollRowActionBtn = cn("min-h-9 px-2.5 py-1.5 text-sm", uiClasses.focusRing);
const payrollExpandBtn = cn(
  "min-h-8 w-8 shrink-0 px-0 text-xs font-semibold tabular-nums",
  uiClasses.focusRing,
);
const payrollModalBackdrop =
  "fixed inset-0 z-[2100] flex items-start justify-center overflow-x-hidden overflow-y-auto bg-black/45 p-3 md:p-6";
const payrollModalPanel = cn(
  uiClasses.card,
  "mx-auto my-4 w-full min-w-0 max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto sm:max-w-[min(42rem,calc(100vw-3rem))]",
);
const payrollModalHeader =
  "flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3";
const payrollModalBody = "space-y-3 px-4 py-4 text-sm";
const payrollModalFooter =
  "flex flex-wrap justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3";
const payrollMenuPanel = cn(
  "min-w-[14rem] rounded-[var(--radius-lg)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] py-1.5 shadow-[var(--shadow-dropdown)]",
);
const payrollMenuItem = cn(
  "block w-full px-3 py-2.5 text-left text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-header)]",
  uiClasses.focusRing,
);
const payrollMenuItemDanger = cn(
  "block w-full px-3 py-2.5 text-left text-sm font-medium text-[var(--color-danger-700)] hover:bg-[var(--color-danger-50)]",
  uiClasses.focusRing,
);

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
  linked?: boolean;
  withAvatar?: boolean;
  nameClassName?: string;
  emailClassName?: string;
}) {
  const { primary, secondary } = payrollEmployeeDisplayLines(props);
  const nameClass =
    props.nameClassName ?? "text-[13px] font-medium leading-snug text-[#111827]";
  const emailClass =
    props.emailClassName ?? "mt-0.5 text-xs leading-snug text-[var(--color-text-muted)]";
  const avatarNameClass =
    props.nameClassName ?? "truncate text-[13px] font-medium leading-snug text-[#111827]";
  const avatarEmailClass =
    props.emailClassName ?? "mt-0.5 truncate text-xs leading-snug text-[var(--color-text-muted)]";
  const content =
    props.withAvatar && props.user_id ? (
      <div className={`flex min-w-0 items-center gap-2 ${props.className ?? ""}`}>
        <FaceReferenceAvatar
          employeeEmail={props.employee_email}
          employeeName={props.employee_name}
          userId={props.user_id}
        />
        <div className="min-w-0">
          <div className={avatarNameClass}>{primary}</div>
          {secondary ? (
            <div className={avatarEmailClass}>{secondary}</div>
          ) : null}
        </div>
      </div>
    ) : (
      <div className={props.className}>
        <div className={nameClass}>{primary}</div>
        {secondary ? (
          <div className={emailClass}>{secondary}</div>
        ) : null}
      </div>
    );

  if (props.linked && props.user_id) {
    return (
      <Link
        aria-label={`Open employee profile for ${primary}`}
        className="block rounded-sm hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-border-dark)]"
        href={`/employees?employeeId=${encodeURIComponent(props.user_id)}`}
        title={`Open employee profile for ${primary}`}
      >
        {content}
      </Link>
    );
  }

  return content;
}

function PayrollRowActionsPortal(props: {
  state: RowActionMenuState | null;
  report: PayrollReportResponse | null;
  onClose: () => void;
  onEdit: (row: PayrollItemRow) => void;
  onOpenPayslip: (itemId: string) => void;
  onUndoPaid: (row: PayrollItemRow) => void;
  onLateAdjustment: (itemId: string) => void;
  t: (key: string, fallback?: string) => string;
}) {
  const [position, setPosition] = useState<FloatingMenuPosition | null>(null);
  const [mounted, setMounted] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!props.state) {
      setPosition(null);
      return;
    }
    const anchor = props.state.anchor;
    const update = () => {
      const menu = menuRef.current;
      if (!menu) {
        return;
      }
      setPosition(computeFloatingRowMenuPosition(anchor, menu));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [props.state]);

  if (!props.state || !mounted) {
    return null;
  }

  const { row, lateBlock } = props.state;

  return createPortal(
    <div
      className={payrollMenuPanel}
      data-payroll-row-menu
      id={`payroll-row-actions-${row.id}`}
      ref={menuRef}
      role="menu"
      style={{
        position: "fixed",
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        maxWidth: "min(20rem, calc(100vw - 1rem))",
        overflowY: "auto",
        visibility: position ? "visible" : "hidden",
        zIndex: 1000,
      }}
    >
      <button
        className={payrollMenuItem}
        onClick={() => props.onEdit(row)}
        role="menuitem"
        type="button"
      >
        {props.t("payroll.report.payroll_adjustments", "Payroll adjustments")}
      </button>
      {row.status === "paid" ? (
        <>
          <button
            className={payrollMenuItem}
            onClick={() => {
              props.onClose();
              props.onOpenPayslip(row.id);
            }}
            role="menuitem"
            type="button"
          >
            {props.t("payroll.report.payslip", "Payslip")}
          </button>
          <button
            className={payrollMenuItemDanger}
            onClick={() => props.onUndoPaid(row)}
            role="menuitem"
            type="button"
          >
            {props.t("payroll.report.undo_paid", "Undo paid")}
          </button>
          {canShowLateAdjustmentForPaidRow(row, lateBlock, props.report) ? (
            <button
              className={payrollMenuItem}
              onClick={() => {
                props.onClose();
                props.onLateAdjustment(row.id);
              }}
              role="menuitem"
              type="button"
            >
              {props.t("payroll.report.adjustment", "Adjustment")}
            </button>
          ) : null}
        </>
      ) : null}
    </div>,
    document.body,
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
  const [payrollSaveMessageTone, setPayrollSaveMessageTone] = useState<"success" | "warning">("success");
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
    setPayrollSaveMessageTone("success");
  }, [activeCompanyId]);

  useEffect(() => {
    setPayrollSaveMessage("");
    setPayrollSaveMessageTone("success");
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
        setPayrollSaveMessageTone("success");
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
        weekStart,
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
  }, [activeCompanyId, weekStart, appliedEmployeeId]);

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
    setPayrollSaveMessageTone("success");
    setEditRow(row);
    setEditNotes(row.notes ?? "");
    setEditOtherDed(row.other_deductions_amount ?? "0");
    setEditDispTax(
      effectiveDisplayedTaxAmount(row.display_tax_amount, row.tax_amount, row.payment_mode) ?? "",
    );
    setEditDispNet(row.display_net_amount ?? row.net_amount ?? "");
    setEditPaymentMode(normalizePaymentMode(row.payment_mode));
  }

  function openUndoPaidFromMenu(row: PayrollItemRow) {
    setUndoPaidRow(row);
    setUndoPaidReason("");
    setUndoPaidAckExport(false);
    closeRowActionMenu();
  }

  function openRowActionMenu(
    row: PayrollItemRow,
    lateBlock: PayrollLateUnpaidEmployee | null,
    anchor: HTMLButtonElement,
  ) {
    setRowActionMenu((prev) => (prev?.row.id === row.id ? null : { row, lateBlock, anchor }));
  }

  function openShiftEdit(row: TimeRecordShiftRow) {
    setPayrollSaveMessage("");
    setPayrollSaveMessageTone("success");
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
      setPayrollSaveMessageTone("success");
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
    setPayrollSaveMessageTone("success");
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
      const res = await adminPatchCompletedShift(shiftEditRow.shift_id, {
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
      if (res.payroll_recalculation_required) {
        setPayrollSaveMessageTone("warning");
        setPayrollSaveMessage(
          t(
            "payroll.report.shift_saved_needs_recalc",
            "Shift time saved. Payroll was not updated automatically. Recalculate to refresh pending amounts.",
          ),
        );
      } else {
        setPayrollSaveMessageTone("success");
        setPayrollSaveMessage(t("payroll.report.shift_saved", "Shift time saved."));
      }
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
      setPayrollSaveMessageTone("success");
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
      setPayrollSaveMessageTone("success");
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
      setPayrollSaveMessageTone("success");
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

  async function handleExcelDownload() {
    if (!activeCompanyId) {
      return;
    }
    const range = selectedExportRange();
    if (!range) {
      return;
    }
    try {
      setError("");
      await downloadPayrollExcelReport({
        companyId: activeCompanyId,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        employeeUserId: draftEmployeeId || null,
      });
    } catch {
      setError(t("payroll.report.xlsx_export_failed", "Could not download payroll Excel report."));
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
  const payrollRecalcBlocked =
    payrollNeedsRecalculation && (approvedRowCount > 0 || paidRowCount > 0);
  const payrollReviewRecalcStatus = useMemo(() => {
    if (!hasCompany || !report) {
      return null;
    }
    if (payrollPeriodNotCalculated) {
      return {
        badgeTone: "warning" as const,
        badgeLabel: t("payroll.report.recalc_status_pending", "Not calculated"),
        message: t(
          "payroll.report.recalc_status_not_calculated",
          "Payroll not calculated for this week yet.",
        ),
      };
    }
    if (payrollNeedsRecalculation) {
      return {
        badgeTone: "warning" as const,
        badgeLabel: t("payroll.report.recalc_status_stale", "Needs recalculation"),
        message: t(
          "payroll.report.recalc_status_stale_body",
          "Needs recalculation — time records changed after payroll was calculated.",
        ),
      };
    }
    return {
      badgeTone: "success" as const,
      badgeLabel: t("payroll.report.recalc_status_current", "Up to date"),
      message: t(
        "payroll.report.recalc_status_current_body",
        "Payroll up to date — no recalculation needed.",
      ),
    };
  }, [hasCompany, payrollNeedsRecalculation, payrollPeriodNotCalculated, report, t]);
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
    const missingUtrCount = alerts?.utr_missing_employees_count ?? 0;
    if (hasCompany && missingUtrCount > 0) {
      chips.push({ label: `UTR missing: ${missingUtrCount}`, tone: "warning" });
    }
    const missingNinoCount = alerts?.nino_missing_employees_count ?? 0;
    if (hasCompany && missingNinoCount > 0) {
      chips.push({ label: `NiNo missing: ${missingNinoCount}`, tone: "warning" });
    }
    const openShiftCount = alerts?.open_shifts_started_in_week_count ?? 0;
    if (hasCompany && openShiftCount > 0) {
      chips.push({ label: `Open shifts: ${openShiftCount}`, tone: "warning" });
    }
    const zeroHoursCount = alerts?.zero_rounded_hours_employees_count ?? 0;
    if (hasCompany && zeroHoursCount > 0) {
      chips.push({ label: `Zero-hour employees: ${zeroHoursCount}`, tone: "info" });
    }
    const pendingApprovalCount = alerts?.pending_approval_count ?? 0;
    if (hasCompany && pendingApprovalCount > 0) {
      chips.push({ label: `Pending approval: ${pendingApprovalCount}`, tone: "warning" });
    }
    return { attention: chips };
  }, [
    alerts?.pending_approval_count,
    alerts?.missing_payroll_setup_employees_count,
    alerts?.nino_missing_employees_count,
    alerts?.open_shifts_started_in_week_count,
    alerts?.rate_missing_employees_count,
    alerts?.utr_missing_employees_count,
    alerts?.zero_rounded_hours_employees_count,
    hasCompany,
    paidRowCount,
    payrollNeedsRecalculation,
    payrollPeriodNotCalculated,
  ]);
  const setPageLocationAction = usePageLocationAction();
  const payrollAlertChips = useMemo(() => {
    if (chipGroups.attention.length === 0) {
      return null;
    }
    return (
      <div className="flex max-w-full flex-wrap items-center justify-end gap-1.5">
        {chipGroups.attention.map((chip) => (
          <Badge key={chip.label} tone={chip.tone}>
            {chip.label}
          </Badge>
        ))}
      </div>
    );
  }, [chipGroups.attention]);

  useEffect(() => {
    if (!payrollAlertChips) {
      return undefined;
    }
    return setPageLocationAction(payrollAlertChips);
  }, [payrollAlertChips, setPageLocationAction]);

  return (
    <Sheet>
      <PageHeader
        title={t("payroll.report.title", "CIS Payroll Report")}
        description={t(
          "payroll.report.subtitle",
          "Weekly payroll, approvals, and exports. Week is defined by the company time policy timezone.",
        )}
      />
      <SheetBody className="min-w-0 space-y-4">
        <AlertBanner className="py-2 text-sm" tone="info">
          {t(
            "payroll.report.cis_scope_note",
            "This CIS report includes CIS subcontractors only. PAYE employees with time records are handled in Monthly PAYE.",
          )}
        </AlertBanner>

        {!hasCompany && isAdministrator(user) ? (
          <AlertBanner className="py-2 text-sm" tone="info">
            {t("payroll.report.select_company_banner", "Select a company to load payroll.")}
          </AlertBanner>
        ) : null}

        {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}

        {payrollSaveMessage ? (
          <AlertBanner tone={payrollSaveMessageTone}>{payrollSaveMessage}</AlertBanner>
        ) : null}

        <div className="space-y-4">
          <div className="min-w-0 w-full space-y-4">
            <section className={cn(uiClasses.card, "overflow-hidden")}>
              <div className="border-b border-[var(--color-border)] bg-[var(--color-toolbar-well)] px-3 py-3 sm:px-4">
                <h2 className="timiq-title-md mb-3">
                  {t("payroll.report.weekly_review_title", "Weekly payroll review")}
                </h2>

                <div className="flex flex-col gap-3 2xl:flex-row 2xl:flex-wrap 2xl:items-end 2xl:justify-between">
                  <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                    <div className="min-w-0 sm:min-w-[14rem] sm:flex-1">
                      <p className="text-sm font-semibold leading-snug text-[var(--color-text)]">
                        {formatPayrollWeekUkLabel(weekStart, policyTimeZone, false)}
                      </p>
                      {period?.timezone_name ? (
                        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{period.timezone_name}</p>
                      ) : null}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Button
                          disabled={loading}
                          onClick={() => setWeekStart(addDaysIsoYmd(weekStart, -7))}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          {t("payroll.report.previous_week", "Previous")}
                        </Button>
                        <Button
                          disabled={loading}
                          onClick={() => setWeekStart(addDaysIsoYmd(weekStart, 7))}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          {t("payroll.report.next_week", "Next")}
                        </Button>
                      </div>
                    </div>

                    {isAdministrator(user) ? (
                      <label className={cn(payrollToolbarField, "w-full min-w-0 sm:w-44")}>
                        <span className={payrollCompactFilterLabel}>
                          {t("payroll.report.company", "Company")}
                        </span>
                        <select
                          className={payrollCompactFilterSelect}
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
                      </label>
                    ) : (
                      <p className="pb-1 text-xs text-[var(--color-text-muted)] sm:max-w-[12rem]">
                        {t("payroll.report.company_scope_admin", "Company scope: your assigned company only.")}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-end gap-2">
                    <label className={cn(payrollToolbarField, "w-[8.5rem]")}>
                      <span className={payrollCompactFilterLabel}>
                        {t("payroll.report.date_from", "Date from")}
                      </span>
                      <input
                        className={payrollCompactFilterInput}
                        onChange={(event) => setExportDateFrom(event.target.value)}
                        type="date"
                        value={exportDateFrom}
                      />
                    </label>
                    <label className={cn(payrollToolbarField, "w-[8.5rem]")}>
                      <span className={payrollCompactFilterLabel}>
                        {t("payroll.report.date_to", "Date to")}
                      </span>
                      <input
                        className={payrollCompactFilterInput}
                        onChange={(event) => setExportDateTo(event.target.value)}
                        type="date"
                        value={exportDateTo}
                      />
                    </label>
                    <label className={cn(payrollToolbarField, "w-full min-w-0 sm:w-44")}>
                      <span className={payrollCompactFilterLabel}>
                        {t("payroll.report.employee_label", "Employee")}
                      </span>
                      <select
                        className={payrollCompactFilterSelect}
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
                    <Button
                      disabled={loading || !activeCompanyId}
                      onClick={applyEmployeeFilter}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      {t("payroll.report.apply_filter", "Apply filter")}
                    </Button>
                    <Button
                      disabled={loading || !activeCompanyId}
                      onClick={() => loadReport()}
                      size="sm"
                      type="button"
                    >
                      {t("payroll.report.refresh", "Refresh")}
                    </Button>
                  </div>

                  <div
                    aria-label={t("payroll.report.actions", "Actions")}
                    className={cn(uiClasses.payeActionToolbar, "gap-1.5")}
                  >
                    <Button
                      className={
                        !payrollPeriodNotCalculated && !payrollNeedsRecalculation
                          ? "border-[var(--color-success-700)] bg-[var(--color-success-50)] text-[var(--color-success-700)] hover:border-[var(--color-success-700)] hover:bg-[var(--color-success-700)] hover:text-white"
                          : undefined
                      }
                      disabled={loading || !activeCompanyId}
                      onClick={runRecalculate}
                      size="sm"
                      type="button"
                      variant={
                        payrollPeriodNotCalculated
                          ? "primary"
                          : payrollNeedsRecalculation
                            ? "danger"
                            : "primary"
                      }
                    >
                      {payrollPeriodNotCalculated
                        ? t("payroll.report.calculate", "Calculate payroll")
                        : t("payroll.report.recalculate", "Recalculate")}
                    </Button>
                    <Button
                      disabled={loading || !activeCompanyId || payrollNeedsRecalculation}
                      onClick={runApproveAll}
                      size="sm"
                      type="button"
                    >
                      {t("payroll.report.approve_all_pending", "Approve all pending")}
                    </Button>
                    <Button
                      aria-label={t("payroll.report.export_csv_short", "Export CSV")}
                      className="w-8 px-0"
                      disabled={loading || !activeCompanyId}
                      onClick={handleCsv}
                      size="sm"
                      title={t("payroll.report.export_csv_short", "Export CSV")}
                      type="button"
                      variant="secondary"
                    >
                      <FileDown aria-hidden="true" className="h-4 w-4" />
                    </Button>
                    <Button
                      aria-label={t("payroll.report.export_xlsx", "Export Excel")}
                      className="w-8 px-0"
                      disabled={loading || !activeCompanyId}
                      onClick={handleExcelDownload}
                      size="sm"
                      title={t("payroll.report.export_xlsx", "Export Excel")}
                      type="button"
                      variant="secondary"
                    >
                      <FileSpreadsheet aria-hidden="true" className="h-4 w-4" />
                    </Button>
                    <Button
                      aria-label={t("payroll.report.print_report", "Print report")}
                      className="w-8 px-0"
                      disabled={loading || !activeCompanyId}
                      onClick={handlePrint}
                      size="sm"
                      title={t("payroll.report.print_report", "Print report")}
                      type="button"
                      variant="secondary"
                    >
                      <Printer aria-hidden="true" className="h-4 w-4" />
                    </Button>
                    <Button
                      aria-label={t("payroll.report.export_pdf", "Download PDF report")}
                      className="w-8 px-0"
                      disabled={loading || !activeCompanyId}
                      onClick={handlePdfDownload}
                      size="sm"
                      title={t("payroll.report.export_pdf", "Download PDF report")}
                      type="button"
                      variant="secondary"
                    >
                      <FileText aria-hidden="true" className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className={cn(uiClasses.cardBody, "space-y-3 pt-3")}>
              {paidRowCount > 0 ? (
                <AlertBanner className="py-2 text-sm" tone="warning">
                  Payroll locked — paid rows cannot be rebuilt.
                </AlertBanner>
              ) : null}
              {payrollReviewRecalcStatus ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={payrollReviewRecalcStatus.badgeTone}>
                    {payrollReviewRecalcStatus.badgeLabel}
                  </Badge>
                  <span className="text-[var(--color-text)]">{payrollReviewRecalcStatus.message}</span>
                  {payrollRecalcBlocked ? (
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {t(
                        "payroll.report.recalc_unlock_before_recalc",
                        "Unlock approved or undo paid before recalculating.",
                      )}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className={cn(uiClasses.tableWrap, "timiq-scroll-x w-full min-w-0 shadow-[var(--shadow-soft)]")}>
                <Table className="min-w-full text-[0.9375rem]">
                <TableHeader className="bg-[var(--color-payroll-table-header-bg)]">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className={cn(payrollTableHead, "w-10")} />
                    <TableHead className={payrollTableHead}>{t("payroll.report.col_employee", "Employee")}</TableHead>
                    <TableHead className={payrollTableHead}>{t("employees.col_role", "Role")}</TableHead>
                    <TableHead className={payrollTableHead}>{t("payroll.report.col_hours", "Hours")}</TableHead>
                    <TableHead className={payrollTableHead}>{t("payroll.report.col_ot_hours", "OT hours")}</TableHead>
                    <TableHead className={payrollTableHead}>{t("payroll.report.col_gross", "Gross")}</TableHead>
                    <TableHead className={payrollTableHead}>{t("payroll.report.col_cis", "CIS tax")}</TableHead>
                    <TableHead className={payrollTableHead}>{t("payroll.report.col_net", "Net pay")}</TableHead>
                    <TableHead className={payrollTableHead}>{t("payroll.report.col_payment_type", "Payment type")}</TableHead>
                    <TableHead className={payrollTableHead}>{t("payroll.report.col_other_ded", "Other ded.")}</TableHead>
                    <TableHead className={payrollTableHead}>{t("payroll.report.col_notes", "Notes")}</TableHead>
                    <TableHead className={payrollTableHead}>{t("payroll.report.col_status", "Status")}</TableHead>
                    <TableHead className={payrollTableHead}>{t("payroll.report.col_actions", "Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell className="py-8 text-center text-sm text-[var(--color-text-muted)]" colSpan={13}>
                        {t("payroll.report.loading_table", "Loading…")}
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {!loading && !hasCompany ? (
                    <TableRow>
                      <TableCell className="py-8 text-center text-sm text-[var(--color-text-muted)]" colSpan={13}>
                        {t("payroll.report.choose_company_table", "Choose a company in the toolbar to load this table.")}
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {!loading && hasCompany && report && report.items.length === 0 ? (
                    <TableRow>
                      <TableCell className="py-8 text-center text-sm text-[var(--color-text-muted)]" colSpan={13}>
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
                        const payMode = storedPaymentMode(row.payment_mode);
                        const paymentModeLabel = row.payment_mode_label || "Not provided";
                        return (
                        <Fragment key={row.id}>
                          <TableRow className="transition-colors hover:bg-[var(--color-brand-muted)]/35">
                            <TableCell className={payrollTableCell}>
                              <Button
                                aria-expanded={expandedUserId === row.user_id}
                                aria-label="View shift details"
                                className={payrollExpandBtn}
                                onClick={() => toggleExpandShifts(row.user_id)}
                                title="View shift details"
                                type="button"
                                variant="secondary"
                              >
                                {expandedUserId === row.user_id ? "−" : "+"}
                              </Button>
                            </TableCell>
                            <TableCell className={cn(payrollTableCell, "max-w-[14rem] min-w-0")}>
                              <PayrollEmployeeIdentity
                                employee_email={row.employee_email}
                                employee_name={row.employee_name}
                                linked
                                nameClassName="truncate text-[0.9375rem] font-semibold leading-snug text-[var(--color-text)]"
                                emailClassName="mt-0.5 truncate text-xs leading-snug text-[var(--color-text-muted)]"
                                user_id={row.user_id}
                                withAvatar
                              />
                            </TableCell>
                            <TableCell className={cn(payrollTableCell, "max-w-[8rem] truncate text-[var(--color-text-muted)]")}>
                              {row.employee_job_title ?? "—"}
                            </TableCell>
                            <TableCell className={cn(payrollTableCell, "tabular-nums")}>
                              {formatHoursFromSeconds(row.regular_seconds)}
                            </TableCell>
                            <TableCell className={cn(payrollTableCell, "tabular-nums")}>
                              {formatHoursFromSeconds(row.overtime_seconds)}
                            </TableCell>
                            <TableCell
                              className={cn(
                                payrollTableCell,
                                payrollTableMoney,
                                payMode === "gross_payment" && "font-semibold text-[var(--color-text)]",
                              )}
                            >
                              {row.rate_missing
                                ? t("payroll.report.rate_not_set", "Rate not set")
                                : formatMoneyGBP(row.gross_amount)}
                            </TableCell>
                            <TableCell className={cn(payrollTableCell, payrollTableMoney)}>
                              {formatMoneyGBP(
                                effectiveDisplayedTaxAmount(
                                  row.display_tax_amount,
                                  row.tax_amount,
                                  row.payment_mode,
                                ),
                              )}
                            </TableCell>
                            <TableCell
                              className={cn(
                                payrollTableCell,
                                payrollTableMoney,
                                payMode === "net_payment" && "font-semibold text-[var(--color-text)]",
                              )}
                            >
                              {formatMoneyGBP(row.display_net_amount ?? row.net_amount)}
                            </TableCell>
                            <TableCell className={payrollTableCell}>
                              <PaymentBadge mode={payMode}>{paymentModeLabel}</PaymentBadge>
                            </TableCell>
                            <TableCell className={cn(payrollTableCell, payrollTableMoney)}>
                              {formatMoneyGBP(row.other_deductions_amount)}
                            </TableCell>
                            <TableCell
                              className={cn(payrollTableCell, "max-w-[10rem] min-w-0 text-[var(--color-text-muted)]")}
                              title={row.notes?.trim() || undefined}
                            >
                              <span className="block truncate">{row.notes?.trim() ? row.notes : "—"}</span>
                            </TableCell>
                            <TableCell className={payrollTableCell}>
                              <StatusBadge status={row.status}>
                                {statusBadgeLabel(t, row.status)}
                                {row.status === "paid" ? t("payroll.report.locked_suffix", " · Locked") : ""}
                              </StatusBadge>
                            </TableCell>
                            <TableCell className={payrollTableCell}>
                              <div className="flex flex-nowrap gap-1">
                                {row.status === "pending" ? (
                                  <Button
                                    className={payrollRowActionBtn}
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
                                      className={payrollRowActionBtn}
                                      disabled={busyId === row.id}
                                      onClick={() => rowAction(row.id, "unlock")}
                                      type="button"
                                    >
                                      {t("payroll.report.unlock", "Unlock")}
                                    </Button>
                                    <Button
                                      className={payrollRowActionBtn}
                                      disabled={busyId === row.id}
                                      onClick={() => rowAction(row.id, "paid")}
                                      type="button"
                                    >
                                      {t("payroll.report.mark_paid", "Mark paid")}
                                    </Button>
                                  </>
                                ) : null}
                                <span className="inline-block" data-payroll-row-menu>
                                  <Button
                                    aria-controls={`payroll-row-actions-${row.id}`}
                                    aria-expanded={rowActionMenu?.row.id === row.id}
                                    aria-haspopup="menu"
                                    aria-label={t("payroll.report.row_more_actions", "More payroll row actions")}
                                    className={payrollRowActionBtn}
                                    disabled={busyId === row.id}
                                    onClick={(event) => openRowActionMenu(row, lateBlock, event.currentTarget)}
                                    title={t("payroll.report.row_more_actions", "More payroll row actions")}
                                    type="button"
                                    variant="secondary"
                                  >
                                    ⋯
                                  </Button>
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                          {expandedUserId === row.user_id ? (
                            <TableRow>
                              <TableCell className="bg-[var(--color-header)]/60 py-3" colSpan={13}>
                                <p className="timiq-caption mb-2 font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
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
                                                    ? "border-b border-[var(--color-warning-700)]/20 bg-[var(--color-warning-50)]"
                                                    : "border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-header)]/30"
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
                                                    <Badge className="text-[10px]" tone="warning">
                                                      Open shift
                                                    </Badge>
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
                                  <div className="mt-4 border-t border-[var(--color-warning-700)]/25 pt-3">
                                    <p className="timiq-caption mb-2 font-semibold uppercase tracking-wide text-[var(--color-warning-700)]">
                                      Unpaid late shifts (completed after payroll was paid)
                                    </p>
                                    <p className="mb-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                                      Est. gross {formatMoneyGBP(lateBlock.estimated_gross_amount)} · CIS{" "}
                                      {formatMoneyGBP(lateBlock.estimated_cis_tax_amount)} · net{" "}
                                      {formatMoneyGBP(lateBlock.estimated_net_amount)} for these shifts (pending
                                      adjustment uses the same rules as payroll).
                                    </p>
                                    <div className="min-w-0 max-w-full overflow-x-auto [-webkit-overflow-scrolling:touch]">
                                      <table className="w-full min-w-[28rem] border-collapse text-left text-xs">
                                        <thead>
                                          <tr className="border-b border-[var(--color-warning-700)]/30 text-[var(--color-warning-700)]">
                                            <th className="py-1 pr-2">Clock in</th>
                                            <th className="py-1 pr-2">Clock out</th>
                                            <th className="py-1 pr-2">Rounded</th>
                                            <th className="py-1 pr-2">Reason</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {lateBlock.shifts.map((ls) => (
                                            <tr key={ls.shift_id} className="border-b border-[var(--color-border)]">
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
            </section>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <PayrollStatCard
                label={t("payroll.report.total_hours", "Total hours")}
                value={showMetricFigures ? formatHoursFromSeconds(totalHoursSeconds) : "—"}
              />
              <PayrollStatCard
                emphasize
                label={t("payroll.report.gross_pay", "Gross pay")}
                value={showMetricFigures ? formatMoneyGBP(report?.period.total_gross) : "—"}
              />
              <PayrollStatCard
                label={t("payroll.report.cis_tax", "CIS tax")}
                value={showMetricFigures ? formatMoneyGBP(report?.period.total_tax) : "—"}
              />
              <PayrollStatCard
                emphasize
                label={t("payroll.report.net_pay", "Net pay")}
                value={showMetricFigures ? formatMoneyGBP(report?.period.total_net) : "—"}
              />
              <PayrollStatCard
                label="Employees"
                value={
                  showMetricFigures
                    ? period?.total_items != null
                      ? String(period.total_items)
                      : "—"
                    : "—"
                }
              />
            </div>

            <SectionCard
              action={
                <Button
                  disabled={!activeCompanyId || paymentHistoryLoading}
                  onClick={() => void loadPaymentHistory()}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  {paymentHistoryLoading ? "Loading…" : "Refresh history"}
                </Button>
              }
              description="Paid payroll rows only. Uses the selected date range and employee filter."
              title="Payment history"
            >
              <div className={cn(uiClasses.tableWrap, "timiq-scroll-x w-full min-w-0")}>
                <Table className="min-w-[58rem] text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="py-2 text-xs font-semibold normal-case tracking-normal">
                        Paid date
                      </TableHead>
                      <TableHead className="py-2 text-xs font-semibold normal-case tracking-normal">
                        Payroll week
                      </TableHead>
                      <TableHead className="py-2 text-xs font-semibold normal-case tracking-normal">
                        Employee
                      </TableHead>
                      <TableHead className="py-2 text-xs font-semibold normal-case tracking-normal">Gross</TableHead>
                      <TableHead className="py-2 text-xs font-semibold normal-case tracking-normal">CIS</TableHead>
                      <TableHead className="py-2 text-xs font-semibold normal-case tracking-normal">Net paid</TableHead>
                      <TableHead className="py-2 text-xs font-semibold normal-case tracking-normal">
                        Payment mode
                      </TableHead>
                      <TableHead className="py-2 text-xs font-semibold normal-case tracking-normal">Status</TableHead>
                      <TableHead className="py-2 text-xs font-semibold normal-case tracking-normal">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!hasCompany ? (
                      <TableRow>
                        <TableCell className="py-6 text-center timiq-caption text-[var(--color-text-muted)]" colSpan={9}>
                          Select a company to load payment history.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {hasCompany && paymentHistoryLoading ? (
                      <TableRow>
                        <TableCell className="py-6 text-center timiq-caption text-[var(--color-text-muted)]" colSpan={9}>
                          Loading payment history…
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {hasCompany && !paymentHistoryLoading && paymentHistory.length === 0 ? (
                      <TableRow>
                        <TableCell className="py-6 text-center timiq-caption text-[var(--color-text-muted)]" colSpan={9}>
                          No paid payroll rows match the selected filters.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {hasCompany && !paymentHistoryLoading
                      ? paymentHistory.map((row) => {
                          const historyPayMode = storedPaymentMode(row.payment_mode);
                          return (
                            <TableRow
                              className="transition-colors hover:bg-[var(--color-header)]/40"
                              key={row.item_id}
                            >
                              <TableCell className={cn(payrollTableCell, "tabular-nums text-[var(--color-text-muted)]")}>
                                {formatShiftDateTime(row.paid_at, policyTimeZone)}
                              </TableCell>
                              <TableCell className={cn(payrollTableCell, "tabular-nums text-[var(--color-text-muted)]")}>
                                {row.week_start} → {row.week_end}
                              </TableCell>
                              <TableCell className={cn(payrollTableCell, "max-w-[14rem] min-w-0")}>
                                <PayrollEmployeeIdentity
                                  emailClassName="mt-0.5 truncate text-xs leading-snug text-[var(--color-text-muted)]"
                                  employee_email={row.employee_email}
                                  employee_name={row.employee_name}
                                  nameClassName="truncate text-[13px] font-semibold leading-snug text-[var(--color-text)]"
                                  user_id={row.user_id}
                                  withAvatar
                                />
                              </TableCell>
                              <TableCell className={cn(payrollTableCell, payrollTableMoney)}>
                                {formatMoneyGBP(row.gross_amount)}
                              </TableCell>
                              <TableCell className={cn(payrollTableCell, payrollTableMoney)}>
                                {formatMoneyGBP(row.cis_tax_amount)}
                              </TableCell>
                              <TableCell className={cn(payrollTableCell, payrollTableMoney)}>
                                {formatMoneyGBP(row.net_paid_amount)}
                              </TableCell>
                              <TableCell className={payrollTableCell}>
                                <PaymentBadge mode={historyPayMode}>{row.payment_mode_label}</PaymentBadge>
                              </TableCell>
                              <TableCell className={payrollTableCell}>
                                <StatusBadge status={row.status}>{statusBadgeLabel(t, row.status)}</StatusBadge>
                              </TableCell>
                              <TableCell className={payrollTableCell}>
                                <div className="flex flex-wrap gap-1">
                                  {row.can_open_payslip ? (
                                    <Button
                                      className={payrollRowActionBtn}
                                      onClick={() => openPayrollItemPayslip(row.item_id)}
                                      type="button"
                                      variant="secondary"
                                    >
                                      Payslip
                                    </Button>
                                  ) : null}
                                  {row.can_undo_paid ? (
                                    <Button
                                      className={payrollRowActionBtn}
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
                              </TableCell>
                            </TableRow>
                          );
                        })
                      : null}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>

            <SectionCard title="Supporting details">
              <div className="grid gap-3 xl:grid-cols-2">
                <SectionCard title="Monthly payroll summary">
                  {!hasCompany ? (
                    <p className="timiq-caption">Choose a company in the toolbar first.</p>
                  ) : null}
                  {hasCompany && monthLoading ? (
                    <p className="timiq-caption">Loading month totals…</p>
                  ) : null}
                  {hasCompany && !monthLoading && monthSummary ? (
                    <div className="mt-1 grid gap-2 text-xs sm:grid-cols-2">
                      <p className="timiq-caption">
                        <span className="font-semibold text-[var(--color-text)]">Month: </span>
                        {monthSummary.year}-{String(monthSummary.month).padStart(2, "0")}
                      </p>
                      <p className="timiq-caption">
                        <span className="font-semibold text-[var(--color-text)]">Payroll weeks: </span>
                        {monthSummary.payroll_weeks}
                      </p>
                      <p className="timiq-caption">
                        <span className="font-semibold text-[var(--color-text)]">Employees: </span>
                        {monthSummary.distinct_employees}
                      </p>
                      <p className="timiq-caption">
                        <span className="font-semibold text-[var(--color-text)]">Total hours: </span>
                        {formatHoursFromSeconds(monthSummary.total_rounded_seconds)}
                      </p>
                      <p className="timiq-caption">
                        <span className="font-semibold text-[var(--color-text)]">Gross: </span>
                        <span className="timiq-money">{formatMoneyGBP(monthSummary.total_gross)}</span>
                      </p>
                      <p className="timiq-caption">
                        <span className="font-semibold text-[var(--color-text)]">CIS tax: </span>
                        <span className="timiq-money">{formatMoneyGBP(monthSummary.total_tax)}</span>
                      </p>
                      <p className="timiq-caption">
                        <span className="font-semibold text-[var(--color-text)]">Net: </span>
                        <span className="timiq-money">{formatMoneyGBP(monthSummary.total_net)}</span>
                      </p>
                    </div>
                  ) : null}
                  {hasCompany && !monthLoading && !monthSummary ? (
                    <p className="timiq-caption">No month data loaded.</p>
                  ) : null}
                </SectionCard>

                {report ? (
                  <SectionCard
                    title="Approved leave (review)"
                    action={
                      (report.approved_leave_in_week?.length ?? 0) > 0 ? (
                        <Badge tone="info">{report.approved_leave_in_week?.length ?? 0} in week</Badge>
                      ) : null
                    }
                  >
                    <AlertBanner className="mb-3" tone="info">
                      {report.payroll_leave_review_note ??
                        "Leave is shown for review only. Automatic paid leave in gross totals is not enabled in this batch."}
                    </AlertBanner>
                    {(report.approved_leave_in_week?.length ?? 0) > 0 ? (
                      <div className={uiClasses.tableWrap}>
                        <table className="w-full min-w-[520px] border-collapse text-left text-[11px]">
                          <thead>
                            <tr className="border-b border-[var(--color-border-dark)] text-[var(--color-text-soft)]">
                              <th className="py-1.5 pr-2 font-semibold">Employee</th>
                              <th className="py-1.5 pr-2 font-semibold">Type</th>
                              <th className="py-1.5 pr-2 font-semibold">Dates</th>
                              <th className="py-1.5 pr-2 font-semibold">Days</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(report.approved_leave_in_week ?? []).map((lv) => (
                              <tr
                                className="border-b border-[var(--color-border)]"
                                key={`${lv.user_id}-${lv.date_from}-${lv.date_to}-${lv.leave_type}`}
                              >
                                <td className="py-1.5 pr-2">{lv.employee_name?.trim() || lv.employee_email || lv.user_id}</td>
                                <td className="py-1.5 pr-2">{leaveTypeLabel(lv.leave_type)}</td>
                                <td className="py-1.5 pr-2 tabular-nums text-[var(--color-text-muted)]">
                                  {lv.date_from} → {lv.date_to}
                                </td>
                                <td className="py-1.5 pr-2 tabular-nums">{lv.total_days}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="timiq-caption">No approved leave overlaps this payroll week.</p>
                    )}
                  </SectionCard>
                ) : null}

                <SectionCard title="Payroll summary">
                  {!hasCompany ? <p className="timiq-caption">—</p> : null}
                  {hasCompany && period ? (
                    <ul className="space-y-1.5 text-xs">
                      <li className="flex justify-between gap-2">
                        <span className="text-[var(--color-text-muted)]">Employees</span>
                        <span className="timiq-money font-semibold tabular-nums">{period.total_items}</span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span className="text-[var(--color-text-muted)]">Total hours</span>
                        <span className="timiq-money font-semibold tabular-nums">
                          {formatHoursFromSeconds(totalHoursSeconds)}
                        </span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span className="text-[var(--color-text-muted)]">Gross pay</span>
                        <span className="timiq-money font-semibold tabular-nums">{formatMoneyGBP(period.total_gross)}</span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span className="text-[var(--color-text-muted)]">CIS tax</span>
                        <span className="timiq-money font-semibold tabular-nums">{formatMoneyGBP(period.total_tax)}</span>
                      </li>
                      <li className="flex justify-between gap-2">
                        <span className="text-[var(--color-text-muted)]">Net pay</span>
                        <span className="timiq-money font-semibold tabular-nums">{formatMoneyGBP(period.total_net)}</span>
                      </li>
                    </ul>
                  ) : null}
                  {hasCompany && !period ? (
                    <p className="timiq-caption">Load a report to see totals.</p>
                  ) : null}
                </SectionCard>

                <SectionCard title="Payroll split (pre-tax wages)">
                  {!hasCompany ? <p className="timiq-caption">—</p> : null}
                  {hasCompany && split ? (
                    <div className="space-y-3 text-xs">
                      {[
                        { label: "Regular wages", value: split.regular_pay, barClass: "bg-[var(--color-text-soft)]" },
                        { label: "Overtime wages", value: split.overtime_pay, barClass: "bg-[var(--color-border-dark)]" },
                        { label: "Other pay", value: split.other_pay, barClass: "bg-[var(--color-border)]" },
                        {
                          label: "Total gross (payroll)",
                          value: split.total_gross,
                          barClass: "bg-[var(--color-brand)]",
                        },
                      ].map((row) => (
                        <div key={row.label}>
                          <div className="flex justify-between gap-2">
                            <span className="text-[var(--color-text-muted)]">{row.label}</span>
                            <span className="timiq-money font-semibold tabular-nums">{formatMoneyGBP(row.value)}</span>
                          </div>
                          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[var(--color-header)]">
                            <div
                              className={cn("h-2 rounded-full", row.barClass)}
                              style={{ width: `${payrollSplitBarPercent(row.value, split.total_gross)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                      <p className="border-t border-[var(--color-border)] pt-2 timiq-caption leading-snug">
                        Regular and overtime lines are derived from stored hours and rate snapshots; total
                        gross matches summed payroll item gross.
                      </p>
                    </div>
                  ) : null}
                  {hasCompany && !split ? (
                    <p className="timiq-caption">Load payroll to view split.</p>
                  ) : null}
                </SectionCard>
              </div>
            </SectionCard>

          </div>

        </div>

        {editRow ? (
          <div
            aria-modal="true"
            className={payrollModalBackdrop}
            role="dialog"
          >
            <div className={payrollModalPanel}>
              <div className={payrollModalHeader}>
                <div className="min-w-0">
                  <p className="timiq-title-md">
                    {editRow.status === "paid" ? "Payroll adjustments (paid row notes only)" : "Payroll adjustments"}
                  </p>
                </div>
                <Button onClick={() => setEditRow(null)} size="sm" type="button" variant="secondary">
                  Close
                </Button>
              </div>
              <form onSubmit={saveEdit}>
                <div className={payrollModalBody}>
                  <PayrollEmployeeIdentity
                    employee_email={editRow.employee_email}
                    employee_name={editRow.employee_name}
                    className="text-[var(--color-text)]"
                  />
                  <p className="timiq-caption">
                    Total rounded h: {formatHoursFromSeconds(editRow.rounded_total_seconds)}
                  </p>
                  <AlertBanner tone="info">
                    This modal edits payroll notes, deductions, payment mode, and display fields only. To change
                    hours, expand the employee row and use Edit shift.
                  </AlertBanner>
                  {editRow.status === "paid" ? (
                    <AlertBanner tone="warning">
                      This row is paid and locked. Hours and pay amounts cannot be changed here.
                    </AlertBanner>
                  ) : null}
                  <label className={uiClasses.payeFilterLabel}>
                    Notes
                    <textarea
                      className={cn(uiClasses.payeFilterInput, "mt-1 min-h-[3rem] py-2")}
                      onChange={(event) => setEditNotes(event.target.value)}
                      value={editNotes}
                    />
                  </label>
                  <label className={uiClasses.payeFilterLabel}>
                    Other deductions
                    <input
                      className={uiClasses.payeFilterInput}
                      disabled={editRow.status === "paid"}
                      onChange={(event) => setEditOtherDed(event.target.value)}
                      type="text"
                      value={editOtherDed}
                    />
                  </label>
                  <label className={uiClasses.payeFilterLabel}>
                    Display CIS tax
                    <input
                      className={uiClasses.payeFilterInput}
                      disabled={editRow.status === "paid"}
                      onChange={(event) => setEditDispTax(event.target.value)}
                      type="text"
                      value={editDispTax}
                    />
                  </label>
                  <label className={uiClasses.payeFilterLabel}>
                    Display net
                    <input
                      className={uiClasses.payeFilterInput}
                      disabled={editRow.status === "paid"}
                      onChange={(event) => setEditDispNet(event.target.value)}
                      type="text"
                      value={editDispNet}
                    />
                  </label>
                  <label className={uiClasses.payeFilterLabel}>
                    Payment mode
                    <select
                      className={uiClasses.payeFilterSelect}
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
                </div>
                <div className={payrollModalFooter}>
                  <Button onClick={() => setEditRow(null)} size="sm" type="button" variant="secondary">
                    Cancel
                  </Button>
                  <Button disabled={busyId === editRow.id} type="submit">
                    {busyId === editRow.id ? "Saving…" : "Save edits"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {shiftEditRow ? (
          <div
            aria-modal="true"
            className={payrollModalBackdrop}
            role="dialog"
          >
            <div className={payrollModalPanel}>
              <div className={payrollModalHeader}>
                <div className="min-w-0">
                  <p className="timiq-title-md">Edit shift</p>
                  <p className="timiq-caption mt-1">
                    Saves through Time Records and marks payroll as needing recalculation.
                  </p>
                </div>
                <Button onClick={closeShiftEdit} size="sm" type="button" variant="secondary">
                  Close
                </Button>
              </div>
              <form onSubmit={saveShiftEdit}>
                <div className={payrollModalBody}>
                  {shiftEditError ? <AlertBanner tone="danger">{shiftEditError}</AlertBanner> : null}
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 timiq-caption">
                    <p>
                      Employee:{" "}
                      <span className="font-semibold text-[var(--color-text)]">
                        {shiftEditRow.employee_name ?? shiftEditRow.employee_email ?? shiftEditRow.user_id}
                      </span>
                    </p>
                    <p className="mt-1">
                      Current rounded hours:{" "}
                      <span className="font-semibold text-[var(--color-text)]">
                        {shiftEditRow.rounded_seconds != null ? formatHoursFromSeconds(shiftEditRow.rounded_seconds) : "—"}
                      </span>
                    </p>
                  </div>
                  <label className={uiClasses.payeFilterLabel}>
                    Location
                    <select
                      className={uiClasses.payeFilterSelect}
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
                  <label className={uiClasses.payeFilterLabel}>
                    Clock in
                    <input
                      className={uiClasses.payeFilterInput}
                      onChange={(event) => setShiftEditClockInLocal(event.target.value)}
                      required
                      type="datetime-local"
                      value={shiftEditClockInLocal}
                    />
                  </label>
                  <label className={uiClasses.payeFilterLabel}>
                    Clock out
                    <input
                      className={uiClasses.payeFilterInput}
                      onChange={(event) => setShiftEditClockOutLocal(event.target.value)}
                      required
                      type="datetime-local"
                      value={shiftEditClockOutLocal}
                    />
                  </label>
                  <label className={uiClasses.payeFilterLabel}>
                    Break minutes
                    <input
                      className={uiClasses.payeFilterInput}
                      inputMode="numeric"
                      min={0}
                      onChange={(event) => setShiftEditBreakMinutes(event.target.value)}
                      type="number"
                      value={shiftEditBreakMinutes}
                    />
                  </label>
                  <label className={uiClasses.payeFilterLabel}>
                    Reason
                    <textarea
                      className={cn(uiClasses.payeFilterInput, "mt-1 min-h-[4rem] py-2")}
                      onChange={(event) => setShiftEditReason(event.target.value)}
                      required
                      value={shiftEditReason}
                    />
                  </label>
                </div>
                <div className={payrollModalFooter}>
                  <Button onClick={closeShiftEdit} size="sm" type="button" variant="secondary">
                    Cancel
                  </Button>
                  <Button disabled={shiftEditBusy} type="submit">
                    {shiftEditBusy ? "Saving…" : "Save shift"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {undoPaidRow ? (
          <div
            aria-modal="true"
            className={payrollModalBackdrop}
            role="dialog"
          >
            <div className={payrollModalPanel}>
              <div className={payrollModalHeader}>
                <p className="timiq-title-md">Undo paid</p>
                <Button
                  onClick={() => {
                    setUndoPaidRow(null);
                    setUndoPaidReason("");
                    setUndoPaidAckExport(false);
                  }}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Close
                </Button>
              </div>
              <div className={payrollModalBody}>
                <PayrollEmployeeIdentity
                  employee_email={undoPaidRow.employee_email}
                  employee_name={undoPaidRow.employee_name}
                  className="text-[var(--color-text)]"
                />
                <AlertBanner tone="warning">
                  Undoing paid moves this payroll item back to <span className="font-semibold">Approved</span>. Amounts
                  are not recalculated. Use only if payment was marked paid by mistake.
                </AlertBanner>
                {report?.accounting_payroll_export_overlaps ? (
                  <label className="flex cursor-pointer items-start gap-2 timiq-caption text-[var(--color-text)]">
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
                <label className={uiClasses.payeFilterLabel}>
                  Reason (required)
                  <textarea
                    className={cn(uiClasses.payeFilterInput, "mt-1 min-h-[4rem] py-2")}
                    onChange={(e) => setUndoPaidReason(e.target.value)}
                    placeholder="Explain why paid status is being reversed."
                    value={undoPaidReason}
                  />
                </label>
              </div>
              <div className={payrollModalFooter}>
                <Button
                  onClick={() => {
                    setUndoPaidRow(null);
                    setUndoPaidReason("");
                    setUndoPaidAckExport(false);
                  }}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button
                  disabled={busyId === undoPaidRow.id}
                  onClick={() => void submitUndoPaid()}
                  type="button"
                  variant="danger"
                >
                  {busyId === undoPaidRow.id ? "Working…" : "Confirm undo paid"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        <PayrollRowActionsPortal
          onClose={closeRowActionMenu}
          onEdit={openEdit}
          onLateAdjustment={(itemId) => void runCreateLateAdjustment(itemId)}
          onOpenPayslip={openPayrollItemPayslip}
          onUndoPaid={openUndoPaidFromMenu}
          report={report}
          state={rowActionMenu}
          t={t}
        />
      </SheetBody>
    </Sheet>
  );
}
