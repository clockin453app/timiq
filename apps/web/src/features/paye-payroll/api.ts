import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

export type PayrollType = "cis_subcontractor" | "paye_employee";
export type SalaryType = "fixed_monthly_salary" | "hourly";
export type TaxBasis = "cumulative" | "month1";
export type StudentLoanPlan = "none" | "plan_1" | "plan_2" | "plan_4" | "plan_5";
export type PensionEnrolmentStatus = "eligible" | "enrolled" | "opted_out" | "postponed" | "not_eligible";
export type PensionSchemeBasis = "qualifying_earnings" | "total_earnings";
export type PensionReliefMethod = "relief_at_source" | "net_pay_arrangement" | "salary_sacrifice";

export type EmployeePayeSettings = {
  user_id: string;
  company_id: string;
  pay_frequency: "monthly";
  salary_type: SalaryType;
  monthly_salary: string | null;
  tax_code: string | null;
  tax_basis: TaxBasis;
  ni_category: string | null;
  student_loan_plan: StudentLoanPlan;
  postgraduate_loan: boolean;
  pension_enrolment_status: PensionEnrolmentStatus;
  employee_pension_percent: string | null;
  employer_pension_percent: string | null;
  pension_scheme_basis: PensionSchemeBasis;
  pension_relief_method: PensionReliefMethod;
  created_at: string;
  updated_at: string;
};

export type PatchEmployeePayeSettingsRequest = Partial<{
  pay_frequency: "monthly";
  salary_type: SalaryType;
  monthly_salary: string | number | null;
  tax_code: string | null;
  tax_basis: TaxBasis;
  ni_category: string | null;
  student_loan_plan: StudentLoanPlan;
  postgraduate_loan: boolean;
  pension_enrolment_status: PensionEnrolmentStatus;
  employee_pension_percent: string | number | null;
  employer_pension_percent: string | number | null;
  pension_scheme_basis: PensionSchemeBasis;
  pension_relief_method: PensionReliefMethod;
}>;

export type CompanyPayeSettings = {
  company_id: string;
  paye_reference: string | null;
  accounts_office_reference: string | null;
  pension_provider_name: string | null;
  default_employee_pension_percent: string | null;
  default_employer_pension_percent: string | null;
  default_pension_basis: PensionSchemeBasis;
  monthly_payday_rule: string | null;
  pay_period_closing_day: number | null;
  default_tax_year: string | null;
  rti_status: string;
  created_at: string;
  updated_at: string;
};

export type MonthlyPayeReportShellRow = {
  user_id: string;
  employee_email: string;
  employee_name: string | null;
  payroll_type: PayrollType | string;
  tax_code: string | null;
  ni_category: string | null;
  status: string;
};

export type MonthlyPayePeriod = {
  id: string;
  company_id: string;
  tax_year: string;
  tax_month: number;
  period_start: string;
  period_end: string;
  pay_date: string;
  status: "pending" | "approved" | "paid" | string;
  calculated_at: string | null;
  approved_at: string | null;
  paid_at: string | null;
};

export type MonthlyPayeItem = {
  id: string;
  period_id: string;
  company_id: string;
  user_id: string;
  employee_email: string | null;
  employee_name: string | null;
  payroll_type: string;
  pay_frequency: string;
  salary_type: string;
  monthly_salary: string | null;
  tax_code: string | null;
  tax_basis: string;
  ni_category: string | null;
  student_loan_plan: string;
  postgraduate_loan: boolean;
  pension_enrolment_status: string;
  gross_pay: string | null;
  taxable_pay: string | null;
  niable_pay: string | null;
  pensionable_pay: string | null;
  paye_tax: string | null;
  employee_ni: string | null;
  employer_ni: string | null;
  employee_pension: string | null;
  employer_pension: string | null;
  student_loan: string | null;
  postgraduate_loan_deduction: string | null;
  total_deductions: string | null;
  net_pay: string | null;
  status: "pending" | "approved" | "paid" | string;
  unsupported_reason: string | null;
};

export type MonthlyPayeSummary = {
  employees: number;
  total_gross: string;
  taxable_pay: string;
  paye_tax: string;
  employee_ni: string;
  employer_ni: string;
  employee_pension: string;
  employer_pension: string;
  student_loans: string;
  postgraduate_loans: string;
  total_deductions: string;
  net_pay: string;
  unsupported_count: number;
};

export type MonthlyPayeReport = {
  company_id: string;
  tax_year: string;
  tax_month: number;
  calculation_enabled: boolean;
  message: string;
  company_settings_configured: boolean;
  period: MonthlyPayePeriod | null;
  rows: MonthlyPayeItem[];
  summary: MonthlyPayeSummary;
};

export type PayeCapabilityStatus = "enabled" | "disabled" | "coming_soon" | "not_supported";

