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

/* —— Project financial summary + invoice register reports —— */

export type BudgetCostPosition = {
  planned_budget_amount: string | number;
  finalized_labour_cost: string | number;
  estimated_labour_cost: string | number;
  total_labour_cost: string | number;
  total_expenses: string | number;
  forecast_total_cost: string | number;
  remaining_budget: string | number;
  over_budget_amount: string | number;
  budget_used_percent: string | number | null;
  open_shift_count: number;
  missing_rate_count: number;
  warnings: string[];
  estimate_note: string;
};

export type BudgetBillingPosition = {
  contract_value_net: string | number | null;
  billing_currency: string | null;
  active_invoiced_net: string | number;
  vat_invoiced: string | number;
  gross_invoiced: string | number;
  remaining_to_invoice: string | number | null;
  over_invoiced: string | number | null;
  payments_received_gross: string | number;
  outstanding_gross: string | number;
  overdue_outstanding_gross: string | number;
  draft_count: number;
  issued_count: number;
  overdue_count: number;
  void_count: number;
  part_paid_count: number;
  paid_count: number;
  active_count: number;
};

export type BudgetProfitability = {
  forecast_revenue_net: string | number | null;
  forecast_total_cost: string | number | null;
  forecast_profit: string | number | null;
  forecast_margin_percent: string | number | null;
};

export type InvoiceStatusCounts = {
  draft: number;
  issued: number;
  part_paid: number;
  paid: number;
  overdue: number;
  void: number;
};

export type BudgetFinancialSummaryResponse = {
  budget: BudgetProjectSummary;
  cost_position: BudgetCostPosition;
  billing_position: BudgetBillingPosition;
  profitability: BudgetProfitability;
  invoice_status_counts: InvoiceStatusCounts;
};

export async function fetchBudgetFinancialSummary(
  budgetId: string,
): Promise<BudgetFinancialSummaryResponse> {
  const response = await fetch(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/financial-summary`,
    { method: "GET", credentials: "include" },
  );
  if (!response.ok) {
    await parseError(response, "Could not load financial summary.");
  }
  return response.json() as Promise<BudgetFinancialSummaryResponse>;
}

async function downloadBudgetReportBlob(
  budgetId: string,
  pathSuffix: string,
  downloadName: string,
  fallback: string,
): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/${pathSuffix}`,
    { method: "GET", credentials: "include" },
  );
  if (!response.ok) {
    await parseError(response, fallback);
  }
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = downloadName;
  anchor.click();
  URL.revokeObjectURL(href);
}

