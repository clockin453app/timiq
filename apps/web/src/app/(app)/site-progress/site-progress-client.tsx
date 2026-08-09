"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  Button,
  FormActions,
  FormField,
  Sheet,
  SheetBody,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { useCurrentUser } from "@/features/auth";
import {
  enqueueWorkProgressPhotos,
  enqueueWorkProgressSubmit,
  isLikelyNetworkFailure,
  isNavigatorOffline,
} from "@/features/offline";
import {
  ELEVATION_CUSTOM_MAX_LEN,
  ELEVATION_CUSTOM_VALUE,
  ELEVATION_OPTIONS,
  LEVEL_OPTIONS,
  WORK_CATEGORY_OPTIONS,
  WORK_PROGRESS_FALLBACK_MAX_ATTACHMENTS,
  WORK_PROGRESS_FALLBACK_MAX_ORIGINAL_BYTES,
  createMyWorkProgress,
  fetchWorkProgressFileBlob,
  fetchWorkProgressMeOptions,
  formatClassificationSummary,
  getMyWorkProgressDetail,
  listMyWorkProgress,
  workProgressFileUrl,
  type WorkProgressAttachmentMeta,
  type WorkProgressEntryDetail,
  type WorkProgressListItem,
  type WorkProgressLocationOption,
} from "@/features/work-progress/api";
import {
  prepareSiteProgressPhotoUpload,
  yieldToBrowser,
} from "@/features/work-progress/image-compression";
import {
  buildCreateBody,
  clearQueuedPhotos,
  mergePhotoFilesIntoQueue,
  removeQueuedPhoto,
  resolveAllowedLocationId,
  retainFailedPhotoFiles,
  submitPhaseLabel,
  type QueuedPhoto,
  type SiteProgressFieldErrors,
  type SubmitPhase,
  validateQueuedPhotos,
  validateSiteProgressRequiredFields,
} from "@/features/work-progress/site-progress-form";
import {
  formatBatchUploadResult,
  formatPhotoStatusLine,
  processAndUploadPhotosSequentially,
} from "@/features/work-progress/upload-queue";
import { todayLocalDateString } from "@/lib/datetime-local";
import { useT } from "@/lib/i18n";

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatBytes(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) {
    return "—";
  }
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageAttachment(a: WorkProgressAttachmentMeta) {
  const t = (a.stored_content_type || a.content_type || "").toLowerCase();
  return t.startsWith("image/");
}

function displayTitle(title: string) {
  const trimmed = title.trim();
  return trimmed || "Untitled update";
}

function historyTitleCell(row: Pick<
  WorkProgressListItem,
  | "title"
  | "work_category"
  | "work_category_label"
  | "elevation_display"
  | "level"
  | "level_display"
>) {
  return formatClassificationSummary(row) ?? displayTitle(row.title);
}

function historyStatusCell(row: Pick<WorkProgressListItem, "work_category" | "progress_status">) {
  if (row.work_category) {
    return "—";
  }
  return row.progress_status;
}

function AttachmentThumb({ att }: { att: WorkProgressAttachmentMeta }) {
  if (!isImageAttachment(att)) {
    return (
      <span className="inline-flex h-12 w-12 items-center justify-center rounded border border-[var(--color-border)] bg-[var(--color-header)] text-[10px] font-bold text-[var(--color-text-soft)]">
        PDF
      </span>
    );
  }
  return (
    <img
      alt=""
      className="h-12 w-12 rounded border border-[var(--color-border)] object-cover"
      height={48}
      loading="lazy"
      src={workProgressFileUrl(att.id)}
      width={48}
    />
  );
}

type PhotoQueuePanelProps = {
  queued: QueuedPhoto[];
  disabled: boolean;
  inputId: string;
  maxAttachments: number;
  maxOriginalBytes: number;
  existingCount?: number;
  error?: string;
  notice?: string;
  onPick: (files: File[]) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  /** Controls (caption + choose/take). Default true. */
  showControls?: boolean;
  /** Selected-photo thumbnail gallery. Default true. */
  showGallery?: boolean;
  /** Compact text clear under photo actions (not a third primary). Default true. */
  showClearAction?: boolean;
};

