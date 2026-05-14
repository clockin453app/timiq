import { createMyWorkProgress, uploadWorkProgressFile } from "../work-progress/api";
import { idbDeleteQueueItem, idbGetAllQueueForUser, idbPutQueueItem } from "./db";
import { dispatchOfflineQueueChanged } from "./events";
import { isNavigatorOffline } from "./network";
import type { OfflineQueueItem, WorkProgressOfflinePhotoBlob } from "./types";

const MAX_RETRIES = 5;

function blobToUploadFile(blob: WorkProgressOfflinePhotoBlob): File {
  return new File([blob.blob], blob.filename, { type: blob.contentType });
}

export async function processOfflineQueue(userId: string): Promise<void> {
  if (typeof window === "undefined" || isNavigatorOffline()) {
    return;
  }

  const all = await idbGetAllQueueForUser(userId);
  const mine = all.filter((i) => i.user_id === userId);

  const t = new Date().toISOString();
  for (const i of mine) {
    if (i.status === "syncing") {
      await idbPutQueueItem({ ...i, status: "queued", updated_at: t });
    }
  }

  const refreshed = await idbGetAllQueueForUser(userId);
  const mine2 = refreshed.filter((i) => i.user_id === userId);
  const pending = mine2.filter(
    (i) => i.status === "queued" || (i.status === "failed" && i.retry_count < MAX_RETRIES),
  );

  for (const item of pending) {
    const syncing: OfflineQueueItem = {
      ...item,
      status: "syncing",
      updated_at: new Date().toISOString(),
    };
    await idbPutQueueItem(syncing);

    try {
      if (item.payload.kind === "work_progress_submit") {
        const created = await createMyWorkProgress(item.payload.createBody);
        for (const ph of item.payload.photos) {
          await uploadWorkProgressFile(created.id, blobToUploadFile(ph));
        }
      } else if (item.payload.kind === "work_progress_photos") {
        for (const ph of item.payload.photos) {
          await uploadWorkProgressFile(item.payload.progressId, blobToUploadFile(ph));
        }
      }
      await idbDeleteQueueItem(item.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sync failed";
      const failed: OfflineQueueItem = {
        ...item,
        status: "failed",
        last_error: msg,
        retry_count: item.retry_count + 1,
        updated_at: new Date().toISOString(),
      };
      await idbPutQueueItem(failed);
    }
  }

  dispatchOfflineQueueChanged();
}

export async function countOfflineQueueForUser(userId: string): Promise<{
  queued: number;
  failed: number;
  syncing: number;
}> {
  const all = await idbGetAllQueueForUser(userId);
  let queued = 0;
  let failed = 0;
  let syncing = 0;
  for (const i of all) {
    if (i.user_id !== userId) {
      continue;
    }
    if (i.status === "queued") {
      queued += 1;
    } else if (i.status === "failed") {
      failed += 1;
    } else if (i.status === "syncing") {
      syncing += 1;
    }
  }
  return { queued, failed, syncing };
}
