import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

export type PayrollItemRow = {
  id: string;
  period_id: string;
  user_id: string;
  company_id: string;
  employee_email: string | null;
  employee_name: string | null;
  employee_job_title?: string | null;
  regular_seconds: number;
  overtime_seconds: number;
  rounded_total_seconds: number;
  hourly_rate_snapshot: string | null;
  tax_rate_snapshot: string | null;
  overtime_multiplier_snapshot: string | null;
  gross_amount: string | null;
  tax_amount: string | null;
  net_amount: string | null;
  other_deductions_amount: string;
  display_tax_amount: string | null;
  display_net_amount: string | null;
  payment_mode: string | null;
  notes: string | null;
  policy_snapshot: Record<string, unknown>;
  status: string;
  approved_at: string | null;
  approved_by_user_id: string | null;
  paid_at: string | null;
  paid_by_user_id: string | null;
  rate_missing: boolean;
};

export type PayrollPeriodSummary = {
  id: string;
  company_id: string;
  week_start: string;
  timezone_name: string;
  calculated_at: string | null;
  calculated_by_user_id: string | null;
  total_items: number;
  pending_count: number;
  approved_count: number;
  paid_count: number;
  total_regular_seconds: number;
  total_overtime_seconds: number;
  total_rounded_seconds: number;
  total_gross: string | null;
  total_tax: string | null;
  total_net: string | null;
  total_other_deductions: string;
};

export type PayrollPaySplit = {
  regular_pay: string;
  overtime_pay: string;
  other_pay: string;
  total_gross: string | null;
};

export type PayrollReportAlerts = {
  pending_approval_count: number;
  open_shifts_started_in_week_count: number;
  rate_missing_employees_count: number;
  missing_payroll_setup_employees_count?: number;
  utr_missing_employees_count?: number;
  nino_missing_employees_count?: number;
  zero_rounded_hours_employees_count: number;
  payroll_period_not_calculated: boolean;
  payroll_needs_recalculation?: boolean;
  can_auto_recalculate?: boolean;
};

export type PayrollLateShiftRow = {
  shift_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  rounded_seconds: number;
  reason: string;
  reference_paid_item_id: string | null;
};

export type PayrollLateUnpaidEmployee = {
  user_id: string;
  employee_email: string | null;
  employee_name: string | null;
  total_late_rounded_seconds: number;
  shifts: PayrollLateShiftRow[];
  estimated_gross_amount: string | null;
  estimated_net_amount: string | null;
  estimated_cis_tax_amount: string | null;
};

export type PayrollApprovedLeaveRow = {
  user_id: string;
  employee_email: string | null;
  employee_name: string | null;
  leave_type: string;
  date_from: string;
  date_to: string;
  total_days: string;
};

export type PayrollReportResponse = {
  period: PayrollPeriodSummary;
  items: PayrollItemRow[];
  alerts: PayrollReportAlerts;
  split: PayrollPaySplit;
  payroll_auto_recalculated?: boolean;
  has_late_unpaid_shifts?: boolean;
  late_shift_count?: number;
  /** Same as late_shift_count when present; explicit detected count from API. */
  late_shift_count_detected?: number;
  late_shift_count_payable?: number;
  late_unpaid_total_rounded_seconds?: number;
  has_payable_late_unpaid_shifts?: boolean;
  late_unpaid_employees?: PayrollLateUnpaidEmployee[];
  accounting_payroll_export_overlaps?: boolean;
  approved_leave_in_week?: PayrollApprovedLeaveRow[];
  payroll_leave_review_note?: string;
};

export type PayrollMonthSummary = {
  company_id: string;
  year: number;
  month: number;
  payroll_weeks: number;
  distinct_employees: number;
  total_regular_seconds: number;
  total_overtime_seconds: number;
  total_rounded_seconds: number;
  total_gross: string | null;
  total_tax: string | null;
  total_net: string | null;
  total_other_deductions: string;
  total_days: number | null;
};

