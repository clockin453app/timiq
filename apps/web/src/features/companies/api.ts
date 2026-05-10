import { API_URL } from "../../config/api";

export type Company = {
  id: string;
  name: string;
  is_active: boolean;
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