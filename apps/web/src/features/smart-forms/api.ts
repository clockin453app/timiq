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

export type SmartFormTemplate = {
  id: string;
  company_id: string | null;
  name: string;
  description: string | null;
  category: string;
  status: string;
  version: number;
  schema_json: SmartFormSchemaJson;
  requires_location: boolean;
  requires_signature: boolean;
  allow_photos: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type SmartFormFieldDef = {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
};

export type SmartFormSectionDef = {
  id: string;
  title: string;
  fields: SmartFormFieldDef[];
};

export type SmartFormSchemaJson = {
  sections: SmartFormSectionDef[];
};

export type SmartFormSubmission = {
  id: string;
  template_id: string;
  company_id: string;
  submitted_by_user_id: string;
  location_id: string | null;
  status: string;
  answers_json: Record<string, unknown>;
  submitted_at: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  signature_name: string | null;
  has_signature: boolean;
  created_at: string;
  updated_at: string;
};

export type SmartFormSubmissionWithTemplate = SmartFormSubmission & {
  template_name: string;
  template_category: string;
};

export type SmartFormTemplateCreateBody = {
  company_id?: string | null;
  name: string;
  description?: string | null;
  category: string;
  status?: string;
  schema_json: SmartFormSchemaJson;
  requires_location?: boolean;
  requires_signature?: boolean;
  allow_photos?: boolean;
};

export type SmartFormTemplatePatchBody = Partial<{
  name: string;
  description: string | null;
  category: string;
  status: string;
  schema_json: SmartFormSchemaJson;
  requires_location: boolean;
  requires_signature: boolean;
  allow_photos: boolean;
}>;

export type SmartFormReviewQueueItem = {
  id: string;
  template_id: string;
  template_name: string;
  template_category: string;
  company_id: string;
  submitted_by_user_id: string;
  submitter_email: string;
  submitter_display: string | null;
  location_id: string | null;
  location_name: string | null;
  status: string;
  submitted_at: string | null;
  updated_at: string;
};

export async function listSmartFormTemplates(): Promise<SmartFormTemplate[]> {
  const response = await fetch(`${API_URL}/api/smart-forms/templates`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load form templates."));
  }
  return response.json() as Promise<SmartFormTemplate[]>;
}

export async function getSmartFormTemplate(templateId: string): Promise<SmartFormTemplate> {
  const response = await fetch(`${API_URL}/api/smart-forms/templates/${templateId}`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load template."));
  }
  return response.json() as Promise<SmartFormTemplate>;
}

export async function createSmartFormTemplate(body: SmartFormTemplateCreateBody): Promise<SmartFormTemplate> {
  const response = await fetch(`${API_URL}/api/smart-forms/templates`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not create template."));
  }
  return response.json() as Promise<SmartFormTemplate>;
}

export async function patchSmartFormTemplate(
  templateId: string,
  body: SmartFormTemplatePatchBody,
): Promise<SmartFormTemplate> {
  const response = await fetch(`${API_URL}/api/smart-forms/templates/${templateId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not update template."));
  }
  return response.json() as Promise<SmartFormTemplate>;
}

export async function archiveSmartFormTemplate(templateId: string): Promise<SmartFormTemplate> {
  const response = await fetch(`${API_URL}/api/smart-forms/templates/${templateId}/archive`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not archive template."));
  }
  return response.json() as Promise<SmartFormTemplate>;
}

export async function listMySmartFormSubmissions(): Promise<SmartFormSubmissionWithTemplate[]> {
  const response = await fetch(`${API_URL}/api/smart-forms/submissions/me`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load submissions."));
  }
  return response.json() as Promise<SmartFormSubmissionWithTemplate[]>;
}

export async function createSmartFormSubmission(
  templateId: string,
  body?: { location_id?: string | null },
): Promise<SmartFormSubmission> {
  const response = await fetch(`${API_URL}/api/smart-forms/templates/${templateId}/submissions`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not start form."));
  }
  return response.json() as Promise<SmartFormSubmission>;
}

export async function getSmartFormSubmission(submissionId: string): Promise<SmartFormSubmissionWithTemplate> {
  const response = await fetch(`${API_URL}/api/smart-forms/submissions/${submissionId}`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load submission."));
  }
  return response.json() as Promise<SmartFormSubmissionWithTemplate>;
}

export async function patchSmartFormSubmission(
  submissionId: string,
  body: {
    answers_json?: Record<string, unknown>;
    location_id?: string | null;
    signature_name?: string | null;
    signature_image_data?: string | null;
  },
): Promise<SmartFormSubmissionWithTemplate> {
  const response = await fetch(`${API_URL}/api/smart-forms/submissions/${submissionId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not save draft."));
  }
  return response.json() as Promise<SmartFormSubmissionWithTemplate>;
}

export async function submitSmartFormSubmission(submissionId: string): Promise<SmartFormSubmissionWithTemplate> {
  const response = await fetch(`${API_URL}/api/smart-forms/submissions/${submissionId}/submit`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not submit form."));
  }
  return response.json() as Promise<SmartFormSubmissionWithTemplate>;
}

export async function listSmartFormReviewQueue(params?: {
  status?: string;
  company_id?: string;
}): Promise<SmartFormReviewQueueItem[]> {
  const search = new URLSearchParams();
  if (params?.status) {
    search.set("status", params.status);
  }
  if (params?.company_id) {
    search.set("company_id", params.company_id);
  }
  const q = search.toString();
  const url = `${API_URL}/api/smart-forms/review/submissions${q ? `?${q}` : ""}`;
  const response = await fetch(url, { method: "GET", credentials: "include" });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load review queue."));
  }
  const data = (await response.json()) as { items: SmartFormReviewQueueItem[] };
  return data.items;
}

export async function reviewSmartFormSubmission(
  submissionId: string,
  body: { decision: "reviewed" | "rejected"; review_notes?: string | null },
): Promise<SmartFormSubmissionWithTemplate> {
  const response = await fetch(`${API_URL}/api/smart-forms/review/submissions/${submissionId}/review`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not record review."));
  }
  return response.json() as Promise<SmartFormSubmissionWithTemplate>;
}

export async function downloadSmartFormSubmissionPdf(submissionId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/smart-forms/submissions/${submissionId}/pdf`, {
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
  a.download = `form-${submissionId}.pdf`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function deleteSmartFormTemplate(templateId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/smart-forms/templates/${templateId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not delete template."));
  }
}

export const EXAMPLE_SMART_FORM_SCHEMA: SmartFormSchemaJson = {
  sections: [
    {
      id: "site_safety",
      title: "Site safety",
      fields: [
        { id: "walkways_clear", label: "Walkways clear", type: "yes_no", required: true },
        { id: "notes", label: "Notes", type: "textarea", required: false },
      ],
    },
  ],
};

/** Example: equipment pre-start (for “Use example” in advanced section). */
export const EXAMPLE_EQUIPMENT_PRESTART_SCHEMA: SmartFormSchemaJson = {
  sections: [
    {
      id: "prestart",
      title: "Pre-start checks",
      fields: [
        { id: "guards_in_place", label: "Guards in place", type: "yes_no", required: true },
        { id: "fluids_ok", label: "Fluid levels OK", type: "yes_no", required: true },
        { id: "defects_noted", label: "Defects noted", type: "textarea", required: false },
      ],
    },
  ],
};

/** Example: H&S walkthrough. */
export const EXAMPLE_HS_INSPECTION_SCHEMA: SmartFormSchemaJson = {
  sections: [
    {
      id: "walkthrough",
      title: "Inspection",
      fields: [
        { id: "ppe_compliant", label: "PPE compliance", type: "yes_no", required: true },
        { id: "hazards_observed", label: "Hazards observed", type: "textarea", required: false },
        { id: "severity", label: "Overall risk", type: "select", required: true, options: ["Low", "Medium", "High"] },
      ],
    },
  ],
};
