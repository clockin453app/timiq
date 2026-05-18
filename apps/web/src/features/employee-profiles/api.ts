import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

export type EmployeeProfile = {
  id: string;
  user_id: string;
  company_id: string | null;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  job_title: string | null;
  national_insurance_number?: string | null;
  utr_number?: string | null;
  start_date: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  is_onboarded: boolean;
  early_access_enabled: boolean;
  hourly_rate: string | null;
  tax_rate: string | null;
  payment_mode: "net_payment" | "gross_payment" | null;
  payroll_type: "cis_subcontractor" | "paye_employee";
  face_check_consent_at?: string | null;
  face_reference_enrolled_at?: string | null;
  face_reference_updated_at?: string | null;
  face_reference_configured?: boolean;
  created_at: string;
  updated_at: string;
};

export type FaceReferenceStatus = {
  face_check_consent_at: string | null;
  face_reference_enrolled_at: string | null;
  face_reference_updated_at: string | null;
  face_reference_configured: boolean;
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
  job_title?: string | null;
  national_insurance_number?: string | null;
  utr_number?: string | null;
  early_access_enabled?: boolean;
  hourly_rate?: string | number | null;
  tax_rate?: string | number | null;
  payment_mode?: "net_payment" | "gross_payment" | null;
  payroll_type?: "cis_subcontractor" | "paye_employee" | null;
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

export async function enrollMyFaceReference(
  consent: boolean,
  image: File,
): Promise<FaceReferenceStatus> {
  const body = new FormData();
  body.append("consent", consent ? "true" : "false");
  body.append("image", image, image.name);

  const response = await fetch(`${API_URL}/api/employee-profiles/me/face-reference`, {
    method: "POST",
    credentials: "include",
    body,
  });

  if (!response.ok) {
    let detail = "Could not save face reference.";
    try {
      const parsed = (await response.json()) as { detail?: unknown };
      detail = fastApiDetailToMessage(parsed.detail, detail);
    } catch {
      // keep fallback
    }
    throw new Error(detail);
  }

  return response.json() as Promise<FaceReferenceStatus>;
}

export async function removeMyFaceReference(): Promise<FaceReferenceStatus> {
  const response = await fetch(`${API_URL}/api/employee-profiles/me/face-reference`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    let detail = "Could not remove face reference.";
    try {
      const parsed = (await response.json()) as { detail?: unknown };
      detail = fastApiDetailToMessage(parsed.detail, detail);
    } catch {
      // keep fallback
    }
    throw new Error(detail);
  }

  return response.json() as Promise<FaceReferenceStatus>;
}