export type PayrollPaymentHistoryRow = {
  item_id: string;
  user_id: string;
  employee_email: string | null;
  employee_name: string | null;
  paid_at: string;
  week_start: string;
  week_end: string;
  gross_amount: string | null;
  cis_tax_amount: string | null;
  net_paid_amount: string | null;
  payment_mode: string | null;
  payment_mode_label: string;
  status: string;
  can_open_payslip: boolean;
  can_undo_paid: boolean;
};

export type PatchPayrollItemRequest = {
  notes?: string | null;
  other_deductions_amount?: string | null;
  display_tax_amount?: string | null;
  display_net_amount?: string | null;
  payment_mode?: string | null;
};

export type PayHistoryEntry = {
  id: string;
  company_id: string;
  week_start: string;
  week_end: string;
  period_id: string;
  regular_seconds: number;
  overtime_seconds: number;
  rounded_total_seconds: number;
  gross_amount: string | null;
  tax_amount: string | null;
  net_amount: string | null;
  display_tax_amount: string | null;
  display_net_amount: string | null;
  other_deductions_amount: string;
  status: string;
  approved_at: string | null;
  paid_at: string | null;
  rate_missing: boolean;
  company_name?: string;
  payment_mode?: string | null;
  can_open_payslip?: boolean;
  effective_cis_tax_amount?: string | null;
  effective_net_amount?: string | null;
  timezone_name?: string;
};

export type PayrollItemCompanySnippet = {
  id: string;
  name: string;
};

export type PayrollItemSummaryResponse = {
  item_id: string;
  company: PayrollItemCompanySnippet;
  employee_display_name: string;
  employee_email?: string | null;
  timezone_name: string;
  week_start: string;
  week_end: string;
  status: string;
  approved_at: string | null;
  paid_at: string | null;
  payment_mode: string | null;
  payment_mode_label: string;
  regular_seconds: number;
  overtime_seconds: number;
  rounded_total_seconds: number;
  gross_amount: string | null;
  cis_tax_amount: string | null;
  net_amount: string | null;
  other_deductions_amount: string;
  hourly_rate_snapshot: string | null;
  rate_missing: boolean;
  ytd_taxable_pay: string;
  ytd_cis_deducted: string;
  can_open_payslip?: boolean;
  national_insurance_number?: string | null;
  utr_number?: string | null;
};

export function payrollItemPayslipUrl(itemId: string): string {
  return `${API_URL}/api/payroll/items/${encodeURIComponent(itemId)}/payslip`;
}

export function openPayrollItemPayslip(itemId: string): void {
  window.open(payrollItemPayslipUrl(itemId), "_blank", "noopener,noreferrer");
}

function qs(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, value);
    }
  }
  return search.toString();
}

export async function fetchPayrollReport(
  companyId: string,
  weekStartIso: string,
  options?: { userId?: string | null },
): Promise<PayrollReportResponse> {
  const response = await fetch(
    `${API_URL}/api/payroll/report?${qs({
      company_id: companyId,
      week_start: weekStartIso,
      user_id: options?.userId ?? undefined,
    })}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      fastApiDetailToMessage(
        (detail as { detail?: unknown }).detail,
        "Could not load payroll report.",
      ),
    );
  }
  return response.json() as Promise<PayrollReportResponse>;
}

export async function fetchPayrollMonthSummary(
  companyId: string,
  year: number,
  month: number,
): Promise<PayrollMonthSummary> {
  const response = await fetch(
    `${API_URL}/api/payroll/month-summary?${qs({
      company_id: companyId,
      year: String(year),
      month: String(month),
    })}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      fastApiDetailToMessage(
        (detail as { detail?: unknown }).detail,
        "Could not load month summary.",
      ),
    );
  }
  return response.json() as Promise<PayrollMonthSummary>;
}

