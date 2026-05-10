import { API_URL } from "../../config/api";

export type Workplace = {
  id: string;
  company_id: string;
  name: string;
  code: string | null;
  address: string | null;
  is_active: boolean;
  tax_rate?: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateWorkplaceRequest = {
  company_id?: string | null;
  name: string;
  code?: string | null;
  address?: string | null;
  is_active: boolean;
};

export async function listWorkplaces(): Promise<Workplace[]> {
  const response = await fetch(`${API_URL}/api/workplaces`, {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Could not load workplaces.");
  }

  return response.json() as Promise<Workplace[]>;
}

export async function createWorkplace(
  request: CreateWorkplaceRequest,
): Promise<Workplace> {
  const response = await fetch(`${API_URL}/api/workplaces`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (response.status === 403) {
    throw new Error("You do not have permission to create workplaces.");
  }

  if (response.status === 404) {
    throw new Error("Company was not found.");
  }

  if (response.status === 409) {
    throw new Error("A workplace with this name already exists.");
  }

  if (!response.ok) {
    throw new Error("Could not create workplace.");
  }

  return response.json() as Promise<Workplace>;
}

export type PatchWorkplaceTaxRequest = {
  tax_rate: string | number | null;
};

export async function patchWorkplaceTax(
  workplaceId: string,
  request: PatchWorkplaceTaxRequest,
): Promise<Workplace> {
  const response = await fetch(`${API_URL}/api/workplaces/${workplaceId}/tax`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error("Could not update workplace tax rate.");
  }

  return response.json() as Promise<Workplace>;
}

export async function updateWorkplaceStatus(
  workplaceId: string,
  isActive: boolean,
): Promise<Workplace> {
  const response = await fetch(`${API_URL}/api/workplaces/${workplaceId}/status`, {
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
    throw new Error("You do not have permission to update this workplace.");
  }

  if (response.status === 404) {
    throw new Error("Workplace was not found.");
  }

  if (!response.ok) {
    throw new Error("Could not update workplace.");
  }

  return response.json() as Promise<Workplace>;
}
