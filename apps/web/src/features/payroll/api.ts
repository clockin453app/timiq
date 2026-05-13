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
  zero_rounded_hours_employees_count: number;
  payroll_period_not_calculated: boolean;
  payroll_needs_recalculation?: boolean;
  can_auto_recalculate?: boolean;
};

export type PayrollReportResponse = {
  period: PayrollPeriodSummary;
  items: PayrollItemRow[];
  alerts: PayrollReportAlerts;
  split: PayrollPaySplit;
  payroll_auto_recalculated?: boolean;
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
};

export function payrollItemPayslipUrl(itemId: string): string {
  return `${API_URL}/api/payroll/items/${encodeURIComponent(itemId)}/payslip`;
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

export async function downloadPayrollCsv(companyId: string, weekStartIso: string): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/payroll/export.csv?${qs({ company_id: companyId, week_start: weekStartIso })}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw new Error("Could not export CSV.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `payroll-${companyId}-${weekStartIso}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function openPayrollPrintView(companyId: string, weekStartIso: string): void {
  const url = `${API_URL}/api/payroll/export.pdf?${qs({ company_id: companyId, week_start: weekStartIso })}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