export async function fetchPayrollPaymentHistory(params: {
  companyId: string;
  dateFrom?: string;
  dateTo?: string;
  employeeUserId?: string | null;
}): Promise<PayrollPaymentHistoryRow[]> {
  const response = await fetch(
    `${API_URL}/api/payroll/payment-history?${qs({
      company_id: params.companyId,
      date_from: params.dateFrom,
      date_to: params.dateTo,
      employee_user_id: params.employeeUserId ?? undefined,
    })}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      fastApiDetailToMessage(
        (detail as { detail?: unknown }).detail,
        "Could not load payment history.",
      ),
    );
  }
  return response.json() as Promise<PayrollPaymentHistoryRow[]>;
}

export async function recalculatePayroll(
  companyId: string,
  weekStartIso: string,
): Promise<PayrollReportResponse> {
  const response = await fetch(`${API_URL}/api/payroll/recalculate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ company_id: companyId, week_start: weekStartIso }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      fastApiDetailToMessage(
        (detail as { detail?: unknown }).detail,
        "Could not recalculate payroll.",
      ),
    );
  }
  return response.json() as Promise<PayrollReportResponse>;
}

export async function patchPayrollItem(
  itemId: string,
  body: PatchPayrollItemRequest,
): Promise<PayrollItemRow> {
  const response = await fetch(`${API_URL}/api/payroll/items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      fastApiDetailToMessage(
        (detail as { detail?: unknown }).detail,
        "Could not save payroll row.",
      ),
    );
  }
  return response.json() as Promise<PayrollItemRow>;
}

export async function approvePayrollItem(itemId: string): Promise<PayrollItemRow> {
  const response = await fetch(`${API_URL}/api/payroll/items/${itemId}/approve`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Could not approve row.");
  }
  return response.json() as Promise<PayrollItemRow>;
}

export async function unlockPayrollItem(itemId: string): Promise<PayrollItemRow> {
  const response = await fetch(`${API_URL}/api/payroll/items/${itemId}/unlock`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Could not unlock row.");
  }
  return response.json() as Promise<PayrollItemRow>;
}

export type UndoPayrollPaidRequest = {
  reason: string;
  confirm: boolean;
  acknowledge_accounting_export?: boolean;
};

export type PayrollLateAdjustmentBody = {
  confirm: boolean;
  shift_ids?: string[] | null;
};

export async function undoPayrollPaid(
  itemId: string,
  body: UndoPayrollPaidRequest,
): Promise<PayrollItemRow> {
  const response = await fetch(`${API_URL}/api/payroll/items/${encodeURIComponent(itemId)}/undo-paid`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      reason: body.reason,
      confirm: body.confirm,
      acknowledge_accounting_export: body.acknowledge_accounting_export ?? false,
    }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      fastApiDetailToMessage(
        (detail as { detail?: unknown }).detail,
        "Could not undo paid status.",
      ),
    );
  }
  return response.json() as Promise<PayrollItemRow>;
}

export async function createPayrollLateShiftAdjustment(
  paidItemId: string,
  body: PayrollLateAdjustmentBody,
): Promise<PayrollItemRow> {
  const response = await fetch(
    `${API_URL}/api/payroll/items/${encodeURIComponent(paidItemId)}/adjustment-for-late-shifts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        confirm: body.confirm,
        shift_ids: body.shift_ids ?? null,
      }),
    },
  );
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      fastApiDetailToMessage(
        (detail as { detail?: unknown }).detail,
        "Could not create adjustment row.",
      ),
    );
  }
  return response.json() as Promise<PayrollItemRow>;
}

export async function markPayrollPaid(itemId: string): Promise<PayrollItemRow> {
  const response = await fetch(`${API_URL}/api/payroll/items/${itemId}/mark-paid`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Could not mark paid.");
  }
  return response.json() as Promise<PayrollItemRow>;
}