function PhotoQueueGallery({
  queued,
  disabled,
  onRemove,
}: {
  queued: QueuedPhoto[];
  disabled: boolean;
  onRemove: (key: string) => void;
}) {
  if (queued.length === 0) {
    return null;
  }
  return (
    <ul className="grid grid-cols-2 gap-1.5 min-[390px]:grid-cols-3 md:grid-cols-4 md:gap-2">
      {queued.map((item) => (
        <li
          className="min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)]"
          key={item.key}
        >
          <div className="relative aspect-square bg-[var(--color-cell)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              className="h-full w-full object-cover"
              src={item.previewUrl}
            />
          </div>
          <div className="flex items-center justify-between gap-1 px-1.5 py-1">
            <p className="min-w-0 flex-1 truncate text-[length:var(--text-secondary)] text-[var(--color-text)]" title={item.file.name}>
              {item.file.name}
            </p>
            <button
              aria-label={`Remove ${item.file.name}`}
              className="timiq-touch-extend shrink-0 rounded px-1.5 py-0.5 text-[length:var(--text-secondary)] font-semibold text-[var(--color-danger-700)]"
              disabled={disabled}
              onClick={() => onRemove(item.key)}
              type="button"
            >
              Remove
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function PhotoQueuePanel({
  queued,
  disabled,
  inputId,
  maxAttachments,
  maxOriginalBytes,
  existingCount = 0,
  error,
  notice,
  onPick,
  onRemove,
  onClear,
  showControls = true,
  showGallery = true,
  showClearAction = true,
}: PhotoQueuePanelProps) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const room = Math.max(0, maxAttachments - existingCount);
  const selectedOrExisting = queued.length + existingCount;
  const maxMb = Math.round(maxOriginalBytes / (1024 * 1024));

  return (
    <div className="min-w-0 space-y-2">
      {showControls ? (
        <>
          <p className="timiq-caption break-words leading-snug">
            JPEG, PNG or WebP · Up to {maxAttachments} photos · {maxMb} MB each
          </p>
          {selectedOrExisting > 0 || room === 0 ? (
            <p className="timiq-caption break-words leading-snug text-[var(--color-text-muted)]">
              {room} slot{room === 1 ? "" : "s"} left
            </p>
          ) : null}

          <div className="grid w-full min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-2">
            <Button
              className="min-h-[44px] w-full"
              disabled={disabled || room === 0}
              onClick={() => galleryRef.current?.click()}
              type="button"
              variant="secondary"
            >
              Choose photos
            </Button>
            <Button
              className="min-h-[44px] w-full"
              disabled={disabled || room === 0}
              onClick={() => cameraRef.current?.click()}
              type="button"
              variant="secondary"
            >
              Take photo
            </Button>
          </div>

          {showClearAction && queued.length > 0 ? (
            <button
              className="timiq-touch-extend self-start text-left text-[length:var(--text-secondary)] font-medium text-[var(--color-text-muted)] underline-offset-2 hover:underline disabled:opacity-50"
              disabled={disabled}
              onClick={onClear}
              type="button"
            >
              Clear selected photos
            </button>
          ) : null}

          <input
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={disabled || room === 0}
            id={inputId}
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length > 0) {
                onPick(files);
              }
            }}
            ref={galleryRef}
            type="file"
          />
          <input
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="sr-only"
            disabled={disabled || room === 0}
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length > 0) {
                onPick(files);
              }
            }}
            ref={cameraRef}
            type="file"
          />

          {notice ? <p className="timiq-caption break-words leading-snug">{notice}</p> : null}
          {error ? (
            <p className="break-words text-[length:var(--text-secondary)] text-[var(--color-danger-700)]" role="alert">
              {error}
            </p>
          ) : null}
        </>
      ) : null}

      {showGallery ? <PhotoQueueGallery disabled={disabled} onRemove={onRemove} queued={queued} /> : null}
    </div>
  );
}