function openBudgetReportPath(budgetId: string, pathSuffix: string): void {
  window.open(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/${pathSuffix}`,
    "_blank",
    "noopener,noreferrer",
  );
}

export async function downloadFinancialSummaryCsv(budgetId: string): Promise<void> {
  await downloadBudgetReportBlob(
    budgetId,
    "reports/financial-summary.csv",
    `financial-summary-${budgetId}.csv`,
    "Could not export financial summary CSV.",
  );
}

export function openFinancialSummaryPrint(budgetId: string): void {
  openBudgetReportPath(budgetId, "reports/financial-summary.print");
}

export async function downloadInvoiceRegisterCsv(budgetId: string): Promise<void> {
  await downloadBudgetReportBlob(
    budgetId,
    "reports/invoice-register.csv",
    `invoice-register-${budgetId}.csv`,
    "Could not export invoice register CSV.",
  );
}

export function openInvoiceRegisterPrint(budgetId: string): void {
  openBudgetReportPath(budgetId, "reports/invoice-register.print");
}

/* —— Customer billing (revenue invoices; separate from purchases) —— */

export type InvoiceDisplayStatus =
  | "draft"
  | "issued"
  | "part_paid"
  | "paid"
  | "overdue"
  | "void";

export type PaymentMethod = "bank_transfer" | "card" | "cash" | "cheque" | "other";

export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "card", label: "Card" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];

export type BillingSummaryResponse = {
  budget_id: string;
  company_id: string;
  contract_value_net: string | number | null;
  billing_currency: string | null;
  active_invoiced_net: string | number;
  vat_invoiced: string | number;
  gross_invoiced: string | number;
  payments_received_gross: string | number;
  outstanding_gross: string | number;
  overdue_outstanding_gross: string | number;
  remaining_to_invoice: string | number | null;
  over_invoiced: string | number | null;
  draft_count: number;
  issued_count: number;
  part_paid_count: number;
  paid_count: number;
  overdue_count: number;
  void_count: number;
  active_count: number;
};

export type InvoiceResponse = {
  id: string;
  company_id: string;
  budget_id: string;
  client_action_id: string | null;
  customer_name: string;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  status: string;
  display_status: InvoiceDisplayStatus | string;
  currency: string;
  net_amount: string | number;
  vat_amount: string | number;
  gross_amount: string | number;
  payments_received_gross: string | number;
  outstanding_gross: string | number;
  description: string | null;
  reference: string | null;
  payment_terms: string | null;
  issued_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
  has_document: boolean;
  document_filename: string | null;
  document_content_type: string | null;
  document_version: number | null;
};

export type PaymentResponse = {
  id: string;
  company_id: string;
  budget_id: string;
  invoice_id: string;
  client_action_id: string | null;
  payment_date: string;
  amount: string | number;
  currency: string;
  payment_method: PaymentMethod | string;
  reference: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  created_by_display: string | null;
  created_at: string;
  reversed_at: string | null;
  reversed_by_user_id: string | null;
  reversal_reason: string | null;
  is_reversed: boolean;
};

export type CreatePaymentBody = {
  client_action_id: string;
  payment_date: string;
  amount: string;
  payment_method: PaymentMethod | string;
  reference?: string | null;
  notes?: string | null;
  currency?: string | null;
};

export type ReversePaymentBody = {
  confirm: true;
  reason: string;
};

export type ContractValueUpdateBody = {
  contract_value_net?: string | number | null;
  billing_currency?: string | null;
};

export type CreateInvoiceBody = {
  client_action_id: string;
  customer_name: string;
  invoice_number?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  currency?: string;
  net_amount: string;
  vat_amount?: string;
  gross_amount: string;
  description?: string | null;
  reference?: string | null;
  payment_terms?: string | null;
};

export type PatchInvoiceBody = {
  customer_name?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  currency?: string | null;
  net_amount?: string | null;
  vat_amount?: string | null;
  gross_amount?: string | null;
  description?: string | null;
  reference?: string | null;
  payment_terms?: string | null;
};

export type VoidInvoiceBody = {
  confirm: true;
  reason: string;
};

export async function fetchBillingSummary(budgetId: string): Promise<BillingSummaryResponse> {
  const response = await fetch(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/billing-summary`,
    { method: "GET", credentials: "include" },
  );
  if (!response.ok) {
    await parseError(response, "Could not load billing summary.");
  }
  return response.json() as Promise<BillingSummaryResponse>;
}

export async function updateContractValue(
  budgetId: string,
  body: ContractValueUpdateBody,
): Promise<BillingSummaryResponse> {
  const response = await fetch(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/contract-value`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    await parseError(response, "Could not update contract value.");
  }
  return response.json() as Promise<BillingSummaryResponse>;
}

export async function listBudgetInvoices(budgetId: string): Promise<InvoiceResponse[]> {
  const response = await fetch(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/invoices`,
    { method: "GET", credentials: "include" },
  );
  if (!response.ok) {
    await parseError(response, "Could not load invoices.");
  }
  return response.json() as Promise<InvoiceResponse[]>;
}

export async function getBudgetInvoice(budgetId: string, invoiceId: string): Promise<InvoiceResponse> {
  const response = await fetch(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/invoices/${encodeURIComponent(invoiceId)}`,
    { method: "GET", credentials: "include" },
  );
  if (!response.ok) {
    await parseError(response, "Could not load invoice.");
  }
  return response.json() as Promise<InvoiceResponse>;
}

export async function createBudgetInvoice(
  budgetId: string,
  body: CreateInvoiceBody,
): Promise<InvoiceResponse> {
  const response = await fetch(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/invoices`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    await parseError(response, "Could not create invoice.");
  }
  return response.json() as Promise<InvoiceResponse>;
}

