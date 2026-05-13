import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

/** Required slots (order matches server `REQUIRED_DOC_TYPES`). */
export const ONBOARDING_REQUIRED_DOC_SLOTS: readonly { docType: string; label: string }[] = [
  { docType: "identity_document", label: "Passport or Birth Certificate" },
  { docType: "cscs_card", label: "CSCS Front/Back" },
  { docType: "public_liability_insurance", label: "Public Liability Insurance" },
  { docType: "share_code_document", label: "Share code / confirmation" },
] as const;

export type OnboardingDocumentMeta = {
  id: string;
  doc_type: string;
  original_filename: string;
  content_type: string;
  file_size_bytes: number;
  created_at: string;
};

export type OnboardingSubmissionDetail = {
  id: string;
  user_id: string;
  company_id: string | null;
  account_email: string;
  status: string;
  form_payload: Record<string, string>;
  signature_mode: string | null;
  signature_typed_text: string | null;
  has_drawn_signature: boolean;
  documents: OnboardingDocumentMeta[];
  submitted_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  has_profile_photo: boolean;
  profile_photo_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OnboardingReviewListItem = {
  id: string;
  user_id: string;
  user_email: string;
  employee_name: string | null;
  company_id: string | null;
  company_name: string | null;
  status: string;
  submitted_at: string | null;
  updated_at: string;
};

export type OnboardingReviewList = {
  items: OnboardingReviewListItem[];
  total: number;
};

type ErrorBody = {
  detail?: unknown;
};

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as ErrorBody;
    return fastApiDetailToMessage(parsed.detail, fallback);
  } catch {
    // ignore
  }
  return fallback;
}

export async function getMyOnboarding(): Promise<OnboardingSubmissionDetail> {
  const response = await fetch(`${API_URL}/api/onboarding/me`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load onboarding."));
  }
  return response.json() as Promise<OnboardingSubmissionDetail>;
}

export async function patchOnboardingDraft(formPayload: Record<string, string>): Promise<OnboardingSubmissionDetail> {
  const response = await fetch(`${API_URL}/api/onboarding/me/draft`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ form_payload: formPayload }),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not save draft."));
  }
  return response.json() as Promise<OnboardingSubmissionDetail>;
}

export async function reopenOnboarding(): Promise<OnboardingSubmissionDetail> {
  const response = await fetch(`${API_URL}/api/onboarding/me/reopen`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not reopen onboarding."));
  }
  return response.json() as Promise<OnboardingSubmissionDetail>;
}

export async function uploadOnboardingDocument(docType: string, file: File): Promise<OnboardingSubmissionDetail> {
  const body = new FormData();
  body.set("doc_type", docType);
  body.set("file", file);
  const response = await fetch(`${API_URL}/api/onboarding/me/documents`, {
    method: "POST",
    credentials: "include",
    body,
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not upload document."));
  }
  return response.json() as Promise<OnboardingSubmissionDetail>;
}

export async function deleteOnboardingDocument(documentId: string): Promise<OnboardingSubmissionDetail> {
  const response = await fetch(
    `${API_URL}/api/onboarding/me/documents/${encodeURIComponent(documentId)}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not remove document."));
  }
  return response.json() as Promise<OnboardingSubmissionDetail>;
}

export async function setTypedSignature(text: string): Promise<OnboardingSubmissionDetail> {
  const response = await fetch(`${API_URL}/api/onboarding/me/signature/typed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not save typed signature."));
  }
  return response.json() as Promise<OnboardingSubmissionDetail>;
}

export async function setDrawnSignature(file: File): Promise<OnboardingSubmissionDetail> {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch(`${API_URL}/api/onboarding/me/signature/drawn`, {
    method: "POST",
    credentials: "include",
    body,
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not save drawn signature."));
  }
  return response.json() as Promise<OnboardingSubmissionDetail>;
}

export async function clearSignature(): Promise<OnboardingSubmissionDetail> {
  const response = await fetch(`${API_URL}/api/onboarding/me/signature`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not clear signature."));
  }
  return response.json() as Promise<OnboardingSubmissionDetail>;
}

export async function submitOnboarding(): Promise<OnboardingSubmissionDetail> {
  const response = await fetch(`${API_URL}/api/onboarding/me/submit`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not submit onboarding."));
  }
  return response.json() as Promise<OnboardingSubmissionDetail>;
}

export async function listOnboardingReview(options?: {
  status?: string;
  companyId?: string;
  limit?: number;
  offset?: number;
}): Promise<OnboardingReviewList> {
  const search = new URLSearchParams();
  if (options?.status) {
    search.set("status", options.status);
  }
  if (options?.companyId) {
    search.set("company_id", options.companyId);
  }
  if (typeof options?.limit === "number") {
    search.set("limit", String(options.limit));
  }
  if (typeof options?.offset === "number") {
    search.set("offset", String(options.offset));
  }
  const q = search.toString();
  const suffix = q ? `?${q}` : "";
  const response = await fetch(`${API_URL}/api/onboarding/review${suffix}`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load onboarding review list."));
  }
  return response.json() as Promise<OnboardingReviewList>;
}

export async function getOnboardingReviewDetail(submissionId: string): Promise<OnboardingSubmissionDetail> {
  const response = await fetch(
    `${API_URL}/api/onboarding/review/${encodeURIComponent(submissionId)}`,
    {
      method: "GET",
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load submission."));
  }
  return response.json() as Promise<OnboardingSubmissionDetail>;
}

export async function approveOnboarding(submissionId: string, reason: string): Promise<OnboardingSubmissionDetail> {
  const response = await fetch(
    `${API_URL}/api/onboarding/review/${encodeURIComponent(submissionId)}/approve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ reason }),
    },
  );
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not approve submission."));
  }
  return response.json() as Promise<OnboardingSubmissionDetail>;
}

export async function rejectOnboarding(submissionId: string, reason: string): Promise<OnboardingSubmissionDetail> {
  const response = await fetch(
    `${API_URL}/api/onboarding/review/${encodeURIComponent(submissionId)}/reject`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ reason }),
    },
  );
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not reject submission."));
  }
  return response.json() as Promise<OnboardingSubmissionDetail>;
}

export async function fetchOnboardingDocumentBlob(documentId: string): Promise<Blob> {
  const response = await fetch(
    `${API_URL}/api/onboarding/documents/${encodeURIComponent(documentId)}/file`,
    {
      method: "GET",
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not download document."));
  }
  return response.blob();
}

export async function fetchOnboardingSignatureBlob(submissionId: string): Promise<Blob> {
  const response = await fetch(
    `${API_URL}/api/onboarding/submissions/${encodeURIComponent(submissionId)}/signature-image`,
    {
      method: "GET",
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load signature image."));
  }
  return response.blob();
}

export async function postOnboardingProfilePhoto(file: File): Promise<OnboardingSubmissionDetail> {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch(`${API_URL}/api/onboarding/me/profile-photo`, {
    method: "POST",
    credentials: "include",
    body,
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not upload profile photo."));
  }
  return response.json() as Promise<OnboardingSubmissionDetail>;
}

export async function deleteOnboardingProfilePhoto(): Promise<OnboardingSubmissionDetail> {
  const response = await fetch(`${API_URL}/api/onboarding/me/profile-photo`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not remove profile photo."));
  }
  return response.json() as Promise<OnboardingSubmissionDetail>;
}

export async function fetchOnboardingProfilePhotoBlob(userId: string): Promise<Blob> {
  const response = await fetch(
    `${API_URL}/api/onboarding/profile-photo/${encodeURIComponent(userId)}/file`,
    {
      method: "GET",
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load profile photo."));
  }
  return response.blob();
}
