import { API_URL } from "../../config/api";

export type EmployeeProfile = {
  id: string;
  user_id: string;
  company_id: string | null;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  job_title: string | null;
  start_date: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  is_onboarded: boolean;
  early_access_enabled: boolean;
  hourly_rate: string | null;
  tax_rate: string | null;
  created_at: string;
  updated_at: string;
};

export type UpdateMyEmployeeProfileRequest = {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  job_title?: string | null;
  start_date?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  is_onboarded?: boolean;
};

export type PatchManagedEmployeeProfileRequest = {
  early_access_enabled?: boolean;
  hourly_rate?: string | number | null;
  tax_rate?: string | number | null;
};

export async function getMyEmployeeProfile(): Promise<EmployeeProfile> {
  const response = await fetch(`${API_URL}/api/employee-profiles/me`, {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Could not load profile.");
  }

  return response.json() as Promise<EmployeeProfile>;
}

export async function getManagedEmployeeProfile(
  userId: string,
): Promise<EmployeeProfile> {
  const search = new URLSearchParams({ user_id: userId });
  const response = await fetch(
    `${API_URL}/api/employee-profiles?${search.toString()}`,
    {
      method: "GET",
      credentials: "include",
    },
  );

  if (!response.ok) {
    throw new Error("Could not load employee profile.");
  }

  return response.json() as Promise<EmployeeProfile>;
}

export async function patchManagedEmployeeProfile(
  userId: string,
  request: PatchManagedEmployeeProfileRequest,
): Promise<EmployeeProfile> {
  const search = new URLSearchParams({ user_id: userId });
  const response = await fetch(
    `${API_URL}/api/employee-profiles?${search.toString()}`,
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
    throw new Error("Could not update employee profile.");
  }

  return response.json() as Promise<EmployeeProfile>;
}

export async function updateMyEmployeeProfile(
  request: UpdateMyEmployeeProfileRequest,
): Promise<EmployeeProfile> {
  const response = await fetch(`${API_URL}/api/employee-profiles/me`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error("Could not update profile.");
  }

  return response.json() as Promise<EmployeeProfile>;
}
