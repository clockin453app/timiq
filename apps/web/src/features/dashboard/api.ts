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
