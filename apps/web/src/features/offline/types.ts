import type { WorkProgressCreateBody } from "../work-progress/api";

export type OfflineQueueStatus = "queued" | "syncing" | "synced" | "failed";

/** Submitted site/work progress JSON while offline; photos optional (prepared blobs). */
export type OfflineQueueKindWorkProgressSubmit = "work_progress_submit";

/** Pending photo uploads for an existing server entry (user was online, then dropped). */
export type OfflineQueueKindWorkProgressPhotos = "work_progress_photos";

export type OfflineQueueKind = OfflineQueueKindWorkProgressSubmit | OfflineQueueKindWorkProgressPhotos;

export type WorkProgressOfflinePhotoBlob = {
  filename: string;
  contentType: string;
  blob: Blob;
};

export type WorkProgressSubmitPayload = {
  kind: OfflineQueueKindWorkProgressSubmit;
  createBody: WorkProgressCreateBody;
  photos: WorkProgressOfflinePhotoBlob[];
};

export type WorkProgressPhotosPayload = {
  kind: OfflineQueueKindWorkProgressPhotos;
  progressId: string;
  photos: WorkProgressOfflinePhotoBlob[];
};

export type OfflineQueuePayload = WorkProgressSubmitPayload | WorkProgressPhotosPayload;

export type OfflineQueueItem = {
  id: string;
  kind: OfflineQueueKind;
  status: OfflineQueueStatus;
  created_at: string;
  updated_at: string;
  retry_count: number;
  last_error: string | null;
  user_id: string;
  company_id: string | null;
  idempotency_key: string;
  payload: OfflineQueuePayload;
};

export type StarterFormLocalDraft = {
  user_id: string;
  updated_at: string;
  fields: Record<string, string>;
};

/** Local-only smart form answers while offline (per user + template). Not synced automatically. */
export type SmartFormLocalDraft = {
  draft_key: string;
  user_id: string;
  template_id: string;
  updated_at: string;
  answers_json: Record<string, unknown>;
};