export async function patchBudgetInvoice(
  budgetId: string,
  invoiceId: string,
  body: PatchInvoiceBody,
): Promise<InvoiceResponse> {
  const response = await fetch(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/invoices/${encodeURIComponent(invoiceId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    await parseError(response, "Could not update invoice.");
  }
  return response.json() as Promise<InvoiceResponse>;
}

export async function deleteBudgetInvoice(budgetId: string, invoiceId: string): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/invoices/${encodeURIComponent(invoiceId)}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!response.ok) {
    await parseError(response, "Could not delete invoice.");
  }
}

export async function issueBudgetInvoice(budgetId: string, invoiceId: string): Promise<InvoiceResponse> {
  const response = await fetch(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/invoices/${encodeURIComponent(invoiceId)}/issue`,
    { method: "POST", credentials: "include" },
  );
  if (!response.ok) {
    await parseError(response, "Could not issue invoice.");
  }
  return response.json() as Promise<InvoiceResponse>;
}

export async function voidBudgetInvoice(
  budgetId: string,
  invoiceId: string,
  body: VoidInvoiceBody,
): Promise<InvoiceResponse> {
  const response = await fetch(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/invoices/${encodeURIComponent(invoiceId)}/void`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    await parseError(response, "Could not void invoice.");
  }
  return response.json() as Promise<InvoiceResponse>;
}

export async function uploadBudgetInvoiceDocument(
  budgetId: string,
  invoiceId: string,
  file: File,
): Promise<InvoiceResponse> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/invoices/${encodeURIComponent(invoiceId)}/document`,
    { method: "POST", credentials: "include", body: form },
  );
  if (!response.ok) {
    await parseError(response, "Could not upload invoice document.");
  }
  return response.json() as Promise<InvoiceResponse>;
}

export async function fetchBudgetInvoiceDocumentBlob(
  budgetId: string,
  invoiceId: string,
): Promise<{ blob: Blob; filename: string | null; contentType: string | null }> {
  const response = await fetch(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/invoices/${encodeURIComponent(invoiceId)}/document`,
    { method: "GET", credentials: "include" },
  );
  if (!response.ok) {
    await parseError(response, "Could not download invoice document.");
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition");
  let filename: string | null = null;
  if (disposition) {
    const match = /filename\*?=(?:UTF-8''|")?([^\";]+)"?/i.exec(disposition);
    if (match?.[1]) {
      try {
        filename = decodeURIComponent(match[1].replace(/"/g, "").trim());
      } catch {
        filename = match[1].replace(/"/g, "").trim();
      }
    }
  }
  return {
    blob,
    filename,
    contentType: response.headers.get("Content-Type"),
  };
}

export async function downloadBudgetInvoiceDocument(
  budgetId: string,
  invoiceId: string,
  filenameHint?: string | null,
): Promise<void> {
  const { blob, filename } = await fetchBudgetInvoiceDocumentBlob(budgetId, invoiceId);
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename || filenameHint || `invoice-${invoiceId}`;
  anchor.click();
  URL.revokeObjectURL(href);
}

export async function listInvoicePayments(
  budgetId: string,
  invoiceId: string,
): Promise<PaymentResponse[]> {
  const response = await fetch(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/invoices/${encodeURIComponent(invoiceId)}/payments`,
    { method: "GET", credentials: "include" },
  );
  if (!response.ok) {
    await parseError(response, "Could not load payments.");
  }
  return response.json() as Promise<PaymentResponse[]>;
}

export async function createInvoicePayment(
  budgetId: string,
  invoiceId: string,
  body: CreatePaymentBody,
): Promise<PaymentResponse> {
  const response = await fetch(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/invoices/${encodeURIComponent(invoiceId)}/payments`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    await parseError(response, "Could not record payment.");
  }
  return response.json() as Promise<PaymentResponse>;
}

export async function reverseInvoicePayment(
  budgetId: string,
  invoiceId: string,
  paymentId: string,
  body: ReversePaymentBody,
): Promise<PaymentResponse> {
  const response = await fetch(
    `${API_URL}/api/budgets/${encodeURIComponent(budgetId)}/invoices/${encodeURIComponent(invoiceId)}/payments/${encodeURIComponent(paymentId)}/reverse`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    await parseError(response, "Could not reverse payment.");
  }
  return response.json() as Promise<PaymentResponse>;
}
