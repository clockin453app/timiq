/**
 * Sequential prepare-and-upload queue for Work Progress photos.
 * One picture is prepared and uploaded at a time to bound browser and API memory.
 */

import { uploadWorkProgressFile, type WorkProgressEntryDetail } from "./api";
import {
  prepareSiteProgressPhotoUpload,
  yieldToBrowser,
  type PreparedSiteProgressUpload,
} from "./image-compression";
import type { QueuedPhoto } from "./site-progress-form";

export type PhotoUploadFileStatus = "preparing" | "uploading" | "uploaded" | "failed";

export type PhotoUploadProgressItem = {
  uploadId: string;
  displayName: string;
  status: PhotoUploadFileStatus;
  message?: string;
};

export type SequentialUploadFailure = {
  file: File;
  displayName: string;
  message: string;
  uploadId: string;
};

export type SequentialUploadResult = {
  latestDetail: WorkProgressEntryDetail | null;
  failures: SequentialUploadFailure[];
  successes: number;
  prepareFailures: { file: File; message: string; uploadId: string }[];
};

export function formatPhotoStatusLine(item: PhotoUploadProgressItem): string {
  switch (item.status) {
    case "preparing":
      return `${item.displayName}: Preparing`;
    case "uploading":
      return `${item.displayName}: Uploading`;
    case "uploaded":
      return `${item.displayName}: Uploaded`;
    case "failed":
      return `${item.message
        ? `${item.displayName}: Failed — ${item.message}`
        : `${item.displayName}: Failed`}`;
    default:
      return item.displayName;
  }
}

export function formatBatchUploadResult(successes: number, total: number, failed: number): string {
  if (failed === 0) {
    return total === 1 ? "1 of 1 uploaded" : `${successes} of ${total} uploaded`;
  }
  return `${successes} of ${total} uploaded — ${failed} need retry`;
}

export async function processAndUploadPhotosSequentially(
  progressId: string,
  items: readonly QueuedPhoto[],
  maxOriginalBytes: number,
  callbacks: {
    onFileUpdate: (update: PhotoUploadProgressItem) => void;
    onCounts: (uploaded: number, total: number) => void;
  },
): Promise<SequentialUploadResult> {
  const total = items.length;
  let latestDetail: WorkProgressEntryDetail | null = null;
  const failures: SequentialUploadFailure[] = [];
  const prepareFailures: { file: File; message: string; uploadId: string }[] = [];
  let successes = 0;

  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    const displayName = item.file.name || "photo";
    callbacks.onFileUpdate({
      uploadId: item.uploadId,
      displayName,
      status: "preparing",
    });

    let prepared: PreparedSiteProgressUpload;
    try {
      prepared = await prepareSiteProgressPhotoUpload(item.file, maxOriginalBytes, {
        onStatus: (msg) =>
          callbacks.onFileUpdate({
            uploadId: item.uploadId,
            displayName,
            status: "preparing",
            message: msg,
          }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not prepare file.";
      prepareFailures.push({ file: item.file, message, uploadId: item.uploadId });
      callbacks.onFileUpdate({
        uploadId: item.uploadId,
        displayName,
        status: "failed",
        message,
      });
      callbacks.onCounts(successes, total);
      await yieldToBrowser();
      continue;
    }

    callbacks.onFileUpdate({
      uploadId: item.uploadId,
      displayName,
      status: "uploading",
    });

    try {
      latestDetail = await uploadWorkProgressFile(progressId, prepared.uploadFile, item.uploadId);
      successes += 1;
      callbacks.onFileUpdate({
        uploadId: item.uploadId,
        displayName,
        status: "uploaded",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      failures.push({
        file: item.file,
        displayName: prepared.displayName,
        message,
        uploadId: item.uploadId,
      });
      callbacks.onFileUpdate({
        uploadId: item.uploadId,
        displayName: prepared.displayName,
        status: "failed",
        message,
      });
    }

    callbacks.onCounts(successes, total);
    await yieldToBrowser();
  }

  return { latestDetail, failures, successes, prepareFailures };
}
