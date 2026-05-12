import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

export type ClockSelfieReviewItem = {
  id: string;
  user_id: string;
  user_email: string;
  employee_name: string | null;
  company_name: string | null;
  phase: string;
  captured_at: string;
  clock_in_at: string;
  clock_out_at: string | null;
  content_type: string;
  file_size_bytes: number;
};

export type ClockSelfieMetadata = {
  id: string;
  time_shift_id: string;
  phase: string;
  content_type: string;
  file_size_bytes: number;
  captured_at: string;
  created_at: string;
  clock_in_at: string;
  clock_out_at: string | null;
};

type ErrorBody = {
  detail?: unknown;
};

function appendPaginationParams(searchParams: URLSearchParams, limit?: number, offset?: number) {
  if (typeof limit === "number") {
    searchParams.set("limit", String(limit));
  }
  if (typeof offset === "number") {
    searchParams.set("offset", String(offset));
  }
}

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as ErrorBody;
    return fastApiDetailToMessage(parsed.detail, fallback);
  } catch {
    // Ignore parsing failures and keep fallback message.
  }
  return fallback;
}

export async function listClockSelfiesForReview(options?: {
  limit?: number;
  offset?: number;
}): Promise<ClockSelfieReviewItem[]> {
  const searchParams = new URLSearchParams();
  appendPaginationParams(searchParams, options?.limit, options?.offset);
  const query = searchParams.toString();
  const suffix = query ? `?${query}` : "";
  const response = await fetch(`${API_URL}/api/time-clock/selfies/review${suffix}`, {
    method: "GET",
    credentials: "include",
  });

  if (response.status === 403) {
    throw new Error("You do not have permission to review clock selfies.");
  }

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load clock selfie review."));
  }

  return response.json() as Promise<ClockSelfieReviewItem[]>;
}

export async function listClockSelfiesForUser(
  userId: string,
  options?: { limit?: number; offset?: number },
): Promise<ClockSelfieMetadata[]> {
  const searchParams = new URLSearchParams();
  appendPaginationParams(searchParams, options?.limit, options?.offset);
  const query = searchParams.toString();
  const suffix = query ? `?${query}` : "";
  const response = await fetch(
    `${API_URL}/api/time-clock/users/${encodeURIComponent(userId)}/selfies${suffix}`,
    {
      method: "GET",
      credentials: "include",
    },
  );

  if (response.status === 403) {
    throw new Error("You do not have permission to list clock selfies for this user.");
  }

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load clock selfies for this user."));
  }

  return response.json() as Promise<ClockSelfieMetadata[]>;
}

export async function fetchClockSelfieBlob(selfieId: string): Promise<Blob> {
  const response = await fetch(`${API_URL}/api/time-clock/selfies/${encodeURIComponent(selfieId)}/file`, {
    method: "GET",
    credentials: "include",
  });

  if (response.status === 403) {
    throw new Error("You do not have permission to view this selfie.");
  }

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load selfie image."));
  }

  return response.blob();
}
