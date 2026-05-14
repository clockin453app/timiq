"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import {
  Button,
  Input,
  PageHeader,
  Sheet,
  SheetBody,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui";
import { useCurrentUser } from "../../features/auth";
import {
  enqueueWorkProgressPhotos,
  enqueueWorkProgressSubmit,
  isLikelyNetworkFailure,
  isNavigatorOffline,
  photosFromPreparedUploads,
} from "../../features/offline";
import {
  WORK_PROGRESS_FALLBACK_MAX_ATTACHMENTS,
  WORK_PROGRESS_FALLBACK_MAX_ORIGINAL_BYTES,
  WORK_PROGRESS_STATUS_OPTIONS,
  createMyWorkProgress,
  fetchWorkProgressFileBlob,
  fetchWorkProgressMeOptions,
  getMyWorkProgressDetail,
  listMyWorkProgress,
  uploadWorkProgressFile,
  workProgressFileUrl,
  type WorkProgressAttachmentMeta,
  type WorkProgressEntryDetail,
  type WorkProgressListItem,
  type WorkProgressLocationOption,
} from "../../features/work-progress/api";
import {
  isSupportedSiteProgressMime,
  prepareSiteProgressPhotoUpload,
  runWithConcurrency,
  SITE_PROGRESS_UPLOAD_CONCURRENCY,
  yieldToBrowser,
  type PreparedSiteProgressUpload,
} from "../../features/work-progress/image-compression";

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

