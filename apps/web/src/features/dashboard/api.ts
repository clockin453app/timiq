import { API_URL } from "../../config/api";

export type ManagementSummary = {
  generated_at: string;
  company_id: string | null;
  aggregated_companies: boolean;
  active_employee_count: number;
  active_location_count: number;
  active_workplace_count: number;
  live_open_shifts: number;
  live_total_employees: number;
  live_present_today: number;
  live_attendance_rate: number | null;
  payroll_week_start: string | null;
  payroll_week_end: string | null;
  payroll_status: string;
  payroll_total_gross: number | null;
  payroll_total_hours_seconds: number;
  payroll_message: string | null;
};

export type NeedsAttentionItem = {
  code: string;
  label: string;
  count: number;
  severity: "info" | "warning" | "critical";
  href: string;
};

export type TodayLiveRow = {
  display_name: string;
  email: string | null;
  location_name: string | null;
  clock_in_at: string;
  running_seconds: number;
  href: string;
};

export type PayrollReadinessPanel = {
  payroll_status: string;
  week_start: string | null;
  week_end: string | null;
  total_items: number;
  pending_count: number;
  approved_count: number;
  paid_count: number;
  rate_missing_count: number;
  payroll_period_not_calculated: boolean;
  payroll_needs_recalculation: boolean;
  open_shifts_started_in_week_count: number;
  total_gross: number | null;
  total_hours_seconds: number;
  href: string;
  scope_note: string | null;
};

export type SetupHealthPanel = {
  active_employee_count: number;
  active_location_count: number;
  active_workplace_count: number;
  employees_missing_hourly_rate_count: number;
  employees_without_site_access_count: number;
  time_policy_row_present: boolean;
  time_policy_configured: boolean;
  scope_note: string | null;
};

export type OverviewData = ManagementSummary & {
  attendance_trend: Array<{
    date: string;
    present_count: number;
    total_employees: number;
    attendance_rate: number | null;
  }>;
  payroll_trend: Array<{
    week_start: string;
    total_gross: number;
    total_hours_seconds: number;
  }>;
  recent_activity: Array<{
    occurred_at: string;
    summary: string;
    detail: string | null;
  }>;
  long_open_shift_threshold_hours: number;
  needs_attention: NeedsAttentionItem[];
  needs_attention_scope_note: string | null;
  today_live: TodayLiveRow[];
  payroll_readiness: PayrollReadinessPanel | null;
  setup_health: SetupHealthPanel | null;
};

function buildCompanyQuery(companyId: string | null | undefined): string {
  if (!companyId) {
    return "";
  }
  return `?company_id=${encodeURIComponent(companyId)}`;
}

export async function fetchManagementSummary(companyId?: string | null): Promise<ManagementSummary> {
  const response = await fetch(`${API_URL}/api/dashboard/summary${buildCompanyQuery(companyId)}`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Could not load dashboard summary.");
  }
  return response.json() as Promise<ManagementSummary>;
}

export async function fetchManagementOverview(companyId?: string | null): Promise<OverviewData> {
  const response = await fetch(`${API_URL}/api/dashboard/overview${buildCompanyQuery(companyId)}`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Could not load overview.");
  }
  return response.json() as Promise<OverviewData>;
}
