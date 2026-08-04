/**
 * Pure helpers for the Site Progress one-step create + photo queue form.
 * Kept free of React so Node test scripts can exercise behaviour directly.
 */

import { isValidLocalDateString } from "../../lib/datetime-local";
import { isSupportedSiteProgressMime } from "./image-compression";

export type SiteProgressFormValues = {
  workDate: string;
  locationId: string;
  title: string;
  progressStatus: string;
  notes: string;
  percent: string;
};

export type SiteProgressFieldErrors = {
  workDate?: string;
  locationId?: string;
  percent?: string;
  photos?: string;
};

export type QueuedPhoto = {
  /** Stable key for React lists and duplicate detection. */
  key: string;
  file: File;
  /** Object URL for thumbnail preview; caller must revoke when removed. */
  previewUrl: string;
  /** Stable id for idempotent server retries across partial failures. */
  uploadId: string;
};

export function createPhotoUploadId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function fileIdentityKey(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

export function resolveAllowedLocationId(
  currentId: string,
  allowedIds: readonly string[],
): string {
  if (allowedIds.length === 0) {
    return "";
  }
  if (currentId && allowedIds.includes(currentId)) {
    return currentId;
  }
  if (allowedIds.length === 1) {
    return allowedIds[0]!;
  }
  return "";
}

export function validateSiteProgressRequiredFields(
  values: Pick<SiteProgressFormValues, "workDate" | "locationId" | "percent">,
  options: { allowedLocationIds: readonly string[] },
): SiteProgressFieldErrors {
  const { allowedLocationIds } = options;
  const errors: SiteProgressFieldErrors = {};
  if (!values.workDate.trim() || !isValidLocalDateString(values.workDate)) {
    errors.workDate = "Enter a valid work date.";
  }
  if (!values.locationId.trim()) {
    errors.locationId = "Select a site/location.";
  } else if (
    allowedLocationIds.length > 0 &&
    !allowedLocationIds.includes(values.locationId)
  ) {
    errors.locationId = "That site is no longer available for your account.";
  }
  if (values.percent.trim() !== "") {
    const n = Number.parseInt(values.percent, 10);
    if (Number.isNaN(n) || n < 0 || n > 100) {
      errors.percent = "Percent complete must be between 0 and 100.";
    }
  }
  return errors;
}

export function validateQueuedPhotos(
  files: readonly File[],
  options: {
    maxAttachments: number;
    maxOriginalBytes: number;
    existingAttachmentCount?: number;
  },
): SiteProgressFieldErrors {
  const {
    maxAttachments,
    maxOriginalBytes,
    existingAttachmentCount = 0,
  } = options;
  const errors: SiteProgressFieldErrors = {};
  const room = Math.max(0, maxAttachments - existingAttachmentCount);
  if (files.length === 0) {
    return errors;
  }
  if (room === 0) {
    errors.photos = `This entry already has the maximum number of photos (${maxAttachments} per entry).`;
    return errors;
  }
  if (files.length > room) {
    errors.photos = `You selected ${files.length} photo(s) but only ${room} slot(s) remain (max ${maxAttachments} per entry).`;
    return errors;
  }
  const badType = files.filter((f) => !isSupportedSiteProgressMime(f));
  if (badType.length > 0) {
    errors.photos = `Unsupported type (only JPEG, PNG, or WebP): ${badType.map((f) => f.name).join(", ")}`;
    return errors;
  }
  const oversized = files.filter((f) => f.size > maxOriginalBytes);
  if (oversized.length > 0) {
    const mb = Math.round(maxOriginalBytes / (1024 * 1024));
    errors.photos = `File exceeds the ${mb} MB limit: ${oversized.map((f) => f.name).join(", ")}`;
  }
  return errors;
}

/**
 * Merge newly picked files into the queue.
 * Duplicates (same name+size+lastModified) are skipped.
 * Returns the next queue and how many were skipped as duplicates.
 */
export function mergePhotoFilesIntoQueue(
  current: readonly QueuedPhoto[],
  incoming: readonly File[],
  createPreviewUrl: (file: File) => string = (file) => URL.createObjectURL(file),
): { next: QueuedPhoto[]; skippedDuplicates: number } {
  const seen = new Set(current.map((item) => item.key));
  const next = [...current];
  let skippedDuplicates = 0;
  for (const file of incoming) {
    const key = fileIdentityKey(file);
    if (seen.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    seen.add(key);
    next.push({
      key,
      file,
      previewUrl: createPreviewUrl(file),
      uploadId: createPhotoUploadId(),
    });
  }
  return { next, skippedDuplicates };
}

export function removeQueuedPhoto(
  current: readonly QueuedPhoto[],
  key: string,
): QueuedPhoto[] {
  const removed = current.find((item) => item.key === key);
  if (removed?.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(removed.previewUrl);
  }
  return current.filter((item) => item.key !== key);
}

export function clearQueuedPhotos(current: readonly QueuedPhoto[]): QueuedPhoto[] {
  for (const item of current) {
    if (item.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(item.previewUrl);
    }
  }
  return [];
}

export function parseOptionalPercent(percent: string): number | null {
  if (percent.trim() === "") {
    return null;
  }
  return Number.parseInt(percent, 10);
}

export function buildCreateBody(values: SiteProgressFormValues) {
  return {
    work_date: values.workDate,
    location_id: values.locationId,
    workplace_id: null as string | null,
    title: values.title.trim(),
    progress_status: values.progressStatus,
    notes: values.notes.trim() || null,
    percent_complete: parseOptionalPercent(values.percent),
  };
}

export type SubmitPhase =
  | "idle"
  | "validating"
  | "creating"
  | "preparing"
  | "uploading"
  | "processing"
  | "success"
  | "partial";

export function submitPhaseLabel(
  phase: SubmitPhase,
  counts: { uploaded?: number; total?: number; failed?: number } = {},
): string {
  const uploaded = counts.uploaded ?? 0;
  const total = counts.total ?? 0;
  const failed = counts.failed ?? 0;
  switch (phase) {
    case "validating":
      return "Checking details…";
    case "creating":
      return "Creating update…";
    case "preparing":
      return "Preparing photos…";
    case "uploading":
      return total > 0 ? `Uploading ${uploaded} of ${total}` : "Uploading photos…";
    case "processing":
      return "Processing photos…";
    case "success":
      return total > 0 ? `${uploaded} of ${total} uploaded` : "Update submitted";
    case "partial":
      return failed > 0
        ? `${uploaded} of ${total} uploaded — ${failed} need retry`
        : "Update saved with photo issues";
    default:
      return "";
  }
}

/** Keep only files that still need retry after a partial upload. */
export function retainFailedPhotoFiles(
  queue: readonly QueuedPhoto[],
  failedFiles: readonly File[],
): QueuedPhoto[] {
  const failedKeys = new Set(failedFiles.map(fileIdentityKey));
  const kept: QueuedPhoto[] = [];
  for (const item of queue) {
    if (failedKeys.has(item.key)) {
      kept.push(item);
    } else if (item.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(item.previewUrl);
    }
  }
  return kept;
}
