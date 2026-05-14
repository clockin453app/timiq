import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

export type PrivacyInventorySection = {
  title: string;
  items: string[];
};

export type PrivacyInventory = {
  version: string;
  intro: string;
  sections: PrivacyInventorySection[];
};

export type PrivacyAck = {
  policy_version: string;
  acknowledged_at: string;
};

export type PrivacyAccountSummary = {
  email: string;
  role: string;
  company_name: string | null;
};

export type PrivacyProfileDataCategories = {
  name_contact_stored: boolean;
  job_title_stored: boolean;
  emergency_contact_stored: boolean;
  national_insurance_number_stored: boolean;
  utr_stored: boolean;
};

export type PrivacyTrackingCategories = {
  clock_shift_records_count: number;
  gps_may_be_recorded_at_clock_events: boolean;
  clock_selfie_records_count: number;
  break_records_count: number;
};

export type PrivacyDocumentsCategories = {
  onboarding_document_count: number;
  work_progress_attachment_count: number;
};

export type PrivacyPayrollCategories = {
  payroll_history_item_count: number;
  paid_payroll_records_count: number;
};

export type PrivacyAuditCategories = {
  description: string;
};

export type PrivacyMeSummary = {
  account: PrivacyAccountSummary;
  profile_data_categories: PrivacyProfileDataCategories;
  tracking_categories: PrivacyTrackingCategories;
  documents_categories: PrivacyDocumentsCategories;
  payroll_categories: PrivacyPayrollCategories;
  audit_categories: PrivacyAuditCategories;
  retention_notice: string;
};

export type PrivacyRequestRow = {
  id: string;
  company_id: string | null;
  user_id: string;
  request_type: string;
  status: string;
  subject: string | null;
  message: string;
  admin_response: string | null;
  submitted_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type PrivacyAdminRequestListItem = {
  id: string;
  company_id: string | null;
  user_id: string;
  user_email: string;
  requester_display: string;
  request_type: string;
  status: string;
  subject: string | null;
  submitted_at: string;
  updated_at: string;
};

export type PrivacyAdminRequestDetail = PrivacyRequestRow & {
  user_email: string;
  requester_display: string;
};

async function parseError(response: Response, fallback: string): Promise<never> {
  const detail = await response.json().catch(() => ({}));
  throw new Error(fastApiDetailToMessage((detail as { detail?: unknown }).detail, fallback));
}

function qs(params: Record<string, string | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") {
      s.set(k, v);
    }
  }
  const out = s.toString();
  return out ? `?${out}` : "";
}

export async function fetchPrivacyInventory(): Promise<PrivacyInventory> {
  const response = await fetch(`${API_URL}/api/privacy/inventory`, { credentials: "include" });
  if (!response.ok) {
    await parseError(response, "Could not load privacy information.");
  }
  return response.json() as Promise<PrivacyInventory>;
}

export async function fetchPrivacyMyAck(): Promise<PrivacyAck | null> {
  const response = await fetch(`${API_URL}/api/privacy/my-ack`, { credentials: "include" });
  if (!response.ok) {
    await parseError(response, "Could not load acknowledgement status.");
  }
  const data = (await response.json()) as PrivacyAck | null;
  return data;
}

export async function postPrivacyAck(policyVersion: string): Promise<PrivacyAck> {
  const response = await fetch(`${API_URL}/api/privacy/ack`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ policy_version: policyVersion }),
  });
  if (!response.ok) {
    await parseError(response, "Could not record acknowledgement.");
  }
  return response.json() as Promise<PrivacyAck>;
}

export async function fetchPrivacyMeSummary(): Promise<PrivacyMeSummary> {
  const response = await fetch(`${API_URL}/api/privacy/me/summary`, { credentials: "include" });
  if (!response.ok) {
    await parseError(response, "Could not load your data summary.");
  }
  return response.json() as Promise<PrivacyMeSummary>;
}

export async function fetchPrivacyMyRequests(): Promise<PrivacyRequestRow[]> {
  const response = await fetch(`${API_URL}/api/privacy/me/requests`, { credentials: "include" });
  if (!response.ok) {
    await parseError(response, "Could not load your requests.");
  }
  return response.json() as Promise<PrivacyRequestRow[]>;
}

export async function postPrivacyMyRequest(body: {
  request_type: string;
  subject?: string | null;
  message: string;
}): Promise<PrivacyRequestRow> {
  const response = await fetch(`${API_URL}/api/privacy/me/requests`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await parseError(response, "Could not submit request.");
  }
  return response.json() as Promise<PrivacyRequestRow>;
}

export async function patchPrivacyMyRequestCancel(id: string): Promise<PrivacyRequestRow> {
  const response = await fetch(`${API_URL}/api/privacy/me/requests/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "cancelled" }),
  });
  if (!response.ok) {
    await parseError(response, "Could not cancel request.");
  }
  return response.json() as Promise<PrivacyRequestRow>;
}

export async function fetchPrivacyAdminRequests(companyId: string | null): Promise<PrivacyAdminRequestListItem[]> {
  const q = qs({ company_id: companyId ?? undefined });
  const response = await fetch(`${API_URL}/api/privacy/requests${q}`, { credentials: "include" });
  if (!response.ok) {
    await parseError(response, "Could not load privacy requests.");
  }
  return response.json() as Promise<PrivacyAdminRequestListItem[]>;
}

export async function fetchPrivacyAdminRequestDetail(id: string): Promise<PrivacyAdminRequestDetail> {
  const response = await fetch(`${API_URL}/api/privacy/requests/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not load request.");
  }
  return response.json() as Promise<PrivacyAdminRequestDetail>;
}

export async function patchPrivacyAdminRequest(
  id: string,
  body: { status?: string; admin_response?: string | null },
): Promise<PrivacyAdminRequestDetail> {
  const response = await fetch(`${API_URL}/api/privacy/requests/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await parseError(response, "Could not update request.");
  }
  return response.json() as Promise<PrivacyAdminRequestDetail>;
}

export async function postPrivacyAdminRequestClose(id: string): Promise<PrivacyAdminRequestDetail> {
  const response = await fetch(`${API_URL}/api/privacy/requests/${encodeURIComponent(id)}/close`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    await parseError(response, "Could not close request.");
  }
  return response.json() as Promise<PrivacyAdminRequestDetail>;
}
