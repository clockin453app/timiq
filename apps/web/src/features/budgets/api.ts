import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

export const BUDGET_EXPENSE_CATEGORIES = [
  "materials",
  "tools",
  "equipment",
  "subcontractor",
  "plant_hire",
  "transport",
  "other",
] as const;

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

export type BudgetProjectSummary = {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  client_name: string | null;
  reference_code: string | null;
  location_id: string | null;
  location_name: string | null;
  workplace_id: string | null;
  workplace_name: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  planned_budget_amount: string | number;
  notes: string | null;
  total_spent: string | number;
  remaining_budget: string | number;
  budget_used_percent: string | null;
};

export type BudgetCategoryTotals = {
  materials: string | number;
  tools: string | number;
  equipment: string | number;
  subcontractor: string | number;
  plant_hire: string | number;
  transport: string | number;
  other: string | number;
};

export type BudgetEmployeeLabourBreakdown = {
  user_id: string;
  employee_name: string | null;
  employee_email: string;
  job_title: string | null;
  shift_count: number;
  total_payroll_seconds: number;
  finalized_labour_cost: string | number;
  estimated_labour_cost: string | number;
  total_labour_cost: string | number;
};

export type BudgetLiveTotals = {
  planned_budget_amount: string | number;
  finalized_labour_cost: string | number;
  estimated_labour_cost: string | number;
  total_labour_cost: string | number;
  total_expenses: string | number;
  total_spent: string | number;
  remaining_budget: string | number;
  over_budget_amount: string | number;
  budget_used_percent: string | null;
  labour_percent_of_budget: string | null;
  expenses_percent_of_budget: string | null;
  total_materials: string | number;
  total_tools: string | number;
  total_equipment: string | number;
  total_subcontractor: string | number;
  total_plant_hire: string | number;
  total_transport: string | number;
  total_other: string | number;
  total_clocked_seconds: number;
  total_payable_seconds: number;
  total_payroll_seconds: number;
  total_break_seconds: number;
  open_shift_count: number;
  missing_rate_count: number;
  warnings: string[];
  estimate_note: string;
};

export type BudgetExpenseResponse = {
  id: string;
  budget_id: string;
  company_id: string;
  category: string;
  description: string;
  supplier: string | null;
  purchase_date: string;
  amount: string | number;
  vat_amount: string | number | null;
  invoice_ref: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type BudgetProjectDetailResponse = {
  budget: BudgetProjectSummary;
  totals: BudgetLiveTotals;
  breakdown_by_employee: BudgetEmployeeLabourBreakdown[];
  breakdown_by_category: BudgetCategoryTotals;
  recent_expenses: BudgetExpenseResponse[];
};

export type CreateBudgetBody = {
  company_id?: string | null;
  name: string;
  description?: string | null;
  workplace_id?: string | null;
  location_id?: string | null;
  client_name?: string | null;
  reference_code?: string | null;
  status?: string;
  start_date?: string | null;
  end_date?: string | null;
  planned_budget_amount: string;
  notes?: string | null;
};

export type PatchBudgetBody = Partial<CreateBudgetBody>;

export type CreateExpenseBody = {
  category: string;
  description: string;
  supplier?: string | null;
  purchase_date: string;
  amount: string;
  vat_amount?: string | null;
  invoice_ref?: string | null;
  notes?: string | null;
};

async function parseError(response: Response, fallback: string): Promise<never> {
  const detail = await response.json().catch(() => ({}));
  throw new Error(fastApiDetailToMessage((detail as { detail?: unknown }).detail, fallback));
}

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
    await parseError(response, "Could not load labour cost budget.");
  }

  return response.json() as Promise<LabourCostBudgetResponse>;
}

export async function listBudgetProjects(params: {
  companyId?: string | null;
  status?: string | null;
  locationId?: string | null;
  workplaceId?: string | null;
  search?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number;
  offset?: number;
}): Promise<BudgetProjectSummary[]> {
  const search = new URLSearchParams();
  if (params.companyId) {
    search.set("company_id", params.companyId);
  }
  if (params.status) {
    search.set("status", params.status);
  }
  if (params.locationId) {
    search.set("location_id", params.locationId);
  }
  if (params.workplaceId) {
    search.set("workplace_id", params.workplaceId);
  }
  if (params.search) {
    search.set("search", params.search);
  }
  if (params.dateFrom) {
    search.set("date_from", params.dateFrom);
  }
  if (params.dateTo) {
    search.set("date_to", params.dateTo);
  }
  if (params.limit != null) {
    search.set("limit", String(params.limit));
  }
  if (params.offset != null) {
    search.set("offset", String(params.offset));
  }
  const response = await fetch(`${API_URL}/api/budgets?${search.toString()}`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not load budgets.");
  }
  return response.json() as Promise<BudgetProjectSummary[]>;
}

export async function createBudget(body: CreateBudgetBody): Promise<BudgetProjectDetailResponse> {
  const response = await fetch(`${API_URL}/api/budgets`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await parseError(response, "Could not create budget.");
  }
  return response.json() as Promise<BudgetProjectDetailResponse>;
}

export async function getBudgetDetail(budgetId: string): Promise<BudgetProjectDetailResponse> {
  const response = await fetch(`${API_URL}/api/budgets/${encodeURIComponent(budgetId)}`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not load budget.");
  }
  return response.json() as Promise<BudgetProjectDetailResponse>;
}

export async function patchBudget(budgetId: string, body: PatchBudgetBody): Promise<BudgetProjectDetailResponse> {
  const response = await fetch(`${API_URL}/api/budgets/${encodeURIComponent(budgetId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await parseError(response, "Could not update budget.");
  }
  return response.json() as Promise<BudgetProjectDetailResponse>;
}

export async function archiveBudget(budgetId: string): Promise<BudgetProjectDetailResponse> {
  const response = await fetch(`${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/archive`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not archive budget.");
  }
  return response.json() as Promise<BudgetProjectDetailResponse>;
}

export async function listBudgetExpenses(budgetId: string): Promise<BudgetExpenseResponse[]> {
  const response = await fetch(`${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/expenses`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not load expenses.");
  }
  return response.json() as Promise<BudgetExpenseResponse[]>;
}

export async function createBudgetExpense(
  budgetId: string,
  body: CreateExpenseBody,
): Promise<BudgetExpenseResponse> {
  const response = await fetch(`${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/expenses`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await parseError(response, "Could not add expense.");
  }
  return response.json() as Promise<BudgetExpenseResponse>;
}

export async function patchBudgetExpense(
  budgetId: string,
  expenseId: string,
  body: Partial<CreateExpenseBody>,
): Promise<BudgetExpenseResponse> {
  const response = await fetch(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/expenses/${encodeURIComponent(expenseId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    await parseError(response, "Could not update expense.");
  }
  return response.json() as Promise<BudgetExpenseResponse>;
}

export async function deleteBudgetExpense(budgetId: string, expenseId: string): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/expenses/${encodeURIComponent(expenseId)}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  if (!response.ok) {
    await parseError(response, "Could not delete expense.");
  }
}

export async function downloadBudgetReportCsv(budgetId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/report.csv`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not export CSV.");
  }
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `budget-${budgetId}.csv`;
  anchor.click();
  URL.revokeObjectURL(href);
}

export function openBudgetReportPrint(budgetId: string): void {
  window.open(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/report.print`,
    "_blank",
    "noopener,noreferrer",
  );
}