export type PayeCapability = {
  key: string;
  name: string;
  category: string;
  status: PayeCapabilityStatus;
  tax_years_supported: string[];
  source_note: string;
  description: string;
  unsupported_message: string | null;
};

export type PayeCapabilityCategory = {
  category: string;
  capabilities: PayeCapability[];
};

export type PayeCapabilitiesResponse = {
  tax_year: string;
  categories: PayeCapabilityCategory[];
};

function qs(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, value);
    }
  }
  const value = search.toString();
  return value ? `?${value}` : "";
}

async function parseError(response: Response, fallback: string): Promise<never> {
  const detail = await response.json().catch(() => ({}));
  throw new Error(fastApiDetailToMessage((detail as { detail?: unknown }).detail, fallback));
}

export async function getEmployeePayeSettings(userId: string): Promise<EmployeePayeSettings> {
  const response = await fetch(`${API_URL}/api/paye-payroll/employee-settings/${userId}`, {
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not load PAYE employee settings.");
  }
  return response.json() as Promise<EmployeePayeSettings>;
}

export async function fetchPayeCapabilities(): Promise<PayeCapabilitiesResponse> {
  const response = await fetch(`${API_URL}/api/paye-payroll/capabilities`, {
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not load PAYE capability coverage.");
  }
  return response.json() as Promise<PayeCapabilitiesResponse>;
}

export async function patchEmployeePayeSettings(
  userId: string,
  request: PatchEmployeePayeSettingsRequest,
): Promise<EmployeePayeSettings> {
  const response = await fetch(`${API_URL}/api/paye-payroll/employee-settings/${userId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    await parseError(response, "Could not save PAYE employee settings.");
  }
  return response.json() as Promise<EmployeePayeSettings>;
}

export async function getCompanyPayeSettings(companyId?: string | null): Promise<CompanyPayeSettings> {
  const response = await fetch(
    `${API_URL}/api/paye-payroll/company-settings${qs({ company_id: companyId || undefined })}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    await parseError(response, "Could not load PAYE company settings.");
  }
  return response.json() as Promise<CompanyPayeSettings>;
}

export async function patchCompanyPayeSettings(
  request: Partial<
    Pick<
      CompanyPayeSettings,
      | "company_id"
      | "paye_reference"
      | "accounts_office_reference"
      | "pension_provider_name"
      | "default_employee_pension_percent"
      | "default_employer_pension_percent"
      | "default_pension_basis"
      | "monthly_payday_rule"
      | "pay_period_closing_day"
      | "default_tax_year"
      | "rti_status"
    >
  >,
): Promise<CompanyPayeSettings> {
  const response = await fetch(`${API_URL}/api/paye-payroll/company-settings`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    await parseError(response, "Could not save PAYE company settings.");
  }
  return response.json() as Promise<CompanyPayeSettings>;
}

export async function fetchMonthlyPayeReportShell(params: {
  companyId?: string | null;
  taxYear?: string;
  taxMonth?: number;
  employeeUserId?: string | null;
}): Promise<MonthlyPayeReport> {
  const response = await fetch(
    `${API_URL}/api/paye-payroll/monthly-report${qs({
      company_id: params.companyId || undefined,
      tax_year: params.taxYear || "2026-2027",
      tax_month: params.taxMonth ? String(params.taxMonth) : undefined,
      employee_id: params.employeeUserId || undefined,
    })}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    await parseError(response, "Could not load Monthly PAYE Report.");
  }
  return response.json() as Promise<MonthlyPayeReport>;
}

export async function recalculateMonthlyPaye(params: {
  companyId?: string | null;
  taxYear: string;
  taxMonth: number;
}): Promise<MonthlyPayeReport> {
  const response = await fetch(`${API_URL}/api/paye-payroll/monthly-report/recalculate`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company_id: params.companyId || undefined,
      tax_year: params.taxYear,
      tax_month: params.taxMonth,
    }),
  });
  if (!response.ok) {
    await parseError(response, "Could not recalculate Monthly PAYE Report.");
  }
  return response.json() as Promise<MonthlyPayeReport>;
}

export async function approveMonthlyPayePeriod(periodId: string): Promise<MonthlyPayeReport> {
  const response = await fetch(`${API_URL}/api/paye-payroll/periods/${periodId}/approve`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not approve Monthly PAYE period.");
  }
  return response.json() as Promise<MonthlyPayeReport>;
}

export async function markMonthlyPayePeriodPaid(periodId: string): Promise<MonthlyPayeReport> {
  const response = await fetch(`${API_URL}/api/paye-payroll/periods/${periodId}/mark-paid`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not mark Monthly PAYE period paid.");
  }
  return response.json() as Promise<MonthlyPayeReport>;
}
