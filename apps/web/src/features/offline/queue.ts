import type { WorkProgressCreateBody } from "../work-progress/api";
import { idbPutQueueItem } from "./db";
import { dispatchOfflineQueueChanged } from "./events";
import type {
  OfflineQueueItem,
  WorkProgressOfflinePhotoBlob,
  WorkProgressPhotosPayload,
  WorkProgressSubmitPayload,
} from "./types";

function nowIso() {
  return new Date().toISOString();
}

export async function enqueueWorkProgressSubmit(
  userId: string,
  companyId: string | null,
  createBody: WorkProgressCreateBody,
  photos: WorkProgressOfflinePhotoBlob[],
): Promise<void> {
  const t = nowIso();
  const payload: WorkProgressSubmitPayload = {
    kind: "work_progress_submit",
    createBody,
    photos,
  };
  const item: OfflineQueueItem = {
    id: crypto.randomUUID(),
    kind: "work_progress_submit",
    status: "queued",
    created_at: t,
    updated_at: t,
    retry_count: 0,
    last_error: null,
    user_id: userId,
    company_id: companyId,
    idempotency_key: crypto.randomUUID(),
    payload,
  };
  await idbPutQueueItem(item);
  dispatchOfflineQueueChanged();
}

export async function enqueueWorkProgressPhotos(
  userId: string,
  companyId: string | null,
  progressId: string,
  photos: WorkProgressOfflinePhotoBlob[],
): Promise<void> {
  const t = nowIso();
  const payload: WorkProgressPhotosPayload = {
    kind: "work_progress_photos",
    progressId,
    photos,
  };
  const item: OfflineQueueItem = {
    id: crypto.randomUUID(),
    kind: "work_progress_photos",
    status: "queued",
    created_at: t,
    updated_at: t,
    retry_count: 0,
    last_error: null,
    user_id: userId,
    company_id: companyId,
    idempotency_key: crypto.randomUUID(),
    payload,
  };
  await idbPutQueueItem(item);
  dispatchOfflineQueueChanged();
}

export function photosFromPreparedUploads(
  prepared: { uploadFile: File; displayName: string }[],
): WorkProgressOfflinePhotoBlob[] {
  return prepared.map((p) => ({
    filename: p.uploadFile.name || p.displayName,
    contentType: p.uploadFile.type || "application/octet-stream",
    blob: p.uploadFile,
  }));
}
