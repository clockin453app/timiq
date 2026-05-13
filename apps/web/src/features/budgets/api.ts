import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

export type LabourCostEmployeeBreakdown = {
  user_id: string;
  employee_name: string | null;
  employee_email: string;
  job_title: string | null;
  total_payroll_seconds: number;
  hourly_rate: string | null;
  labour_cost: string | number;
  rate_missing: boolean;
  shift_count: number;
};

export type LabourCostLocationBreakdown = {
  location_id: string;
  location_name: string;
  workplace_name: string | null;
  total_payroll_seconds: number;
  labour_cost: string | number;
  shift_count: number;
};

export type LabourCostBudgetResponse = {
  company_id: string;
  company_name: string;
  date_from: string;
  date_to: string;
  planned_budget_amount: string | null;
  actual_labour_cost: string | number;
  remaining_budget: string | null;
  over_budget_amount: string | null;
  budget_used_percent: string | null;
  total_clocked_seconds: number;
  total_payable_seconds: number;
  total_payroll_seconds: number;
  total_break_seconds: number;
  average_hourly_cost: string | null;
  rate_missing_count: number;
  open_shift_count: number;
  is_estimated: boolean;
  estimate_note: string;
  payroll_available: boolean;
  payroll_gross_total: string | null;
  breakdown_by_employee: LabourCostEmployeeBreakdown[];
  breakdown_by_location: LabourCostLocationBreakdown[];
};

export type LabourCostBudgetParams = {
  companyId?: string | null;
  dateFrom: string;
  dateTo: string;
  locationId?: string | null;
  userId?: string | null;
  workplaceId?: string | null;
  plannedBudgetAmount?: string | null;
};

export async function fetchLabourCostBudget(params: LabourCostBudgetParams): Promise<LabourCostBudgetResponse> {
  const search = new URLSearchParams();
  search.set("date_from", params.dateFrom);
  search.set("date_to", params.dateTo);
  if (params.companyId) {
    search.set("company_id", params.companyId);
  }
  if (params.locationId) {
    search.set("location_id", params.locationId);
  }
  if (params.userId) {
    search.set("user_id", params.userId);
  }
  if (params.workplaceId) {
    search.set("workplace_id", params.workplaceId);
  }
  if (params.plannedBudgetAmount != null && params.plannedBudgetAmount.trim() !== "") {
    search.set("planned_budget_amount", params.plannedBudgetAmount.trim());
  }

  const response = await fetch(`${API_URL}/api/budgets/labour-cost?${search.toString()}`, {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      fastApiDetailToMessage((detail as { detail?: unknown }).detail, "Could not load labour cost budget."),
    );
  }

  return response.json() as Promise<LabourCostBudgetResponse>;
}