export function SiteProgressClient() {
  const t = useT();
  const currentUser = useCurrentUser();
  const formId = useId();
  const historyRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const submitLockRef = useRef(false);

  const [options, setOptions] = useState<WorkProgressLocationOption[]>([]);
  const [optionsError, setOptionsError] = useState("");
  const [items, setItems] = useState<WorkProgressListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [listError, setListError] = useState("");
  const [listLoading, setListLoading] = useState(true);

  const [workDate, setWorkDate] = useState(() => todayLocalDateString());
  const [locationId, setLocationId] = useState("");
  const [workCategory, setWorkCategory] = useState("");
  const [elevation, setElevation] = useState("");
  const [elevationCustom, setElevationCustom] = useState("");
  const [level, setLevel] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldErrors, setFieldErrors] = useState<SiteProgressFieldErrors>({});
  const [formError, setFormError] = useState("");
  const [offlineNotice, setOfflineNotice] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>("idle");
  const [submitProgress, setSubmitProgress] = useState({ uploaded: 0, total: 0, failed: 0 });
  const [submitBarPercent, setSubmitBarPercent] = useState(0);
  const [submitDetailLines, setSubmitDetailLines] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState("");
  const [partialEntryId, setPartialEntryId] = useState<string | null>(null);
  const [highlightedEntryId, setHighlightedEntryId] = useState<string | null>(null);

  const [createQueue, setCreateQueue] = useState<QueuedPhoto[]>([]);
  const [createPhotoNotice, setCreatePhotoNotice] = useState("");

  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<"view" | "add">("view");
  const [activeDetail, setActiveDetail] = useState<WorkProgressEntryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [addMoreQueue, setAddMoreQueue] = useState<QueuedPhoto[]>([]);
  const [addMoreBusy, setAddMoreBusy] = useState(false);
  const [addMoreError, setAddMoreError] = useState("");
  const [addMoreNotice, setAddMoreNotice] = useState("");
  const [addMorePhase, setAddMorePhase] = useState<SubmitPhase>("idle");
  const [addMoreProgress, setAddMoreProgress] = useState({ uploaded: 0, total: 0, failed: 0 });
  const [addMoreBar, setAddMoreBar] = useState(0);
  const [maxAttachments, setMaxAttachments] = useState(WORK_PROGRESS_FALLBACK_MAX_ATTACHMENTS);
  const [maxOriginalBytes, setMaxOriginalBytes] = useState(WORK_PROGRESS_FALLBACK_MAX_ORIGINAL_BYTES);

  const allowedLocationIds = options.map((o) => o.id);

  const loadOptions = useCallback(async () => {
    setOptionsError("");
    try {
      const data = await fetchWorkProgressMeOptions();
      setOptions(data.locations);
      setMaxAttachments(data.max_attachments_per_entry ?? WORK_PROGRESS_FALLBACK_MAX_ATTACHMENTS);
      setMaxOriginalBytes(data.max_original_image_bytes ?? WORK_PROGRESS_FALLBACK_MAX_ORIGINAL_BYTES);
    } catch (err) {
      setOptionsError(
        err instanceof Error ? err.message : t("site_progress.options_load_failed", "Could not load allowed sites."),
      );
      setOptions([]);
    }
  }, [t]);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError("");
    try {
      const data = await listMyWorkProgress({ limit: 100, offset: 0 });
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : t("site_progress.history_load_failed", "Could not load history."),
      );
      setItems([]);
      setTotal(0);
    } finally {
      setListLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    const ids = options.map((o) => o.id);
    setLocationId((current) => resolveAllowedLocationId(current, ids));
  }, [options]);

  useEffect(() => {
    if (!activeEntryId) {
      setActiveDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    (async () => {
      try {
        const d = await getMyWorkProgressDetail(activeEntryId);
        if (!cancelled) {
          setActiveDetail(d);
        }
      } catch {
        if (!cancelled) {
          setActiveDetail(null);
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEntryId]);

  useEffect(() => {
    return () => {
      clearQueuedPhotos(createQueue);
      clearQueuedPhotos(addMoreQueue);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revoke only on unmount
  }, []);

  function focusFirstInvalid(errors: SiteProgressFieldErrors) {
    if (errors.workDate) {
      document.getElementById(`${formId}-work-date`)?.focus();
      return;
    }
    if (errors.locationId) {
      document.getElementById(`${formId}-location`)?.focus();
      return;
    }
    if (errors.workCategory) {
      document.getElementById(`${formId}-work-category`)?.focus();
      return;
    }
    if (errors.elevation) {
      document.getElementById(`${formId}-elevation`)?.focus();
      return;
    }
    if (errors.elevationCustom) {
      document.getElementById(`${formId}-elevation-custom`)?.focus();
      return;
    }
    if (errors.level) {
      document.getElementById(`${formId}-level`)?.focus();
    }
  }

  function resetClassificationFields() {
    setWorkCategory("");
    setElevation("");
    setElevationCustom("");
    setLevel("");
    setNotes("");
  }

  function pickIntoCreateQueue(files: File[]) {
    setCreatePhotoNotice("");
    setFieldErrors((prev) => ({ ...prev, photos: undefined }));
    setCreateQueue((current) => {
      const { next, skippedDuplicates } = mergePhotoFilesIntoQueue(current, files);
      if (skippedDuplicates > 0) {
        setCreatePhotoNotice(
          skippedDuplicates === 1
            ? "Skipped 1 duplicate file already in the queue."
            : `Skipped ${skippedDuplicates} duplicate files already in the queue.`,
        );
      }
      return next;
    });
  }

  function pickIntoAddMoreQueue(files: File[]) {
    setAddMoreNotice("");
    setAddMoreError("");
    setAddMoreQueue((current) => {
      const { next, skippedDuplicates } = mergePhotoFilesIntoQueue(current, files);
      if (skippedDuplicates > 0) {
        setAddMoreNotice(
          skippedDuplicates === 1
            ? "Skipped 1 duplicate file already in the queue."
            : `Skipped ${skippedDuplicates} duplicate files already in the queue.`,
        );
      }
      return next;
    });
  }

  async function prepareOfflinePhotos(
    queue: QueuedPhoto[],
    onStatus: (msg: string) => void,
  ): Promise<{
    photos: { filename: string; contentType: string; blob: Blob; clientUploadId: string }[];
    prepareFailures: { file: File; message: string }[];
  }> {
    const photos: { filename: string; contentType: string; blob: Blob; clientUploadId: string }[] = [];
    const prepareFailures: { file: File; message: string }[] = [];
    for (const item of queue) {
      try {
        const prepared = await prepareSiteProgressPhotoUpload(item.file, maxOriginalBytes, {
          onStatus: (msg) => onStatus(msg),
        });
        photos.push({
          filename: prepared.uploadFile.name || prepared.displayName,
          contentType: prepared.uploadFile.type || "application/octet-stream",
          blob: prepared.uploadFile,
          clientUploadId: item.uploadId,
        });
        onStatus(`${prepared.displayName}: ready for sync`);
      } catch (err) {
        prepareFailures.push({
          file: item.file,
          message: err instanceof Error ? err.message : "Could not prepare file.",
        });
      }
      await yieldToBrowser();
    }
    return { photos, prepareFailures };
  }

  async function runSequentialUpload(
    progressId: string,
    queue: QueuedPhoto[],
    onPhase: (phase: SubmitPhase) => void,
    onProgress: (uploaded: number, total: number, failed: number) => void,
    onBar: (pct: number) => void,
  ) {
    return processAndUploadPhotosSequentially(progressId, queue, maxOriginalBytes, {
      onFileUpdate: (update) => {
        setSubmitDetailLines((lines) => {
          const label = formatPhotoStatusLine(update);
          const without = lines.filter((line) => !line.startsWith(`${update.displayName}:`));
          return [...without, label].slice(-24);
        });
        if (update.status === "preparing") {
          onPhase("preparing");
        } else if (update.status === "uploading") {
          onPhase("uploading");
        }
      },
      onCounts: (uploaded, totalCount) => {
        onProgress(uploaded, totalCount, 0);
        onBar(Math.round(50 + (50 * uploaded) / Math.max(1, totalCount)));
      },
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitLockRef.current || formBusy) {
      return;
    }

    setFormError("");
    setOfflineNotice("");
    setSuccessMessage("");
    setPartialEntryId(null);
    setSubmitDetailLines([]);

    const values = { workDate, locationId, workCategory, elevation, elevationCustom, level, notes };
    const requiredErrors = validateSiteProgressRequiredFields(values, { allowedLocationIds });
    const photoErrors = validateQueuedPhotos(
      createQueue.map((q) => q.file),
      { maxAttachments, maxOriginalBytes, existingAttachmentCount: 0 },
    );
    const errors = { ...requiredErrors, ...photoErrors };
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setSubmitPhase("idle");
      focusFirstInvalid(errors);
      return;
    }

    const body = buildCreateBody(values);
    const queuedFiles = createQueue.map((q) => q.file);

    submitLockRef.current = true;
    setFormBusy(true);
    setSubmitPhase("creating");
    setSubmitBarPercent(queuedFiles.length > 0 ? 5 : 20);
    setSubmitProgress({ uploaded: 0, total: queuedFiles.length, failed: 0 });

    try {
      if (isNavigatorOffline()) {
        setSubmitPhase("preparing");
        const { photos, prepareFailures } = await prepareOfflinePhotos(createQueue, (msg) =>
          setSubmitDetailLines((lines) => [...lines, msg].slice(-24)),
        );
        await enqueueWorkProgressSubmit(
          currentUser.id,
          currentUser.company_id,
          body,
          photos,
        );
        setOfflineNotice(
          prepareFailures.length > 0
            ? `Queued offline with ${photos.length} photo(s). ${prepareFailures.length} file(s) could not be prepared and were kept for retry after sync.`
            : "Queued offline — this update and photos will sync when you are online.",
        );
        if (prepareFailures.length === 0) {
          setCreateQueue((q) => clearQueuedPhotos(q));
          resetClassificationFields();
        } else {
          setCreateQueue((q) => retainFailedPhotoFiles(q, prepareFailures.map((f) => f.file)));
        }
        setSubmitPhase("idle");
        setSubmitBarPercent(0);
        return;
      }

      const created = await createMyWorkProgress(body);
      setHighlightedEntryId(created.id);
      setActiveEntryId(created.id);
      setActiveMode("view");
      setActiveDetail(created);

      if (queuedFiles.length === 0) {
        setSubmitPhase("success");
        setSubmitBarPercent(100);
        setSuccessMessage("Update submitted.");
        resetClassificationFields();
        setCreateQueue((q) => clearQueuedPhotos(q));
        await loadList();
        queueMicrotask(() => {
          successRef.current?.focus();
          historyRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
        return;
      }

      setSubmitPhase("preparing");
      setSubmitProgress({ uploaded: 0, total: createQueue.length, failed: 0 });

      const { latestDetail, failures: uploadFailures, successes, prepareFailures } =
        await runSequentialUpload(
          created.id,
          createQueue,
          setSubmitPhase,
          (uploaded, totalCount, failed) => {
            setSubmitProgress({ uploaded, total: totalCount, failed });
          },
          setSubmitBarPercent,
        );

      try {
        const refreshed = await getMyWorkProgressDetail(created.id);
        setActiveDetail(refreshed);
      } catch {
        if (latestDetail) {
          setActiveDetail(latestDetail);
        }
      }
      await loadList();

      const allFailedFiles = [
        ...prepareFailures.map((f) => f.file),
        ...uploadFailures.map((f) => f.file),
      ];
      const failCount = allFailedFiles.length;
      const totalCount = createQueue.length;
      const okCount = successes;

      if (failCount === 0) {
        setSubmitPhase("success");
        setSubmitBarPercent(100);
        setSubmitProgress({ uploaded: okCount, total: totalCount, failed: 0 });
        setSuccessMessage(
          totalCount === 0
            ? "Update submitted."
            : formatBatchUploadResult(okCount, totalCount, 0),
        );
        resetClassificationFields();
        setCreateQueue((q) => clearQueuedPhotos(q));
        setSubmitDetailLines([]);
        queueMicrotask(() => {
          successRef.current?.focus();
          historyRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      } else {
        setSubmitPhase("partial");
        setPartialEntryId(created.id);
        setSubmitProgress({ uploaded: okCount, total: totalCount, failed: failCount });
        const messages = [
          ...prepareFailures.map((f) => `"${f.file.name}": ${f.message}`),
          ...uploadFailures.map((f) => `"${f.displayName}": ${f.message}`),
        ];
        setFormError(
          `${formatBatchUploadResult(okCount, totalCount, failCount)}.\n${messages.join("\n")}`,
        );
        setCreateQueue((q) => retainFailedPhotoFiles(q, allFailedFiles));
        setActiveMode("add");
      }
    } catch (err) {
      if (isLikelyNetworkFailure(err)) {
        try {
          setSubmitPhase("preparing");
          const { photos } = await prepareOfflinePhotos(createQueue, (msg) =>
            setSubmitDetailLines((lines) => [...lines, msg].slice(-24)),
          );
          await enqueueWorkProgressSubmit(
            currentUser.id,
            currentUser.company_id,
            body,
            photos,
          );
          setOfflineNotice(
            "Network unavailable — update and photos saved on this device and queued for sync.",
          );
          setCreateQueue((q) => clearQueuedPhotos(q));
          resetClassificationFields();
          setSubmitPhase("idle");
        } catch {
          setSubmitPhase("idle");
          setFormError(err instanceof Error ? err.message : "Save failed.");
        }
      } else {
        setSubmitPhase("idle");
        setFormError(err instanceof Error ? err.message : "Save failed.");
      }
    } finally {
      setFormBusy(false);
      submitLockRef.current = false;
    }
  }

  async function retryFailedCreateUploads() {
    if (!partialEntryId || createQueue.length === 0 || submitLockRef.current) {
      return;
    }
    submitLockRef.current = true;
    setFormBusy(true);
    setFormError("");
    setSubmitPhase("preparing");
    setSubmitDetailLines([]);
    try {
      const photoErrors = validateQueuedPhotos(createQueue.map((q) => q.file), {
        maxAttachments,
        maxOriginalBytes,
        existingAttachmentCount: activeDetail?.attachments.length ?? 0,
      });
      if (photoErrors.photos) {
        setFieldErrors((prev) => ({ ...prev, photos: photoErrors.photos }));
        setSubmitPhase("partial");
        return;
      }

      if (isNavigatorOffline()) {
        const { photos, prepareFailures } = await prepareOfflinePhotos(createQueue, (msg) =>
          setSubmitDetailLines((lines) => [...lines, msg].slice(-24)),
        );
        if (photos.length === 0) {
          setFormError(prepareFailures.map((f) => `"${f.file.name}": ${f.message}`).join("\n"));
          setCreateQueue((q) => retainFailedPhotoFiles(q, prepareFailures.map((f) => f.file)));
          setSubmitPhase("partial");
          return;
        }
        await enqueueWorkProgressPhotos(
          currentUser.id,
          currentUser.company_id,
          partialEntryId,
          photos,
        );
        setOfflineNotice("Failed photos re-queued for offline sync.");
        setCreateQueue((q) =>
          retainFailedPhotoFiles(q, prepareFailures.map((f) => f.file)),
        );
        setSubmitPhase(prepareFailures.length > 0 ? "partial" : "idle");
        return;
      }

      setSubmitProgress({ uploaded: 0, total: createQueue.length, failed: 0 });
      const { latestDetail, failures, successes, prepareFailures } = await runSequentialUpload(
        partialEntryId,
        createQueue,
        setSubmitPhase,
        (uploaded, totalCount, failed) => {
          setSubmitProgress({ uploaded, total: totalCount, failed });
        },
        setSubmitBarPercent,
      );
      try {
        const refreshed = await getMyWorkProgressDetail(partialEntryId);
        setActiveDetail(refreshed);
      } catch {
        if (latestDetail) setActiveDetail(latestDetail);
      }
      await loadList();

      const failedFiles = [
        ...prepareFailures.map((f) => f.file),
        ...failures.map((f) => f.file),
      ];
      const totalCount = createQueue.length;
      if (failedFiles.length === 0) {
        setSubmitPhase("success");
        setSuccessMessage(formatBatchUploadResult(successes, totalCount, 0));
        setPartialEntryId(null);
        setCreateQueue((q) => clearQueuedPhotos(q));
        setFormError("");
      } else {
        setSubmitPhase("partial");
        setSubmitProgress({
          uploaded: successes,
          total: totalCount,
          failed: failedFiles.length,
        });
        setFormError(
          `${formatBatchUploadResult(successes, totalCount, failedFiles.length)}.\n${failedFiles.map((f) => f.name).join(", ")}`,
        );
        setCreateQueue((q) => retainFailedPhotoFiles(q, failedFiles));
      }
    } catch (err) {
      setSubmitPhase("partial");
      setFormError(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setFormBusy(false);
      submitLockRef.current = false;
    }
  }

  async function handleUploadAddMore() {
    if (!activeEntryId || !activeDetail || addMoreQueue.length === 0 || addMoreBusy) {
      return;
    }
    const files = addMoreQueue.map((q) => q.file);
    const photoErrors = validateQueuedPhotos(files, {
      maxAttachments,
      maxOriginalBytes,
      existingAttachmentCount: activeDetail.attachments.length,
    });
    if (photoErrors.photos) {
      setAddMoreError(photoErrors.photos);
      return;
    }

    setAddMoreBusy(true);
    setAddMoreError("");
    setAddMoreNotice("");
    setAddMorePhase("preparing");
    setAddMoreBar(0);

    try {
      if (isNavigatorOffline()) {
        const { photos, prepareFailures } = await prepareOfflinePhotos(addMoreQueue, () => undefined);
        if (photos.length === 0) {
          setAddMoreError(prepareFailures.map((f) => `"${f.file.name}": ${f.message}`).join("\n"));
          setAddMoreQueue((q) => retainFailedPhotoFiles(q, prepareFailures.map((f) => f.file)));
          setAddMorePhase("idle");
          return;
        }
        await enqueueWorkProgressPhotos(
          currentUser.id,
          currentUser.company_id,
          activeEntryId,
          photos,
        );
        setOfflineNotice("Photos queued offline — they will upload when you are online.");
        setAddMoreQueue((q) =>
          prepareFailures.length > 0
            ? retainFailedPhotoFiles(q, prepareFailures.map((f) => f.file))
            : clearQueuedPhotos(q),
        );
        setAddMorePhase("idle");
        return;
      }

      setAddMoreProgress({ uploaded: 0, total: addMoreQueue.length, failed: 0 });
      const { latestDetail, failures, successes, prepareFailures } =
        await processAndUploadPhotosSequentially(activeEntryId, addMoreQueue, maxOriginalBytes, {
          onFileUpdate: (update) => {
            if (update.status === "preparing") {
              setAddMorePhase("preparing");
            } else if (update.status === "uploading") {
              setAddMorePhase("uploading");
            }
          },
          onCounts: (uploaded, totalCount) => {
            setAddMoreProgress({ uploaded, total: totalCount, failed: 0 });
            setAddMoreBar(Math.round(50 + (50 * uploaded) / Math.max(1, totalCount)));
          },
        });
      try {
        const refreshed = await getMyWorkProgressDetail(activeEntryId);
        setActiveDetail(refreshed);
      } catch {
        if (latestDetail) setActiveDetail(latestDetail);
      }
      await loadList();

      const failedFiles = [
        ...prepareFailures.map((f) => f.file),
        ...failures.map((f) => f.file),
      ];
      const totalCount = addMoreQueue.length;
      if (failedFiles.length === 0) {
        setAddMorePhase("success");
        setAddMoreNotice(formatBatchUploadResult(successes, totalCount, 0));
        setAddMoreQueue((q) => clearQueuedPhotos(q));
      } else {
        setAddMorePhase("partial");
        setAddMoreProgress({
          uploaded: successes,
          total: totalCount,
          failed: failedFiles.length,
        });
        setAddMoreError(formatBatchUploadResult(successes, totalCount, failedFiles.length));
        setAddMoreQueue((q) => retainFailedPhotoFiles(q, failedFiles));
      }
    } catch (err) {
      setAddMorePhase("idle");
      setAddMoreError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setAddMoreBusy(false);
    }
  }

  function openHistoryEntry(id: string, mode: "view" | "add") {
    setActiveEntryId(id);
    setActiveMode(mode);
    setHighlightedEntryId(id);
    setAddMoreError("");
    setAddMoreNotice("");
    if (mode === "view") {
      setAddMoreQueue((q) => clearQueuedPhotos(q));
    }
    queueMicrotask(() => {
      document.getElementById("site-progress-entry-panel")?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
  }

  async function openAttachment(att: WorkProgressAttachmentMeta) {
    try {
      const blob = await fetchWorkProgressFileBlob(att.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      // ignore
    }
  }

  const liveStatus =
    formBusy || addMoreBusy
      ? submitPhaseLabel(formBusy ? submitPhase : addMorePhase, formBusy ? submitProgress : addMoreProgress)
      : "";

  return (
    <Sheet>
      <h1 className="sr-only">{t("site_progress.page_title", "Site progress")}</h1>
      <SheetBody className="min-w-0 space-y-4 scroll-pb-24 md:space-y-[var(--space-section)] md:p-5">
        <div aria-atomic="true" aria-live="polite" className="sr-only">
          {liveStatus}
        </div>

        {optionsError ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-[length:var(--text-body)] text-[var(--color-danger-700)]">
            {optionsError}
          </div>
        ) : null}

        {offlineNotice ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-[length:var(--text-body)] text-[var(--color-text)]">
            {offlineNotice}
          </div>
        ) : null}

        {successMessage ? (
          <div
            className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-[length:var(--text-body)] text-[var(--color-text)] outline-none"
            ref={successRef}
            tabIndex={-1}
          >
            {successMessage}
          </div>
        ) : null}

        <section
          aria-labelledby={`${formId}-new-heading`}
          className="min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]"
          data-site-progress-form="new-update"
        >
          <form
            className="space-y-2.5 p-3 md:space-y-3 md:p-[var(--space-card)]"
            data-site-progress-form-order="metadata-photos-submit-previews"
            noValidate
            onSubmit={(e) => void handleSubmit(e)}
          >
            <h2
              className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]"
              id={`${formId}-new-heading`}
            >
              {t("site_progress.section_new", "New update")}
            </h2>

            <div className="grid min-w-0 grid-cols-1 gap-2.5 md:grid-cols-2 md:gap-3">
              <FormField
                error={fieldErrors.workDate}
                htmlFor={`${formId}-work-date`}
                label={t("site_progress.lbl_work_date", "Work date")}
                required
              >
                <input
                  className="timiq-input min-h-[44px] w-full min-w-0"
                  id={`${formId}-work-date`}
                  onChange={(e) => {
                    setWorkDate(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, workDate: undefined }));
                  }}
                  required
                  type="date"
                  value={workDate}
                />
              </FormField>

              <FormField
                error={fieldErrors.locationId}
                htmlFor={`${formId}-location`}
                label={t("site_progress.lbl_site_location", "Site / location")}
                required
              >
                <select
                  className="timiq-select min-h-[44px] w-full min-w-0"
                  id={`${formId}-location`}
                  onChange={(e) => {
                    setLocationId(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, locationId: undefined }));
                  }}
                  required
                  value={locationId}
                >
                  <option value="">{t("common.select", "Select…")}</option>
                  {options.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>

            <FormField
              error={fieldErrors.workCategory}
              htmlFor={`${formId}-work-category`}
              label={t("site_progress.lbl_work_category", "Work category")}
              required
            >
              <select
                className="timiq-select min-h-[44px] w-full min-w-0"
                id={`${formId}-work-category`}
                onChange={(e) => {
                  setWorkCategory(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, workCategory: undefined }));
                }}
                required
                value={workCategory}
              >
                <option value="">{t("common.select", "Select…")}</option>
                {WORK_CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FormField>

            {elevation === ELEVATION_CUSTOM_VALUE ? (
              <div className="grid min-w-0 grid-cols-1 gap-2.5">
                <FormField
                  error={fieldErrors.elevation}
                  htmlFor={`${formId}-elevation`}
                  label={t("site_progress.lbl_elevation", "Elevation")}
                  required
                >
                  <select
                    className="timiq-select min-h-[44px] w-full min-w-0"
                    id={`${formId}-elevation`}
                    onChange={(e) => {
                      const next = e.target.value;
                      setElevation(next);
                      if (next !== ELEVATION_CUSTOM_VALUE) {
                        setElevationCustom("");
                      }
                      setFieldErrors((prev) => ({
                        ...prev,
                        elevation: undefined,
                        elevationCustom: next === ELEVATION_CUSTOM_VALUE ? prev.elevationCustom : undefined,
                      }));
                    }}
                    required
                    value={elevation}
                  >
                    <option value="">{t("common.select", "Select…")}</option>
                    {ELEVATION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField
                  error={fieldErrors.elevationCustom}
                  htmlFor={`${formId}-elevation-custom`}
                  label={t("site_progress.lbl_elevation_name", "Elevation name")}
                  required
                >
                  <input
                    className="timiq-input min-h-[44px] w-full min-w-0"
                    id={`${formId}-elevation-custom`}
                    maxLength={ELEVATION_CUSTOM_MAX_LEN}
                    onChange={(e) => {
                      setElevationCustom(e.target.value);
                      setFieldErrors((prev) => ({ ...prev, elevationCustom: undefined }));
                    }}
                    required
                    value={elevationCustom}
                  />
                </FormField>
                <FormField
                  error={fieldErrors.level}
                  htmlFor={`${formId}-level`}
                  label={t("site_progress.lbl_level", "Level")}
                  required
                >
                  <select
                    className="timiq-select min-h-[44px] w-full min-w-0"
                    id={`${formId}-level`}
                    onChange={(e) => {
                      setLevel(e.target.value);
                      setFieldErrors((prev) => ({ ...prev, level: undefined }));
                    }}
                    required
                    value={level}
                  >
                    <option value="">{t("common.select", "Select…")}</option>
                    {LEVEL_OPTIONS.map((o) => (
                      <option key={o.value} value={String(o.value)}>
                        {o.optionText}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
            ) : (
              <div className="grid min-w-0 grid-cols-1 gap-2.5 min-[390px]:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] md:gap-3">
                <FormField
                  error={fieldErrors.elevation}
                  htmlFor={`${formId}-elevation`}
                  label={t("site_progress.lbl_elevation", "Elevation")}
                  required
                >
                  <select
                    className="timiq-select min-h-[44px] w-full min-w-0"
                    id={`${formId}-elevation`}
                    onChange={(e) => {
                      const next = e.target.value;
                      setElevation(next);
                      if (next !== ELEVATION_CUSTOM_VALUE) {
                        setElevationCustom("");
                      }
                      setFieldErrors((prev) => ({
                        ...prev,
                        elevation: undefined,
                        elevationCustom: next === ELEVATION_CUSTOM_VALUE ? prev.elevationCustom : undefined,
                      }));
                    }}
                    required
                    value={elevation}
                  >
                    <option value="">{t("common.select", "Select…")}</option>
                    {ELEVATION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField
                  error={fieldErrors.level}
                  htmlFor={`${formId}-level`}
                  label={t("site_progress.lbl_level", "Level")}
                  required
                >
                  <select
                    className="timiq-select min-h-[44px] w-full min-w-0"
                    id={`${formId}-level`}
                    onChange={(e) => {
                      setLevel(e.target.value);
                      setFieldErrors((prev) => ({ ...prev, level: undefined }));
                    }}
                    required
                    value={level}
                  >
                    <option value="">{t("common.select", "Select…")}</option>
                    {LEVEL_OPTIONS.map((o) => (
                      <option key={o.value} value={String(o.value)}>
                        {o.optionText}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
            )}

            <FormField htmlFor={`${formId}-notes`} label={t("site_progress.lbl_notes", "Notes / details")}>
              <textarea
                className="timiq-input min-h-[68px] w-full min-w-0 resize-y [field-sizing:content]"
                id={`${formId}-notes`}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                value={notes}
              />
            </FormField>

            <FormField
              error={fieldErrors.photos}
              htmlFor={`${formId}-photos`}
              label="Photos"
            >
              <PhotoQueuePanel
                disabled={formBusy}
                error={undefined}
                existingCount={0}
                inputId={`${formId}-photos`}
                maxAttachments={maxAttachments}
                maxOriginalBytes={maxOriginalBytes}
                notice={createPhotoNotice}
                onClear={() => {
                  setCreateQueue((q) => clearQueuedPhotos(q));
                  setCreatePhotoNotice("");
                }}
                onPick={pickIntoCreateQueue}
                onRemove={(key) => setCreateQueue((q) => removeQueuedPhoto(q, key))}
                queued={createQueue}
                showClearAction={false}
                showControls
                showGallery={false}
              />
            </FormField>

            {(formBusy || submitPhase === "partial" || submitBarPercent > 0) && submitPhase !== "idle" ? (
              <div className="space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
                <p className="text-[length:var(--text-secondary)] font-medium text-[var(--color-text)]">
                  {submitPhaseLabel(submitPhase, submitProgress)}
                </p>
                {formBusy ? (
                  <div className="h-2 w-full min-w-0 overflow-hidden rounded bg-[var(--color-border-dark)]">
                    <div
                      className="h-full rounded-sm bg-[var(--color-action-text)] transition-[width] duration-200"
                      style={{ width: `${Math.min(100, Math.max(0, submitBarPercent))}%` }}
                    />
                  </div>
                ) : null}
                {submitDetailLines.length > 0 ? (
                  <ul className="max-h-28 list-disc space-y-0.5 overflow-y-auto pl-4 text-[length:var(--text-secondary)] text-[var(--color-text-muted)]">
                    {submitDetailLines.slice(-10).map((line, idx) => (
                      <li className="break-words" key={`${idx}-${line.slice(0, 40)}`}>
                        {line}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {formError ? (
              <p className="whitespace-pre-wrap break-words text-[length:var(--text-body)] text-[var(--color-danger-700)]" role="alert">
                {formError}
              </p>
            ) : null}

            {partialEntryId && createQueue.length > 0 ? (
              <FormActions>
                <Button
                  className="w-full sm:w-auto"
                  disabled={formBusy}
                  onClick={() => void retryFailedCreateUploads()}
                  type="button"
                  variant="secondary"
                >
                  Retry failed uploads
                </Button>
                <Button
                  className="w-full sm:w-auto"
                  onClick={() => openHistoryEntry(partialEntryId, "view")}
                  type="button"
                  variant="ghost"
                >
                  View saved update
                </Button>
              </FormActions>
            ) : null}

            <Button
              className="min-h-[44px] w-full"
              disabled={formBusy || options.length === 0}
              type="submit"
              variant="primary"
            >
              {formBusy
                ? submitPhaseLabel(submitPhase, submitProgress) ||
                  t("site_progress.submitting_pictures", "Submitting…")
                : t("site_progress.submit_pictures", "Submit pictures")}
            </Button>

            {createQueue.length > 0 ? (
              <div className="min-w-0 space-y-1.5" data-site-progress-selected-photos>
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                    Selected photos ({createQueue.length})
                  </h3>
                  <button
                    className="timiq-touch-extend shrink-0 text-[length:var(--text-secondary)] font-medium text-[var(--color-text-muted)] underline-offset-2 hover:underline disabled:opacity-50"
                    disabled={formBusy}
                    onClick={() => {
                      setCreateQueue((q) => clearQueuedPhotos(q));
                      setCreatePhotoNotice("");
                    }}
                    type="button"
                  >
                    Clear selected photos
                  </button>
                </div>
                <PhotoQueuePanel
                  disabled={formBusy}
                  existingCount={0}
                  inputId={`${formId}-photos-gallery`}
                  maxAttachments={maxAttachments}
                  maxOriginalBytes={maxOriginalBytes}
                  onClear={() => {
                    setCreateQueue((q) => clearQueuedPhotos(q));
                    setCreatePhotoNotice("");
                  }}
                  onPick={pickIntoCreateQueue}
                  onRemove={(key) => setCreateQueue((q) => removeQueuedPhoto(q, key))}
                  queued={createQueue}
                  showClearAction={false}
                  showControls={false}
                  showGallery
                />
              </div>
            ) : null}
          </form>
        </section>

        {activeEntryId ? (
          <div
            className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]"
            id="site-progress-entry-panel"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-[var(--space-card)] py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                {activeMode === "add" ? "Add photos" : "Report photos"}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => setActiveMode("view")}
                  size="sm"
                  type="button"
                  variant={activeMode === "view" ? "primary" : "secondary"}
                >
                  View photos
                </Button>
                <Button
                  onClick={() => setActiveMode("add")}
                  size="sm"
                  type="button"
                  variant={activeMode === "add" ? "primary" : "secondary"}
                >
                  Add more photos
                </Button>
                <Button
                  onClick={() => {
                    setActiveEntryId(null);
                    setAddMoreQueue((q) => clearQueuedPhotos(q));
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Close
                </Button>
              </div>
            </div>
            <div className="space-y-3 p-[var(--space-card)] text-[length:var(--text-body)]">
              {detailLoading ? <p className="text-[var(--color-text-muted)]">Loading entry…</p> : null}
              {!detailLoading && activeDetail ? (
                <>
                  <p className="text-[var(--color-text-muted)]">
                    {formatDate(activeDetail.work_date)} — {activeDetail.location_name} —{" "}
                    {formatClassificationSummary(activeDetail) ?? displayTitle(activeDetail.title)}
                  </p>
                  <p className="text-[var(--color-text-muted)]">
                    Uploaded: {activeDetail.attachments.length} / {maxAttachments}
                  </p>

                  {activeMode === "add" ? (
                    <div className="space-y-3">
                      <PhotoQueuePanel
                        disabled={addMoreBusy}
                        error={addMoreError || undefined}
                        existingCount={activeDetail.attachments.length}
                        inputId={`${formId}-add-more`}
                        maxAttachments={maxAttachments}
                        maxOriginalBytes={maxOriginalBytes}
                        notice={addMoreNotice}
                        onClear={() => setAddMoreQueue((q) => clearQueuedPhotos(q))}
                        onPick={pickIntoAddMoreQueue}
                        onRemove={(key) => setAddMoreQueue((q) => removeQueuedPhoto(q, key))}
                        queued={addMoreQueue}
                      />
                      {addMoreBusy || addMorePhase === "partial" || addMorePhase === "success" ? (
                        <div className="space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
                          <p className="text-[length:var(--text-secondary)] font-medium">
                            {submitPhaseLabel(addMorePhase, addMoreProgress)}
                          </p>
                          {addMoreBusy ? (
                            <div className="h-2 w-full overflow-hidden rounded bg-[var(--color-border-dark)]">
                              <div
                                className="h-full bg-[var(--color-action-text)] transition-[width]"
                                style={{ width: `${Math.min(100, Math.max(0, addMoreBar))}%` }}
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <Button
                        className="w-full sm:w-auto"
                        disabled={
                          addMoreBusy ||
                          addMoreQueue.length === 0 ||
                          activeDetail.attachments.length >= maxAttachments
                        }
                        onClick={() => void handleUploadAddMore()}
                        type="button"
                        variant="primary"
                      >
                        {addMoreBusy
                          ? submitPhaseLabel(addMorePhase, addMoreProgress) || "Uploading…"
                          : addMorePhase === "partial"
                            ? "Retry failed uploads"
                            : "Upload photos"}
                      </Button>
                    </div>
                  ) : null}

                  <ul className="divide-y divide-[var(--color-border)] border border-[var(--color-border)]">
                    {activeDetail.attachments.length === 0 ? (
                      <li className="px-2 py-3 text-[var(--color-text-muted)]">No photos yet.</li>
                    ) : null}
                    {activeDetail.attachments.map((a) => (
                      <li className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5" key={a.id}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <AttachmentThumb att={a} />
                            <div className="min-w-0">
                              <p className="truncate font-medium">{a.original_filename}</p>
                              <p className="text-[10px] text-[var(--color-text-muted)]">
                                Stored {formatBytes(a.stored_size_bytes ?? a.file_size_bytes)}
                                {a.image_width != null && a.image_height != null
                                  ? ` · ${a.image_width}×${a.image_height}`
                                  : ""}
                              </p>
                            </div>
                          </div>
                        </div>
                        <Button onClick={() => void openAttachment(a)} size="sm" type="button" variant="secondary">
                          Open
                        </Button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {!detailLoading && !activeDetail ? (
                <p className="text-[var(--color-danger-700)]">Could not load the selected entry.</p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div
          className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]"
          ref={historyRef}
        >
          <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-[var(--space-card)] py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
              Your history ({total})
            </p>
          </div>
          <div className="p-2">
            {listLoading ? (
              <p className="p-2 text-[length:var(--text-body)] text-[var(--color-text-muted)]">Loading…</p>
            ) : null}
            {listError ? (
              <p className="p-2 text-[length:var(--text-body)] text-[var(--color-danger-700)]">{listError}</p>
            ) : null}
            {!listLoading && !listError && items.length === 0 ? (
              <div className="rounded border border-dashed border-[var(--color-border-dark)] bg-[var(--color-empty-panel-bg)] px-4 py-6 text-center text-[length:var(--text-body)] text-[var(--color-text-muted)]">
                No progress entries yet. Submit an update above.
              </div>
            ) : null}
            {!listLoading && items.length > 0 ? (
              <div className="timiq-scroll-x w-full min-w-0 max-w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Photos</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((row) => {
                      const selected = row.id === activeEntryId || row.id === highlightedEntryId;
                      return (
                        <TableRow
                          className={selected ? "bg-[var(--color-header)]" : undefined}
                          key={row.id}
                        >
                          <TableCell>{formatDate(row.work_date)}</TableCell>
                          <TableCell>{row.location_name}</TableCell>
                          <TableCell className="max-w-[14rem]">
                            <span className="line-clamp-2 break-words" title={historyTitleCell(row)}>
                              {historyTitleCell(row)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="grid grid-cols-2 gap-1 sm:flex sm:flex-wrap">
                              {(row.attachments ?? []).slice(0, 4).map((a) => (
                                <button
                                  className="rounded border border-transparent hover:border-[var(--color-action-text)]"
                                  key={a.id}
                                  onClick={() => void openAttachment(a)}
                                  type="button"
                                >
                                  <AttachmentThumb att={a} />
                                </button>
                              ))}
                              {(row.attachments ?? []).length === 0 ? (
                                <span className="text-[length:var(--text-secondary)] text-[var(--color-text-muted)]">—</span>
                              ) : null}
                            </div>
                            <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                              {(row.attachments ?? []).length} file(s)
                            </p>
                          </TableCell>
                          <TableCell>{historyStatusCell(row)}</TableCell>
                          <TableCell>
                            <div className="flex min-w-0 flex-col gap-1 sm:flex-row">
                              <Button
                                onClick={() => openHistoryEntry(row.id, "view")}
                                size="sm"
                                type="button"
                                variant="secondary"
                              >
                                View photos
                              </Button>
                              <Button
                                onClick={() => openHistoryEntry(row.id, "add")}
                                size="sm"
                                type="button"
                                variant="secondary"
                              >
                                Add photos
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </div>
        </div>
      </SheetBody>
    </Sheet>
  );
}