export async function approveAllPending(
  companyId: string,
  weekStartIso: string,
): Promise<PayrollReportResponse> {
  const response = await fetch(`${API_URL}/api/payroll/approve-all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ company_id: companyId, week_start: weekStartIso }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      fastApiDetailToMessage(
        (detail as { detail?: unknown }).detail,
        "Could not approve all.",
      ),
    );
  }
  return response.json() as Promise<PayrollReportResponse>;
}

export async function fetchMyPayHistory(): Promise<PayHistoryEntry[]> {
  const response = await fetch(`${API_URL}/api/payroll/pay-history/me`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Could not load pay history.");
  }
  return response.json() as Promise<PayHistoryEntry[]>;
}

export async function downloadMyTaxYearPaySummary(taxYear: string): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/payroll/pay-history/me/tax-year-summary.xlsx?${qs({ tax_year: taxYear })}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw new Error("Could not download pay summary.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `timiq-pay-summary-${taxYear}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function fetchPayrollItemSummary(itemId: string): Promise<PayrollItemSummaryResponse> {
  const response = await fetch(`${API_URL}/api/payroll/items/${encodeURIComponent(itemId)}/summary`, {
    credentials: "include",
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      fastApiDetailToMessage(
        (detail as { detail?: unknown }).detail,
        "Could not load pay week details.",
      ),
    );
  }
  return response.json() as Promise<PayrollItemSummaryResponse>;
}

export type PayrollReportExportParams = {
  companyId: string;
  weekStartIso?: string;
  dateFrom?: string;
  dateTo?: string;
  employeeUserId?: string | null;
};

function addDaysIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

export async function downloadPayrollCsv(params: PayrollReportExportParams): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/payroll/export.csv?${qs({
      company_id: params.companyId,
      week_start: params.weekStartIso,
      date_from: params.dateFrom,
      date_to: params.dateTo,
      employee_user_id: params.employeeUserId ?? undefined,
    })}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw new Error("Could not export CSV.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const datePart =
    params.dateFrom && params.dateTo ? `${params.dateFrom}-to-${params.dateTo}` : params.weekStartIso ?? "export";
  anchor.download = `payroll-${params.companyId}-${datePart}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function downloadPayrollExcelReport(params: PayrollReportExportParams): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/payroll/export.xlsx?${qs({
      company_id: params.companyId,
      week_start: params.weekStartIso,
      date_from: params.dateFrom,
      date_to: params.dateTo,
      employee_user_id: params.employeeUserId ?? undefined,
    })}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw new Error("Could not export Excel.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const datePart =
    params.dateFrom && params.dateTo
      ? `${params.dateFrom}-to-${params.dateTo}`
      : params.weekStartIso
        ? `${params.weekStartIso}-to-${addDaysIsoDate(params.weekStartIso, 6)}`
        : "export";
  anchor.download = `timiq-payroll-report-${datePart}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function openPayrollPrintView(
  companyId: string,
  weekStartIso: string,
  userId?: string | null,
): void {
  const params: Record<string, string> = {
    company_id: companyId,
    week_start: weekStartIso,
  };
  if (userId) {
    params.user_id = userId;
  }
  const url = `${API_URL}/api/payroll/export.print?${qs(params)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function downloadPayrollPdfReport(
  exportParams: PayrollReportExportParams,
): Promise<void> {
  const requestParams: Record<string, string> = {
    company_id: exportParams.companyId,
  };
  if (exportParams.weekStartIso) {
    requestParams.week_start = exportParams.weekStartIso;
  }
  if (exportParams.dateFrom && exportParams.dateTo) {
    requestParams.date_from = exportParams.dateFrom;
    requestParams.date_to = exportParams.dateTo;
  }
  if (exportParams.employeeUserId) {
    requestParams.employee_user_id = exportParams.employeeUserId;
  }
  const response = await fetch(`${API_URL}/api/payroll/export.pdf?${qs(requestParams)}`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Could not download payroll PDF report.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const datePart =
    exportParams.dateFrom && exportParams.dateTo
      ? `${exportParams.dateFrom}-to-${exportParams.dateTo}`
      : exportParams.weekStartIso ?? "export";
  anchor.download = `timiq-payroll-report-${datePart}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}
