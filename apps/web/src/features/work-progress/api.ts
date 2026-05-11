import { API_URL } from "../../config/api";

export const WORK_PROGRESS_STATUS_OPTIONS = [
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "delayed", label: "Delayed" },
  { value: "complete", label: "Complete" },
  { value: "on_hold", label: "On hold" },
] as const;

export type WorkProgressLocationOption = {
  id: string;
  name: string;
  address: string | null;
};

export type WorkProgressMeOptions = {
  locations: WorkProgressLocationOption[];
};

export type WorkProgressAttachmentMeta = {
  id: string;
  original_filename: string;
  content_type: string;
  file_size_bytes: number;
  created_at: string;
};

export type WorkProgressEntryDetail = {
  id: string;
  user_id: string;
  company_id: string;
  workplace_id: string | null;
  workplace_name: string | null;
  location_id: string;
  location_name: string;
  work_date: string;
  title: string;
  progress_status: string;
  notes: string | null;
  percent_complete: number | null;
  status: string;
  reviewed_at: string | null;
  review_note: string | null;
  attachments: WorkProgressAttachmentMeta[];
  created_at: string;
  updated_at: string;
};

export type WorkProgressListItem = {
  id: string;
  work_date: string;
  title: string;
  progress_status: string;
  percent_complete: number | null;
  status: string;
  location_name: string;
  workplace_name: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkProgressMeList = {
  items: WorkProgressListItem[];
  total: number;
};

export type WorkProgressCreateBody = {
  work_date: string;
  location_id: string;
  workplace_id?: string | null;
  title: string;
  progress_status: string;
  notes?: string | null;
  percent_complete?: number | null;
};

export type WorkProgressReviewListItem = {
  id: string;
  user_id: string;
  user_email: string;
  employee_name: string | null;
  company_id: string;
  company_name: string | null;
  location_id: string;
  location_name: string;
  work_date: string;
  title: string;
  progress_status: string;
  status: string;
  created_at: string;
};

export type WorkProgressReviewList = {
  items: WorkProgressReviewListItem[];
  total: number;
};

export type WorkProgressReviewDetail = WorkProgressEntryDetail & {
  user_email: string;
  employee_name: string | null;
};

type ErrorBody = {
  detail?: string;
};

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as ErrorBody;
    if (parsed.detail) {
      return typeof parsed.detail === "string" ? parsed.detail : fallback;
    }
  } catch {
    // ignore
  }
  return fallback;
}

export async function fetchWorkProgressMeOptions(): Promise<WorkProgressMeOptions> {
  const response = await fetch(`${API_URL}/api/work-progress/me/options`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load site options."));
  }
  return response.json() as Promise<WorkProgressMeOptions>;
}

export async function listMyWorkProgress(params?: {
  limit?: number;
  offset?: number;
}): Promise<WorkProgressMeList> {
  const search = new URLSearchParams();
  if (params?.limit != null) {
    search.set("limit", String(params.limit));
  }
  if (params?.offset != null) {
    search.set("offset", String(params.offset));
  }
  const q = search.toString();
  const url = `${API_URL}/api/work-progress/me${q ? `?${q}` : ""}`;
  const response = await fetch(url, { method: "GET", credentials: "include" });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load work progress."));
  }
  return response.json() as Promise<WorkProgressMeList>;
}

export async function getMyWorkProgressDetail(progressId: string): Promise<WorkProgressEntryDetail> {
  const response = await fetch(`${API_URL}/api/work-progress/me/${encodeURIComponent(progressId)}`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load entry."));
  }
  return response.json() as Promise<WorkProgressEntryDetail>;
}

export async function createMyWorkProgress(body: WorkProgressCreateBody): Promise<WorkProgressEntryDetail> {
  const response = await fetch(`${API_URL}/api/work-progress/me`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not save work progress."));
  }
  return response.json() as Promise<WorkProgressEntryDetail>;
}

export async function uploadWorkProgressFile(progressId: string, file: File): Promise<WorkProgressEntryDetail> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(
    `${API_URL}/api/work-progress/me/${encodeURIComponent(progressId)}/files`,
    {
      method: "POST",
      credentials: "include",
      body: form,
    },
  );
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not upload file."));
  }
  return response.json() as Promise<WorkProgressEntryDetail>;
}

export function workProgressFileUrl(fileId: string): string {
  return `${API_URL}/api/work-progress/files/${encodeURIComponent(fileId)}/file`;
}

export async function fetchWorkProgressFileBlob(fileId: string): Promise<Blob> {
  const response = await fetch(workProgressFileUrl(fileId), {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not download file."));
  }
  return response.blob();
}

export type WorkProgressReviewQuery = {
  company_id?: string;
  user_id?: string;
  location_id?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
};

export async function listWorkProgressReview(params?: WorkProgressReviewQuery): Promise<WorkProgressReviewList> {
  const search = new URLSearchParams();
  if (params?.company_id) {
    search.set("company_id", params.company_id);
  }
  if (params?.user_id) {
    search.set("user_id", params.user_id);
  }
  if (params?.location_id) {
    search.set("location_id", params.location_id);
  }
  if (params?.status) {
    search.set("status", params.status);
  }
  if (params?.date_from) {
    search.set("date_from", params.date_from);
  }
  if (params?.date_to) {
    search.set("date_to", params.date_to);
  }
  if (params?.limit != null) {
    search.set("limit", String(params.limit));
  }
  if (params?.offset != null) {
    search.set("offset", String(params.offset));
  }
  const q = search.toString();
  const response = await fetch(`${API_URL}/api/work-progress/review${q ? `?${q}` : ""}`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load review list."));
  }
  return response.json() as Promise<WorkProgressReviewList>;
}

export async function getWorkProgressReviewDetail(progressId: string): Promise<WorkProgressReviewDetail> {
  const response = await fetch(`${API_URL}/api/work-progress/review/${encodeURIComponent(progressId)}`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load review detail."));
  }
  return response.json() as Promise<WorkProgressReviewDetail>;
}

export async function acknowledgeWorkProgress(
  progressId: string,
  note?: string | null,
): Promise<WorkProgressReviewDetail> {
  const response = await fetch(
    `${API_URL}/api/work-progress/review/${encodeURIComponent(progressId)}/acknowledge`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ note: note ?? null }),
    },
  );
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not acknowledge."));
  }
  return response.json() as Promise<WorkProgressReviewDetail>;
}

export async function commentWorkProgress(progressId: string, comment: string): Promise<WorkProgressReviewDetail> {
  const response = await fetch(
    `${API_URL}/api/work-progress/review/${encodeURIComponent(progressId)}/comment`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ comment }),
    },
  );
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not add comment."));
  }
  return response.json() as Promise<WorkProgressReviewDetail>;
}
