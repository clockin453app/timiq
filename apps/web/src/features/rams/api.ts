import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

/** Allowed `section_key` values for RAMS attachments (must match backend). */
export const RAMS_ATTACHMENT_SECTION_KEYS = [
  "cover_image",
  "emergency_plan",
  "site_layout",
  "welfare_area",
  "delivery_area",
  "storage_area",
  "ppe_image",
  "glove_image",
  "method_step",
  "hazard_image",
  "safe_stand",
  "housekeeping",
  "coshh",
  "other",
] as const;

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

export type RamsPresets = {
  hazard_examples: string[];
  ppe_options: string[];
  document_presets: RamsDocumentPreset[];
  assessment_presets?: RamsDocumentPreset[];
};

export type RamsDocumentPreset = {
  id: string;
  title: string;
  work_activity: string;
  description: string;
  risk_level: string;
  ppe: string[];
  hazard_count: number;
  mandatory_gloves?: string[];
  pre_start_checklist?: string[];
  sequence_of_works?: { step?: number; text?: string }[];
  plant_tools?: string[];
  training_requirements?: string[];
  coshh_items?: string[];
  glove_requirements?: string[];
  method_statement_sections?: { title?: string; body?: string }[];
  document_sections?: RamsDocumentSection[];
};

export type RamsDocumentBlock = {
  id: string;
  type: string;
  text?: string | null;
  items?: string[] | null;
  rows?: Record<string, unknown>[] | null;
  columns?: string[] | null;
  section_key?: string | null;
  caption?: string | null;
};

export type RamsDocumentSection = {
  id: string;
  type: string;
  title: string;
  order: number;
  visible_in_pdf: boolean;
  not_applicable: boolean;
  blocks: RamsDocumentBlock[];
};

export type RamsAttachment = {
  id: string;
  assessment_id: string;
  section_key: string;
  hazard_id: string | null;
  method_step_key: string | null;
  caption: string | null;
  original_filename: string;
  content_type: string;
  file_size_bytes: number;
  created_at: string;
  download_href: string;
};

export function ramsAttachmentUrl(attachment: Pick<RamsAttachment, "download_href">): string {
  const href = attachment.download_href;
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return href;
  }
  return `${API_URL}${href}`;
}

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
  source_type?: string;
};

export type RamsUploadedPdfInfo = {
  original_filename: string;
  content_type: string;
  file_size_bytes: number;
  checksum_sha256: string | null;
  version: number;
  uploaded_at: string | null;
  uploaded_by_user_id: string | null;
  download_href: string;
  view_href: string;
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
  signature_method: string;
  manual_signature_note: string | null;
  declined_reason: string | null;
  has_signature: boolean;
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
  source_type?: string;
  uploaded_pdf?: RamsUploadedPdfInfo | null;
  project_name?: string | null;
  client_name?: string | null;
  principal_contractor?: string | null;
  subcontractor_name?: string | null;
  site_address?: string | null;
  revision?: string | null;
  reason_for_issue?: string | null;
  produced_by_name?: string | null;
  checked_by_name?: string | null;
  approved_by_name?: string | null;
  emergency_contact?: string | null;
  site_manager?: string | null;
  first_aider?: string | null;
  fire_marshal?: string | null;
  muster_point?: string | null;
  nearest_hospital?: string | null;
  emergency_arrangements?: string | null;
  site_security?: string | null;
  welfare_arrangements?: string | null;
  public_protection?: string | null;
  deliveries_storage?: string | null;
  scope_of_works?: string | null;
  sequence_of_works?: { step?: number; text?: string }[] | null;
  pre_start_checklist?: string[] | null;
  plant_tools?: string[] | null;
  training_requirements?: string[] | null;
  coshh_items?: string[] | null;
  glove_requirements?: string[] | null;
  method_statement_sections?: { title?: string; body?: string }[] | null;
  document_sections?: RamsDocumentSection[] | null;
  hazards: RamsHazard[];
  acknowledgements: RamsAcknowledgement[];
  attachments?: RamsAttachment[];
  signoff_progress?: {
    total_assigned: number;
    pending: number;
    acknowledged: number;
    declined: number;
  } | null;
  reading_progress?: RamsReadingProgress | null;
  reading_required?: boolean;
};

