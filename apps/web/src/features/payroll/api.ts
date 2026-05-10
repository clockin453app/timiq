import { API_URL } from "../../config/api";

export type PayrollItemRow = {
  id: string;
  period_id: string;
  user_id: string;
  company_id: string;
  employee_email: string | null;
  employee_name: string | null;
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

export type PayrollReportResponse = {
  period: PayrollPeriodSummary;
  items: PayrollItemRow[];
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
};

function qs(params: Record<string, string>): string {
  const search = new URLSearchParams(params);
  return search.toString();
}

export async function fetchPayrollReport(
  companyId: string,
  weekStartIso: string,
): Promise<PayrollReportResponse> {
  const response = await fetch(
    `${API_URL}/api/payroll/report?${qs({ company_id: companyId, week_start: weekStartIso })}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      typeof detail.detail === "string" ? detail.detail : "Could not load payroll report.",
    );
  }
  return response.json() as Promise<PayrollReportResponse>;
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
      typeof detail.detail === "string" ? detail.detail : "Could not recalculate payroll.",
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
    throw new Error("Could not save payroll row.");
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
      typeof detail.detail === "string" ? detail.detail : "Could not approve all.",
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
