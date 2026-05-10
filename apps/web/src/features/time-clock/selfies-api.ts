import { API_URL } from "../../config/api";

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
  detail?: string;
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
    if (parsed.detail) {
      return parsed.detail;
    }
  } catch {
    // Ignore parsing failures and keep fallback message.
  }
  return fallback;
}

export async function listMyClockSelfies(options?: {
  limit?: number;
  offset?: number;
}): Promise<ClockSelfieMetadata[]> {
  const searchParams = new URLSearchParams();
  appendPaginationParams(searchParams, options?.limit, options?.offset);
  const query = searchParams.toString();
  const suffix = query ? `?${query}` : "";
  const response = await fetch(`${API_URL}/api/time-clock/selfies/me${suffix}`, {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load your clock selfies."));
  }

  return response.json() as Promise<ClockSelfieMetadata[]>;
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

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load selfie image."));
  }

  return response.blob();
}