export type RamsReadingProgress = {
  assessment_id: string;
  document_source_type: string;
  document_version: number;
  document_sha256: string;
  total_pages: number | null;
  viewed_pages: number[];
  viewed_count: number;
  highest_page_reached: number;
  status: "not_started" | "in_progress" | "completed" | string;
  started_at: string | null;
  completed_at: string | null;
  first_unread_page: number | null;
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
  document_sections?: RamsDocumentSection[] | null;
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
  project_name: string | null;
  client_name: string | null;
  principal_contractor: string | null;
  subcontractor_name: string | null;
  site_address: string | null;
  revision: string | null;
  reason_for_issue: string | null;
  produced_by_name: string | null;
  checked_by_name: string | null;
  approved_by_name: string | null;
  emergency_contact: string | null;
  site_manager: string | null;
  first_aider: string | null;
  fire_marshal: string | null;
  muster_point: string | null;
  nearest_hospital: string | null;
  emergency_arrangements: string | null;
  site_security: string | null;
  welfare_arrangements: string | null;
  public_protection: string | null;
  deliveries_storage: string | null;
  scope_of_works: string | null;
  sequence_of_works: { step?: number; text?: string }[] | null;
  pre_start_checklist: string[] | null;
  plant_tools: string[] | null;
  training_requirements: string[] | null;
  coshh_items: string[] | null;
  glove_requirements: string[] | null;
  method_statement_sections: { title?: string; body?: string }[] | null;
  document_sections: RamsDocumentSection[] | null;
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

export type RamsBulkScope = "company" | "site";

export type RamsBulkPreview = {
  scope: RamsBulkScope;
  total_eligible: number;
  already_assigned: number;
  will_add: number;
  ineligible: number;
  site_id: string | null;
};

export type RamsBulkAssignResult = {
  scope: RamsBulkScope;
  total_eligible: number;
  added: number;
  skipped_already_assigned: number;
  ineligible: number;
  site_id: string | null;
};

export type RamsAcknowledgeBody = {
  read_understood_ack: boolean;
  acknowledgement_name: string;
  signature_image_data: string;
};

export type RamsManualSignBody = {
  acknowledgement_name: string;
  manual_signature_note?: string | null;
};

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

export type RamsFromPresetBody = {
  preset_id: string;
  company_id?: string | null;
  location_id?: string | null;
  review_due_date?: string | null;
  reference?: string | null;
  project_name?: string | null;
  client_name?: string | null;
  principal_contractor?: string | null;
  subcontractor_name?: string | null;
  site_address?: string | null;
};

export async function createRamsFromPreset(body: RamsFromPresetBody): Promise<RamsAssessmentDetail> {
  const response = await fetch(`${API_URL}/api/rams/from-preset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not create RAMS from preset."));
  }
  return response.json() as Promise<RamsAssessmentDetail>;
}

export type UploadRamsPdfFields = {
  title: string;
  company_id?: string | null;
  location_id?: string | null;
  description?: string | null;
  work_activity?: string | null;
  risk_level?: string;
  review_due_date?: string | null;
  produced_by_name?: string | null;
  notes?: string | null;
};

export async function uploadRamsPdf(file: File, fields: UploadRamsPdfFields): Promise<RamsAssessmentDetail> {
  const form = new FormData();
  form.append("file", file);
  form.append("title", fields.title);
  if (fields.company_id) form.append("company_id", fields.company_id);
  if (fields.location_id) form.append("location_id", fields.location_id);
  if (fields.description) form.append("description", fields.description);
  if (fields.work_activity) form.append("work_activity", fields.work_activity);
  if (fields.risk_level) form.append("risk_level", fields.risk_level);
  if (fields.review_due_date) form.append("review_due_date", fields.review_due_date);
  if (fields.produced_by_name) form.append("produced_by_name", fields.produced_by_name);
  if (fields.notes) form.append("notes", fields.notes);
  const response = await fetch(`${API_URL}/api/rams/upload-pdf`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not upload RAMS PDF."));
  }
  return response.json() as Promise<RamsAssessmentDetail>;
}

export async function replaceUploadedRamsPdf(assessmentId: string, file: File): Promise<RamsAssessmentDetail> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/uploaded-pdf`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not replace RAMS PDF."));
  }
  return response.json() as Promise<RamsAssessmentDetail>;
}

/** Absolute API view URL — do not use as iframe src across origins (cookies may not be sent). */
export function ramsUploadedPdfViewUrl(assessmentId: string): string {
  return `${API_URL}/api/rams/${assessmentId}/uploaded-pdf/view`;
}

/** Authenticated PDF bytes for inline preview / new-tab open (session cookie via credentials). */
export async function fetchUploadedRamsPdfBlob(assessmentId: string): Promise<Blob> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/uploaded-pdf/view`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load uploaded RAMS PDF preview."));
  }
  return response.blob();
}

/** Open authenticated preview in a new tab using a temporary object URL (revoked after a delay). */
export async function openUploadedRamsPdfInNewTab(assessmentId: string): Promise<void> {
  const blob = await fetchUploadedRamsPdfBlob(assessmentId);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadUploadedRamsPdf(assessmentId: string, filenameHint?: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/uploaded-pdf`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not download uploaded RAMS PDF."));
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = (filenameHint || `rams-${assessmentId}.pdf`).replace(/[^\w.-]+/g, "_").slice(0, 120);
  a.download = safe.endsWith(".pdf") ? safe : `${safe}.pdf`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

export async function uploadRamsAttachment(
  assessmentId: string,
  opts: { file: File; sectionKey: string; caption?: string | null; hazardId?: string | null; methodStepKey?: string | null },
): Promise<RamsAssessmentDetail> {
  const fd = new FormData();
  fd.set("file", opts.file);
  fd.set("section_key", opts.sectionKey);
  if (opts.caption) {
    fd.set("caption", opts.caption);
  }
  if (opts.hazardId) {
    fd.set("hazard_id", opts.hazardId);
  }
  if (opts.methodStepKey) {
    fd.set("method_step_key", opts.methodStepKey);
  }
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/attachments`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not upload RAMS attachment."));
  }
  return response.json() as Promise<RamsAssessmentDetail>;
}

export async function deleteRamsAttachment(assessmentId: string, attachmentId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/attachments/${attachmentId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not delete attachment."));
  }
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

export async function previewBulkRamsAcknowledgements(
  assessmentId: string,
  scope: RamsBulkScope,
): Promise<RamsBulkPreview> {
  const q = new URLSearchParams({ scope });
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/acknowledgements/bulk-preview?${q}`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not preview bulk assignment."));
  }
  return response.json() as Promise<RamsBulkPreview>;
}