export function SiteProgressClient() {
  const currentUser = useCurrentUser();
  const [options, setOptions] = useState<WorkProgressLocationOption[]>([]);
  const [optionsError, setOptionsError] = useState("");
  const [items, setItems] = useState<WorkProgressListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [listError, setListError] = useState("");
  const [listLoading, setListLoading] = useState(true);

  const [workDate, setWorkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [locationId, setLocationId] = useState("");
  const [title, setTitle] = useState("");
  const [progressStatus, setProgressStatus] = useState("in_progress");
  const [notes, setNotes] = useState("");
  const [percent, setPercent] = useState("");
  const [formError, setFormError] = useState("");
  const [offlineNotice, setOfflineNotice] = useState("");
  const [formBusy, setFormBusy] = useState(false);

  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [activeDetail, setActiveDetail] = useState<WorkProgressEntryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [stagedPhotoFiles, setStagedPhotoFiles] = useState<File[]>([]);
  const [uploadNotice, setUploadNotice] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploadPhaseLabel, setUploadPhaseLabel] = useState("");
  const [uploadDetailLines, setUploadDetailLines] = useState<string[]>([]);
  const [uploadBarPercent, setUploadBarPercent] = useState(0);
  const [uploadCounts, setUploadCounts] = useState<{
    ok: number;
    fail: number;
    total: number;
  } | null>(null);
  const [maxAttachments, setMaxAttachments] = useState(WORK_PROGRESS_FALLBACK_MAX_ATTACHMENTS);
  const [maxOriginalBytes, setMaxOriginalBytes] = useState(WORK_PROGRESS_FALLBACK_MAX_ORIGINAL_BYTES);

  const loadOptions = useCallback(async () => {
    setOptionsError("");
    try {
      const data = await fetchWorkProgressMeOptions();
      setOptions(data.locations);
      setMaxAttachments(data.max_attachments_per_entry ?? WORK_PROGRESS_FALLBACK_MAX_ATTACHMENTS);
      setMaxOriginalBytes(data.max_original_image_bytes ?? WORK_PROGRESS_FALLBACK_MAX_ORIGINAL_BYTES);
    } catch (err) {
      setOptionsError(err instanceof Error ? err.message : "Could not load allowed sites.");
      setOptions([]);
    }
  }, []);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError("");
    try {
      const data = await listMyWorkProgress({ limit: 100, offset: 0 });
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Could not load history.");
      setItems([]);
      setTotal(0);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    if (locationId || options.length === 0) {
      return;
    }
    setLocationId(options[0].id);
  }, [options, locationId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

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
    setStagedPhotoFiles([]);
    setUploadNotice("");
    setUploadError("");
    setUploadPhaseLabel("");
    setUploadDetailLines([]);
    setUploadBarPercent(0);
    setUploadCounts(null);
  }, [activeEntryId]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    setOfflineNotice("");

    let pct: number | null = null;
    if (percent.trim() !== "") {
      const n = Number.parseInt(percent, 10);
      if (Number.isNaN(n) || n < 0 || n > 100) {
        setFormError("Percent complete must be between 0 and 100.");
        return;
      }
      pct = n;
    }
    if (!locationId) {
      setFormError("Select a site/location.");
      return;
    }
    const body = {
      work_date: workDate,
      location_id: locationId,
      workplace_id: null,
      title: title.trim(),
      progress_status: progressStatus,
      notes: notes.trim() || null,
      percent_complete: pct,
    };

    setFormBusy(true);
    try {
      if (isNavigatorOffline()) {
        await enqueueWorkProgressSubmit(currentUser.id, currentUser.company_id, body, []);
        setOfflineNotice(
          "Queued offline — this update will sync when you are online. Use Sync now in the bar above or wait for an automatic sync.",
        );
        setTitle("");
        setNotes("");
        setPercent("");
        return;
      }
      const created = await createMyWorkProgress(body);
      setActiveEntryId(created.id);
      setTitle("");
      setNotes("");
      setPercent("");
      await loadList();
    } catch (err) {
      if (isLikelyNetworkFailure(err)) {
        try {
          await enqueueWorkProgressSubmit(currentUser.id, currentUser.company_id, body, []);
          setOfflineNotice(
            "Network unavailable — update saved on this device and queued. It will sync when the connection returns.",
          );
          setTitle("");
          setNotes("");
          setPercent("");
        } catch {
          setFormError(err instanceof Error ? err.message : "Save failed.");
        }
      } else {
        setFormError(err instanceof Error ? err.message : "Save failed.");
      }
    } finally {
      setFormBusy(false);
    }
  }

  async function handleUploadPhotos() {
    if (!activeEntryId || !activeDetail || stagedPhotoFiles.length === 0) {
      return;
    }
    const room = Math.max(0, maxAttachments - activeDetail.attachments.length);
    if (room === 0) {
      setUploadNotice("");
      setUploadError(
        `This entry already has the maximum number of photos (${maxAttachments} per entry).`,
      );
      setStagedPhotoFiles([]);
      return;
    }
    if (stagedPhotoFiles.length > room) {
      setUploadNotice("");
      setUploadError(
        `You selected ${stagedPhotoFiles.length} photo(s) but only ${room} slot(s) remain (max ${maxAttachments} per entry). Remove extra files or upload in batches.`,
      );
      return;
    }

    const badType = stagedPhotoFiles.filter((f) => !isSupportedSiteProgressMime(f));
    if (badType.length > 0) {
      setUploadError(
        `Unsupported type (only JPEG, PNG, or WebP): ${badType.map((f) => f.name).join(", ")}`,
      );
      return;
    }

    const progressId = activeEntryId;

    setUploadBusy(true);
    setUploadError("");
    setUploadNotice("");
    setUploadDetailLines([]);
    setUploadBarPercent(0);
    setUploadCounts(null);
    setUploadPhaseLabel("Preparing photos…");

    const prepared: PreparedSiteProgressUpload[] = [];
    const prepareFailures: { file: File; message: string }[] = [];

    for (let i = 0; i < stagedPhotoFiles.length; i++) {
      const file = stagedPhotoFiles[i]!;
      setUploadBarPercent(Math.round(((i + 0.5) / stagedPhotoFiles.length) * 50));
      try {
        const p = await prepareSiteProgressPhotoUpload(file, maxOriginalBytes, {
          onStatus: (msg) => {
            setUploadDetailLines((lines) => {
              const next = [...lines, msg];
              return next.length > 24 ? next.slice(-24) : next;
            });
          },
        });
        prepared.push(p);
        const suffix = p.usedClientCompression ? "" : " (original)";
        setUploadDetailLines((lines) => {
          const line = `${p.displayName}: ${formatBytes(p.originalBytes)} → ${formatBytes(p.uploadBytes)}${suffix}`;
          const next = [...lines, line];
          return next.length > 24 ? next.slice(-24) : next;
        });
      } catch (err) {
        prepareFailures.push({
          file,
          message: err instanceof Error ? err.message : "Could not prepare file.",
        });
      }
      setUploadBarPercent(Math.round(((i + 1) / stagedPhotoFiles.length) * 50));
      await yieldToBrowser();
    }

    if (prepared.length === 0) {
      setUploadPhaseLabel("");
      setUploadBarPercent(0);
      setUploadError(prepareFailures.map((f) => `"${f.file.name}": ${f.message}`).join("\n"));
      setStagedPhotoFiles(prepareFailures.map((f) => f.file));
      setUploadBusy(false);
      return;
    }

    if (isNavigatorOffline()) {
      setUploadError("");
      setOfflineNotice("");
      try {
        await enqueueWorkProgressPhotos(
          currentUser.id,
          currentUser.company_id,
          progressId,
          photosFromPreparedUploads(prepared),
        );
        setOfflineNotice(
          "Photos queued offline — they will upload when you are online. Use Sync now when reconnected.",
        );
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : "Could not queue photos for offline sync.");
        setUploadPhaseLabel("");
        setUploadBarPercent(0);
        setUploadBusy(false);
        return;
      }
      setUploadPhaseLabel("");
      setUploadBarPercent(100);
      setUploadCounts({ ok: prepared.length, fail: prepareFailures.length, total: prepared.length });
      setStagedPhotoFiles(prepareFailures.length > 0 ? prepareFailures.map((f) => f.file) : []);
      setUploadBusy(false);
      return;
    }

    setUploadPhaseLabel("Uploading and optimising photos…");
    setUploadCounts({ ok: 0, fail: 0, total: prepared.length });

    let latestDetail: WorkProgressEntryDetail | null = activeDetail;
    const uploadProgress = { finished: 0 };

    type UploadAttemptResult =
      | { ok: true; detail: WorkProgressEntryDetail }
      | {
          ok: false;
          file: File;
          displayName: string;
          message: string;
        };

    const uploadResults = await runWithConcurrency(
      prepared,
      SITE_PROGRESS_UPLOAD_CONCURRENCY,
      async (prep): Promise<UploadAttemptResult> => {
        try {
          const d = await uploadWorkProgressFile(progressId, prep.uploadFile);
          return { ok: true, detail: d };
        } catch (err) {
          return {
            ok: false,
            file: prep.originalFile,
            displayName: prep.displayName,
            message: err instanceof Error ? err.message : "Upload failed.",
          };
        } finally {
          uploadProgress.finished += 1;
          setUploadBarPercent(
            Math.round(50 + (50 * uploadProgress.finished) / prepared.length),
          );
          setUploadPhaseLabel(
            `Uploading and optimising photos… (${uploadProgress.finished}/${prepared.length})`,
          );
        }
      },
    );

    const uploadFailures: { file: File; displayName: string; message: string }[] = [];
    for (const r of uploadResults) {
      if (r.ok) {
        latestDetail = r.detail;
      } else {
        uploadFailures.push({
          file: r.file,
          displayName: r.displayName,
          message: r.message,
        });
      }
    }

    const okCount = prepared.length - uploadFailures.length;
    setUploadCounts({ ok: okCount, fail: uploadFailures.length, total: prepared.length });

    try {
      const refreshed = await getMyWorkProgressDetail(progressId);
      setActiveDetail(refreshed);
    } catch {
      if (latestDetail) {
        setActiveDetail(latestDetail);
      }
    }
    await loadList();

    const messages: string[] = [];
    if (prepareFailures.length > 0) {
      messages.push(
        ...prepareFailures.map((f) => `"${f.file.name}": ${f.message}`),
      );
    }
    if (uploadFailures.length > 0) {
      messages.push(
        ...uploadFailures.map((f) => `"${f.displayName}": ${f.message}`),
      );
    }
    setUploadError(messages.length > 0 ? messages.join("\n") : "");
    if (messages.length === 0) {
      setUploadDetailLines([]);
    }

    const retryFiles = [
      ...prepareFailures.map((f) => f.file),
      ...uploadFailures.map((f) => f.file),
    ];
    setStagedPhotoFiles(retryFiles.length > 0 ? retryFiles : []);

    setUploadPhaseLabel("");
    setUploadBarPercent(100);
    setUploadBusy(false);
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

  return (
    <Sheet>
      <PageHeader
        description="Log site work with photos. Only locations you are assigned to appear below. Photos are resized in your browser before upload, then validated and optimised again on the server (JPEG, PNG, or WebP)."
        title="Site progress"
      />
      <SheetBody className="min-w-0 space-y-4 md:p-5">
        {optionsError ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {optionsError}
          </div>
        ) : null}

        {offlineNotice ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm text-[var(--color-text)]">
            {offlineNotice}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
          <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
              New update
            </p>
          </div>
          <form className="space-y-3 p-4" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block min-w-0 text-xs font-bold text-[var(--color-text-soft)]">
                <span className="text-[var(--color-text)]">Work date</span>
                <Input
                  className="mt-1"
                  onChange={(e) => setWorkDate(e.target.value)}
                  required
                  type="date"
                  value={workDate}
                />
              </label>
              <label className="block text-xs font-bold text-[var(--color-text-soft)]">
                <span className="text-[var(--color-text)]">Site / location</span>
                <select
                  className="mt-1 h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  onChange={(e) => setLocationId(e.target.value)}
                  required
                  value={locationId}
                >
                  <option value="">Select…</option>
                  {options.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-xs font-bold text-[var(--color-text-soft)]">
              <span className="text-[var(--color-text)]">Title / summary</span>
              <Input className="mt-1" onChange={(e) => setTitle(e.target.value)} required value={title} />
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block min-w-0 text-xs font-bold text-[var(--color-text-soft)]">
                <span className="text-[var(--color-text)]">Progress status</span>
                <select
                  className="mt-1 h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  onChange={(e) => setProgressStatus(e.target.value)}
                  value={progressStatus}
                >
                  {WORK_PROGRESS_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block min-w-0 text-xs font-bold text-[var(--color-text-soft)]">
                <span className="text-[var(--color-text)]">Percent complete (optional)</span>
                <Input
                  className="mt-1"
                  inputMode="numeric"
                  max={100}
                  min={0}
                  onChange={(e) => setPercent(e.target.value)}
                  placeholder="0–100"
                  type="number"
                  value={percent}
                />
              </label>
            </div>
            <label className="block text-xs font-bold text-[var(--color-text-soft)]">
              <span className="text-[var(--color-text)]">Notes / details</span>
              <textarea
                className="mt-1 min-h-[5rem] w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-1.5 text-sm"
                onChange={(e) => setNotes(e.target.value)}
                value={notes}
              />
            </label>
            {formError ? (
              <p className="text-sm text-[var(--color-danger-700)]">{formError}</p>
            ) : null}
            <Button disabled={formBusy || options.length === 0} type="submit" variant="primary">
              {formBusy ? "Saving…" : "Submit progress"}
            </Button>
          </form>
        </div>

        {activeEntryId ? (
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
            <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                Photos for selected entry (max {maxAttachments} per entry; large originals accepted up to{" "}
                {(maxOriginalBytes / (1024 * 1024)).toFixed(0)} MB each before server compression)
              </p>
            </div>
            <div className="space-y-2 p-4 text-sm">
              {detailLoading ? <p className="text-[var(--color-text-muted)]">Loading entry…</p> : null}
              {!detailLoading && activeDetail ? (
                <>
                  <p className="text-[var(--color-text-muted)]">
                    Entry: {formatDate(activeDetail.work_date)} — {activeDetail.location_name} —{" "}
                    {activeDetail.title}
                  </p>
                  <p className="text-[var(--color-text-muted)]">
                    Uploaded: {activeDetail.attachments.length} / {maxAttachments} — Remaining slots:{" "}
                    {Math.max(0, maxAttachments - activeDetail.attachments.length)} — JPEG, PNG, or WebP only.
                  </p>
                  <input
                    accept="image/jpeg,image/png,image/webp"
                    className="text-sm"
                    disabled={uploadBusy || activeDetail.attachments.length >= maxAttachments}
                    multiple
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      setUploadError("");
                      setUploadNotice("");
                      setStagedPhotoFiles(files);
                    }}
                    type="file"
                  />
                  {stagedPhotoFiles.length > 0 ? (
                    <div className="text-xs text-[var(--color-text-muted)]">
                      <p className="font-medium text-[var(--color-text)]">
                        Selected: {stagedPhotoFiles.length} file(s) — will upload when you tap Upload photos below
                        {activeDetail ? (
                          <>
                            {" "}
                            (max {maxAttachments} per entry;{" "}
                            {Math.max(0, maxAttachments - activeDetail.attachments.length)} slot(s) left)
                          </>
                        ) : null}
                      </p>
                      <p className="mt-1 max-h-24 overflow-y-auto break-words">{stagedPhotoFiles.map((f) => f.name).join(", ")}</p>
                    </div>
                  ) : null}
                  {uploadNotice ? <p className="text-xs text-[var(--color-text-muted)]">{uploadNotice}</p> : null}
                  {uploadPhaseLabel || uploadBusy ? (
                    <div className="space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
                      {uploadPhaseLabel ? (
                        <p className="text-xs font-medium text-[var(--color-text)]">{uploadPhaseLabel}</p>
                      ) : null}
                      {uploadBusy ? (
                        <div className="h-2 w-full min-w-0 overflow-hidden rounded bg-[var(--color-border-dark)]">
                          <div
                            className="h-full rounded-sm bg-[var(--color-action-text)] transition-[width] duration-200"
                            style={{ width: `${Math.min(100, Math.max(0, uploadBarPercent))}%` }}
                          />
                        </div>
                      ) : null}
                      {uploadCounts ? (
                        <p className="text-[10px] text-[var(--color-text-muted)]">
                          Uploaded {uploadCounts.ok} / {uploadCounts.total} · Failed {uploadCounts.fail}
                        </p>
                      ) : null}
                      {uploadDetailLines.length > 0 ? (
                        <ul className="max-h-32 list-disc space-y-0.5 overflow-y-auto pl-4 text-[10px] text-[var(--color-text-muted)]">
                          {uploadDetailLines.slice(-12).map((line, idx) => (
                            <li className="break-words" key={`${idx}-${line.slice(0, 48)}`}>
                              {line}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  {uploadError ? (
                    <p className="whitespace-pre-wrap text-sm text-[var(--color-danger-700)]">{uploadError}</p>
                  ) : null}
                  <Button
                    disabled={
                      uploadBusy ||
                      stagedPhotoFiles.length === 0 ||
                      activeDetail.attachments.length >= maxAttachments
                    }
                    onClick={() => void handleUploadPhotos()}
                    type="button"
                    variant="secondary"
                  >
                    {uploadBusy ? "Working…" : "Upload photos"}
                  </Button>
                  <ul className="divide-y divide-[var(--color-border)] border border-[var(--color-border)]">
                    {activeDetail.attachments.map((a) => (
                      <li className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5" key={a.id}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <AttachmentThumb att={a} />
                            <div className="min-w-0">
                              <p className="truncate font-medium">{a.original_filename}</p>
                              <p className="text-[10px] text-[var(--color-text-muted)]">
                                Stored {formatBytes(a.stored_size_bytes ?? a.file_size_bytes)}
                                {a.original_size_bytes != null ? ` · original ${formatBytes(a.original_size_bytes)}` : ""}
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
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">
            Submit an update or select a row below to attach photos to an entry.
          </p>
        )}

        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
          <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
              Your history ({total})
            </p>
          </div>
          <div className="p-2">
            {listLoading ? (
              <p className="p-2 text-sm text-[var(--color-text-muted)]">Loading…</p>
            ) : null}
            {listError ? (
              <p className="p-2 text-sm text-[var(--color-danger-700)]">{listError}</p>
            ) : null}
            {!listLoading && !listError && items.length === 0 ? (
              <div className="rounded border border-dashed border-[var(--color-border-dark)] bg-[var(--color-empty-panel-bg)] px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
                No progress entries yet. Submit an update above.
              </div>
            ) : null}
            {!listLoading && items.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Site</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Photos</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => {
                    const selected = row.id === activeEntryId;
                    return (
                      <TableRow
                        className={selected ? "bg-[var(--color-header)]" : "cursor-pointer"}
                        key={row.id}
                        onClick={() => setActiveEntryId(row.id)}
                      >
                        <TableCell>{formatDate(row.work_date)}</TableCell>
                        <TableCell>{row.location_name}</TableCell>
                        <TableCell className="max-w-[12rem] truncate">{row.title}</TableCell>
                        <TableCell>
                          <div className="grid grid-cols-2 gap-1 sm:flex sm:flex-wrap">
                            {(row.attachments ?? []).slice(0, 4).map((a) => (
                              <button
                                className="rounded border border-transparent hover:border-[var(--color-action-text)]"
                                key={a.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void openAttachment(a);
                                }}
                                type="button"
                              >
                                <AttachmentThumb att={a} />
                              </button>
                            ))}
                            {(row.attachments ?? []).length === 0 ? (
                              <span className="text-xs text-[var(--color-text-muted)]">—</span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                            {(row.attachments ?? []).length} file(s)
                          </p>
                        </TableCell>
                        <TableCell>{row.progress_status}</TableCell>
                        <TableCell>{row.status}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : null}
          </div>
        </div>
      </SheetBody>
    </Sheet>
  );
}
