import { API_URL } from "../../config/api";
import { fastApiDetailToMessage } from "../../lib/api-error-detail";

/** Defaults if `/me/options` omits limits (older server). Must match backend intent. */
export const WORK_PROGRESS_FALLBACK_MAX_ATTACHMENTS = 20;
export const WORK_PROGRESS_FALLBACK_MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;

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
  max_attachments_per_entry?: number;
  max_original_image_bytes?: number;
};

export type WorkProgressAttachmentMeta = {
  id: string;
  original_filename: string;
  content_type: string;
  file_size_bytes: number;
  original_size_bytes: number | null;
  stored_size_bytes: number | null;
  stored_content_type: string | null;
  image_width: number | null;
  image_height: number | null;
  processing_version: string | null;
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
  attachments: WorkProgressAttachmentMeta[];
};

export type WorkProgressMeList = {
  items: WorkProgressListItem[];
  total: number;
};

export type WorkProgressCreateBody = {
  work_date: string;
  location_id: string;
  workplace_id?: string | null;
  /** Optional; empty string is accepted by the API. */
  title?: string;
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
  attachment_count: number;
  created_at: string;
};

export type WorkProgressReviewList = {
  items: WorkProgressReviewListItem[];
  total: number;
};

type ErrorBody = {
  detail?: unknown;
};

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

export function workProgressThumbnailUrl(fileId: string): string {
  return `${API_URL}/api/work-progress/files/${encodeURIComponent(fileId)}/thumbnail`;
}

export type WorkProgressReviewQuery = {
  company_id?: string;
  user_id?: string;
  location_id?: string;
  status?: string;
  include_archived?: boolean;
  entry_id?: string;
  date_from?: string;
  date_to?: string;
  title_search?: string;
  limit?: number;
  offset?: number;
};

export type WorkProgressReviewGalleryItem = {
  attachment: WorkProgressAttachmentMeta;
  entry_id: string;
  work_date: string;
  title: string;
  location_id: string;
  location_name: string;
  user_id: string;
  user_email: string;
  employee_name: string | null;
};

export type WorkProgressReviewGalleryResponse = {
  items: WorkProgressReviewGalleryItem[];
  total: number;
};

export type WorkProgressEmployeeFilterOption = {
  user_id: string;
  display_name: string | null;
  email: string;
  is_active: boolean;
};

export type WorkProgressBulkDeleteResult = {
  deleted_count: number;
  storage_cleanup_ok: number;
  storage_cleanup_failed: number;
  warning: string | null;
};

export const WORK_PROGRESS_ZIP_MAX_FILES = 48;
export const WORK_PROGRESS_SELECTION_MAX = 200;
export const WORK_PROGRESS_GALLERY_PAGE_SIZE = 48;

export async function listWorkProgressEmployeeFilterOptions(
  companyId?: string | null,
): Promise<WorkProgressEmployeeFilterOption[]> {
  const search = new URLSearchParams();
  if (companyId?.trim()) {
    search.set("company_id", companyId.trim());
  }
  const q = search.toString();
  const response = await fetch(
    `${API_URL}/api/work-progress/review/employee-filter-options${q ? `?${q}` : ""}`,
    { method: "GET", credentials: "include" },
  );
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load employees."));
  }
  const data = (await response.json()) as { items: WorkProgressEmployeeFilterOption[] };
  return data.items;
}

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
  if (params?.include_archived) {
    search.set("include_archived", "true");
  }
  if (params?.date_from) {
    search.set("date_from", params.date_from);
  }
  if (params?.date_to) {
    search.set("date_to", params.date_to);
  }
  if (params?.title_search?.trim()) {
    search.set("title_search", params.title_search.trim());
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

export async function downloadWorkProgressReviewCsv(params?: WorkProgressReviewQuery): Promise<void> {
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
  if (params?.title_search?.trim()) {
    search.set("title_search", params.title_search.trim());
  }
  const q = search.toString();
  const response = await fetch(
    `${API_URL}/api/work-progress/review/export.csv${q ? `?${q}` : ""}`,
    { method: "GET", credentials: "include" },
  );
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not export CSV."));
  }
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = "work-progress-review.csv";
  anchor.click();
  URL.revokeObjectURL(href);
}

function appendReviewQuery(search: URLSearchParams, params?: WorkProgressReviewQuery): void {
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
  if (params?.include_archived) {
    search.set("include_archived", "true");
  }
  if (params?.entry_id) {
    search.set("entry_id", params.entry_id);
  }
  if (params?.date_from) {
    search.set("date_from", params.date_from);
  }
  if (params?.date_to) {
    search.set("date_to", params.date_to);
  }
  if (params?.title_search?.trim()) {
    search.set("title_search", params.title_search.trim());
  }
}

export async function listWorkProgressReviewGallery(
  params?: WorkProgressReviewQuery,
): Promise<WorkProgressReviewGalleryResponse> {
  const search = new URLSearchParams();
  appendReviewQuery(search, params);
  if (params?.limit != null) {
    search.set("limit", String(params.limit));
  }
  if (params?.offset != null) {
    search.set("offset", String(params.offset));
  }
  const q = search.toString();
  const response = await fetch(
    `${API_URL}/api/work-progress/review/attachments/gallery${q ? `?${q}` : ""}`,
    { method: "GET", credentials: "include" },
  );
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not load attachment gallery."));
  }
  return response.json() as Promise<WorkProgressReviewGalleryResponse>;
}

export async function bulkDownloadWorkProgressAttachments(fileIds: string[]): Promise<Blob> {
  const response = await fetch(`${API_URL}/api/work-progress/review/attachments/bulk-download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ file_ids: fileIds }),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not download selected files."));
  }
  return response.blob();
}

export async function bulkDeleteWorkProgressAttachments(
  fileIds: string[],
): Promise<WorkProgressBulkDeleteResult> {
  const response = await fetch(`${API_URL}/api/work-progress/review/attachments/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ file_ids: fileIds }),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not delete selected files."));
  }
  if (response.status === 204) {
    return {
      deleted_count: fileIds.length,
      storage_cleanup_ok: fileIds.length,
      storage_cleanup_failed: 0,
      warning: null,
    };
  }
  try {
    return (await response.json()) as WorkProgressBulkDeleteResult;
  } catch {
    return {
      deleted_count: fileIds.length,
      storage_cleanup_ok: fileIds.length,
      storage_cleanup_failed: 0,
      warning: null,
    };
  }
}

export async function archiveWorkProgressReviewEntry(progressId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/work-progress/review/${encodeURIComponent(progressId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not archive submission."));
  }
}

export type WorkProgressPermanentDeleteResult = {
  deleted_submission_id: string;
  deleted_attachment_count: number;
  storage_cleanup_ok: number;
  storage_cleanup_failed: number;
  warning: string | null;
};

export async function permanentDeleteWorkProgressSubmission(
  progressId: string,
): Promise<WorkProgressPermanentDeleteResult> {
  const response = await fetch(
    `${API_URL}/api/work-progress/review/${encodeURIComponent(progressId)}/permanent-delete`,
    {
      method: "POST",
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, "Could not permanently delete submission."));
  }
  return (await response.json()) as WorkProgressPermanentDeleteResult;
}
