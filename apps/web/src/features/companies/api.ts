import { API_URL } from "../../config/api";

export type Company = {
  id: string;
  name: string;
  is_active: boolean;
  default_tax_rate?: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateCompanyRequest = {
  name: string;
  is_active: boolean;
};

export type UpdateCompanyRequest = {
  name: string;
};

export async function listCompanies(): Promise<Company[]> {
  const response = await fetch(`${API_URL}/api/companies`, {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Could not load companies.");
  }

  return response.json() as Promise<Company[]>;
}

export async function createCompany(
  request: CreateCompanyRequest,
): Promise<Company> {
  const response = await fetch(`${API_URL}/api/companies`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (response.status === 403) {
    throw new Error("Only an Administrator can create companies.");
  }

  if (response.status === 409) {
    throw new Error("A company with this name already exists.");
  }

  if (!response.ok) {
    throw new Error("Could not create company.");
  }

  return response.json() as Promise<Company>;
}

export async function updateCompany(
  companyId: string,
  request: UpdateCompanyRequest,
): Promise<Company> {
  const response = await fetch(`${API_URL}/api/companies/${companyId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (response.status === 403) {
    throw new Error("Only an Administrator can update companies.");
  }

  if (response.status === 404) {
    throw new Error("Company was not found.");
  }

  if (response.status === 409) {
    throw new Error("A company with this name already exists.");
  }

  if (!response.ok) {
    throw new Error("Could not update company.");
  }

  return response.json() as Promise<Company>;
}

export type CompanyTimePolicy = {
  company_id: string;
  standard_start_time: string;
  overtime_after_hours: number;
  overtime_multiplier: number;
  rounding_increment_minutes: number;
  rounding_mode: string;
  break_deduction_minutes: number;
  break_deduction_after_minutes?: number | null;
  rule_effective_from: string;
  rule_note: string;
  timezone: string;
  created_at: string;
  updated_at: string;
};

export type PatchCompanyTimePolicyRequest = {
  standard_start_time?: string;
  overtime_after_hours?: number;
  overtime_multiplier?: number;
  rounding_increment_minutes?: number;
  rounding_mode?: string;
  break_deduction_minutes?: number;
  break_deduction_after_minutes?: number | null;
  rule_effective_from?: string;
  rule_note?: string;
  timezone?: string;
};

export async function getCompanyTimePolicy(
  companyId: string,
): Promise<CompanyTimePolicy> {
  const response = await fetch(
    `${API_URL}/api/companies/${companyId}/time-policy`,
    {
      method: "GET",
      credentials: "include",
    },
  );

  if (!response.ok) {
    throw new Error("Could not load time policy.");
  }

  return response.json() as Promise<CompanyTimePolicy>;
}

export async function patchCompanyTimePolicy(
  companyId: string,
  request: PatchCompanyTimePolicyRequest,
): Promise<CompanyTimePolicy> {
  const response = await fetch(
    `${API_URL}/api/companies/${companyId}/time-policy`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(request),
    },
  );

  if (!response.ok) {
    throw new Error("Could not save time policy.");
  }

  return response.json() as Promise<CompanyTimePolicy>;
}

export type PatchCompanyPayrollTaxRequest = {
  default_tax_rate: string | number | null;
};

export async function patchCompanyPayrollTax(
  companyId: string,
  request: PatchCompanyPayrollTaxRequest,
): Promise<Company> {
  const response = await fetch(`${API_URL}/api/companies/${companyId}/payroll-tax`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error("Could not update company default tax rate.");
  }

  return response.json() as Promise<Company>;
}

export async function updateCompanyStatus(
  companyId: string,
  isActive: boolean,
): Promise<Company> {
  const response = await fetch(`${API_URL}/api/companies/${companyId}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      is_active: isActive,
    }),
  });

  if (response.status === 403) {
    throw new Error("Only an Administrator can update company status.");
  }

  if (response.status === 404) {
    throw new Error("Company was not found.");
  }

  if (response.status === 409) {
    throw new Error(
      "Deactivate all users in this company before deactivating the company.",
    );
  }

  if (!response.ok) {
    throw new Error("Could not update company status.");
  }

  return response.json() as Promise<Company>;
}