export async function bulkAssignRamsAcknowledgements(
  assessmentId: string,
  scope: RamsBulkScope,
): Promise<RamsBulkAssignResult> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/acknowledgements/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ scope }),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not assign employees."));
  }
  return response.json() as Promise<RamsBulkAssignResult>;
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

export async function getRamsReadingProgress(assessmentId: string): Promise<RamsReadingProgress> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/reading-progress`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load reading progress."));
  }
  return response.json() as Promise<RamsReadingProgress>;
}

export async function startRamsReadingProgress(assessmentId: string): Promise<RamsReadingProgress> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/reading-progress/start`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not start reading progress."));
  }
  return response.json() as Promise<RamsReadingProgress>;
}

export async function reportRamsReadingPage(
  assessmentId: string,
  pageNumber: number,
): Promise<RamsReadingProgress> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/reading-progress/pages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ page_number: pageNumber }),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not save reading progress."));
  }
  return response.json() as Promise<RamsReadingProgress>;
}

export async function manualSignRamsAcknowledgement(
  assessmentId: string,
  userId: string,
  body: RamsManualSignBody,
): Promise<RamsAssessmentDetail> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/acknowledgements/${userId}/manual-sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not record manual signature."));
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

export async function downloadRamsPdf(assessmentId: string, referenceOrId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}/pdf`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not download PDF."));
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = referenceOrId.replace(/[^\w.-]+/g, "_").slice(0, 80);
  a.download = `rams-${safe || assessmentId}.pdf`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function deleteRams(assessmentId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/rams/${assessmentId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not delete RAMS."));
  }
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
