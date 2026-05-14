import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

type ErrorBody = { detail?: unknown };

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as ErrorBody;
    if (parsed.detail != null) {
      return fastApiDetailToMessage(parsed.detail, fallback);
    }
  } catch {
    // ignore
  }
  return fallback;
}

export type RamsPresets = { hazard_examples: string[]; ppe_options: string[] };

export type RamsAssessmentListItem = {
  id: string;
  company_id: string;
  location_id: string | null;
  title: string;
  reference: string | null;
  work_activity: string;
  status: string;
  risk_level: string;
  review_due_date: string | null;
  published_at: string | null;
  reviewed_at: string | null;
  updated_at: string;
  my_ack_status: string | null;
};

export type RamsHazard = {
  id: string;
  assessment_id: string;
  hazard: string;
  who_might_be_harmed: string | null;
  initial_likelihood: number;
  initial_severity: number;
  initial_risk_score: number;
  initial_risk_band: string;
  control_measures: string;
  residual_likelihood: number;
  residual_severity: number;
  residual_risk_score: number;
  residual_risk_band: string;
  residual_higher_than_initial: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type RamsAcknowledgement = {
  user_id: string;
  user_email: string | null;
  display_name: string | null;
  status: string;
  acknowledged_at: string | null;
  acknowledgement_name: string | null;
  declined_reason: string | null;
};

export type RamsAssessmentDetail = {
  id: string;
  company_id: string;
  location_id: string | null;
  title: string;
  reference: string | null;
  work_activity: string;
  description: string | null;
  status: string;
  risk_level: string;
  review_due_date: string | null;
  ppe_json: string[];
  no_special_ppe: boolean;
  created_by_user_id: string | null;
  reviewed_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  reviewed_at: string | null;
  archived_at: string | null;
  hazards: RamsHazard[];
  acknowledgements: RamsAcknowledgement[];
};

export type RamsCreateBody = {
  company_id?: string | null;
  title: string;
  reference?: string | null;
  work_activity: string;
  description?: string | null;
  location_id?: string | null;
  risk_level?: string;
  review_due_date?: string | null;
  ppe_json?: string[];
  no_special_ppe?: boolean;
};

export type RamsPatchBody = Partial<{
  title: string;
  reference: string | null;
  work_activity: string;
  description: string | null;
  location_id: string | null;
  risk_level: string;
  review_due_date: string | null;
  ppe_json: string[];
  no_special_ppe: boolean;
}>;

export type RamsHazardCreateBody = {
  hazard: string;
  who_might_be_harmed?: string | null;
  initial_likelihood: number;
  initial_severity: number;
  control_measures: string;
  residual_likelihood: number;
  residual_severity: number;
};

export type RamsHazardPatchBody = Partial<RamsHazardCreateBody>;

export type RamsAcknowledgementsAddBody = { user_ids: string[]; all_site_users?: boolean };

export type RamsAcknowledgeBody = { read_understood_ack: boolean; acknowledgement_name: string };

export async function getRamsPresets(): Promise<RamsPresets> {
  const response = await fetch(`${API_URL}/api/rams/presets`, { method: "GET", credentials: "include" });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load RAMS presets."));
  }
  return response.json() as Promise<RamsPresets>;
}

export async function listMyRams(): Promise<RamsAssessmentListItem[]> {
  const response = await fetch(`${API_URL}/api/rams/me`, { method: "GET", credentials: "include" });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load RAMS."));
  }
  return response.json() as Promise<RamsAssessmentListItem[]>;
}

export type ListRamsAdminParams = {
  companyId?: string | null;
  status?: string | null;
  locationId?: string | null;
  riskLevel?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
};

export async function listRamsAdmin(params: ListRamsAdminParams = {}): Promise<RamsAssessmentListItem[]> {
  const q = new URLSearchParams();
  if (params.companyId) {
    q.set("company_id", params.companyId);
  }
  if (params.status) {
    q.set("status", params.status);
  }
  if (params.locationId) {
    q.set("location_id", params.locationId);
  }
  if (params.riskLevel) {
    q.set("risk_level", params.riskLevel);
  }
  if (params.dateFrom) {
    q.set("date_from", params.dateFrom);
  }
  if (params.dateTo) {
    q.set("date_to", params.dateTo);
  }
  const qs = q.toString();
  const response = await fetch(`${API_URL}/api/rams${qs ? `?${qs}` : ""}`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load RAMS assessments."));
  }
  return response.json() as Promise<RamsAssessmentListItem[]>;
}

export async function createRams(body: RamsCreateBody): Promise<RamsAssessmentDetail> {
  const response = await fetch(`${API_URL}/api/rams`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not create RAMS."));
  }
  return response.json() as Promise<RamsAssessmentDetail>;
}

export async function getRams(assessmentId: string): Promise<RamsAssessmentDetail> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load RAMS."));
  }
  return response.json() as Promise<RamsAssessmentDetail>;
}

export async function patchRams(assessmentId: string, body: RamsPatchBody): Promise<RamsAssessmentDetail> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not update RAMS."));
  }
  return response.json() as Promise<RamsAssessmentDetail>;
}

export async function publishRams(assessmentId: string): Promise<RamsAssessmentDetail> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/publish`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not publish RAMS."));
  }
  return response.json() as Promise<RamsAssessmentDetail>;
}

export async function reviewRams(assessmentId: string): Promise<RamsAssessmentDetail> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/review`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not mark reviewed."));
  }
  return response.json() as Promise<RamsAssessmentDetail>;
}

export async function archiveRams(assessmentId: string): Promise<RamsAssessmentDetail> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/archive`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not archive RAMS."));
  }
  return response.json() as Promise<RamsAssessmentDetail>;
}

export async function createRamsHazard(
  assessmentId: string,
  body: RamsHazardCreateBody,
): Promise<RamsHazard> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/hazards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not add hazard."));
  }
  return response.json() as Promise<RamsHazard>;
}

export async function patchRamsHazard(
  assessmentId: string,
  hazardId: string,
  body: RamsHazardPatchBody,
): Promise<RamsHazard> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/hazards/${hazardId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not update hazard."));
  }
  return response.json() as Promise<RamsHazard>;
}

export async function deleteRamsHazard(assessmentId: string, hazardId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/hazards/${hazardId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not delete hazard."));
  }
}

export async function addRamsAcknowledgements(
  assessmentId: string,
  body: RamsAcknowledgementsAddBody,
): Promise<RamsAssessmentDetail> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/acknowledgements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not update acknowledgements."));
  }
  return response.json() as Promise<RamsAssessmentDetail>;
}

export async function acknowledgeRams(assessmentId: string, body: RamsAcknowledgeBody): Promise<RamsAssessmentDetail> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/acknowledge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not acknowledge RAMS."));
  }
  return response.json() as Promise<RamsAssessmentDetail>;
}

export async function declineRams(assessmentId: string, reason: string): Promise<RamsAssessmentDetail> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/decline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ reason }),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not decline RAMS."));
  }
  return response.json() as Promise<RamsAssessmentDetail>;
}

export function openRamsPrint(assessmentId: string): void {
  window.open(`${API_URL}/api/rams/${assessmentId}/print`, "_blank", "noopener,noreferrer");
}

export async function downloadRamsCsv(assessmentId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/export.csv`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not export CSV."));
  }
  const blob = await response.blob();
  const cd = response.headers.get("Content-Disposition");
  let filename = `rams-${assessmentId}.csv`;
  if (cd) {
    const m = /filename="?([^";]+)"?/i.exec(cd);
    if (m?.[1]) {
      filename = m[1];
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
