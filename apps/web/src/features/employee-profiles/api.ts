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
