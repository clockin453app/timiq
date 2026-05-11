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
import {
  WORK_PROGRESS_STATUS_OPTIONS,
  createMyWorkProgress,
  fetchWorkProgressFileBlob,
  fetchWorkProgressMeOptions,
  getMyWorkProgressDetail,
  listMyWorkProgress,
  uploadWorkProgressFile,
  type WorkProgressAttachmentMeta,
  type WorkProgressEntryDetail,
  type WorkProgressListItem,
  type WorkProgressLocationOption,
} from "../../features/work-progress/api";

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function SiteProgressClient() {
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
  const [formBusy, setFormBusy] = useState(false);

  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkProgressEntryDetail | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);

  const loadOptions = useCallback(async () => {
    setOptionsError("");
    try {
      const data = await fetchWorkProgressMeOptions();
      setOptions(data.locations);
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
    if (!lastCreatedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const d = await getMyWorkProgressDetail(lastCreatedId);
        if (!cancelled) {
          setDetail(d);
        }
      } catch {
        if (!cancelled) {
          setDetail(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lastCreatedId]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    setFormBusy(true);
    try {
      let pct: number | null = null;
      if (percent.trim() !== "") {
        const n = Number.parseInt(percent, 10);
        if (Number.isNaN(n) || n < 0 || n > 100) {
          setFormError("Percent complete must be between 0 and 100.");
          setFormBusy(false);
          return;
        }
        pct = n;
      }
      if (!locationId) {
        setFormError("Select a site/location.");
        setFormBusy(false);
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
      const created = await createMyWorkProgress(body);
      setLastCreatedId(created.id);
      setTitle("");
      setNotes("");
      setPercent("");
      await loadList();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setFormBusy(false);
    }
  }

  async function handleUpload(file: File | null) {
    if (!file || !lastCreatedId) {
      return;
    }
    setUploadBusy(true);
    setFormError("");
    try {
      const updated = await uploadWorkProgressFile(lastCreatedId, file);
      setDetail(updated);
      await loadList();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploadBusy(false);
    }
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
        description="Log site work with photos or documents. Only locations you are assigned to appear below."
        title="Site progress"
      />
      <SheetBody className="space-y-4 md:p-5">
        {optionsError ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {optionsError}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
          <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
              New update
            </p>
          </div>
          <form className="space-y-3 p-4" onSubmit={handleSubmit}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-bold text-[var(--color-text-soft)]">
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
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-bold text-[var(--color-text-soft)]">
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
              <label className="block text-xs font-bold text-[var(--color-text-soft)]">
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

        {lastCreatedId && detail ? (
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
            <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                Files for last submitted entry (max 8, 10 MB each)
              </p>
            </div>
            <div className="space-y-2 p-4 text-sm">
              <p className="text-[var(--color-text-muted)]">
                Attachments: {detail.attachments.length} / 8 — JPG, PNG, WebP, or PDF.
              </p>
              <input
                accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                className="text-sm"
                disabled={uploadBusy || detail.attachments.length >= 8}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  void handleUpload(f ?? null);
                }}
                type="file"
              />
              <ul className="divide-y divide-[var(--color-border)] border border-[var(--color-border)]">
                {detail.attachments.map((a) => (
                  <li className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5" key={a.id}>
                    <span className="truncate">{a.original_filename}</span>
                    <Button onClick={() => void openAttachment(a)} size="sm" type="button" variant="secondary">
                      Open
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

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
                    <TableHead>Status</TableHead>
                    <TableHead>Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{formatDate(row.work_date)}</TableCell>
                      <TableCell>{row.location_name}</TableCell>
                      <TableCell>{row.title}</TableCell>
                      <TableCell>{row.progress_status}</TableCell>
                      <TableCell>{row.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}
          </div>
        </div>
      </SheetBody>
    </Sheet>
  );
}
