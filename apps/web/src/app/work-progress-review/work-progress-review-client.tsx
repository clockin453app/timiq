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
import { isAdministrator, LogoutButton, RoleGuard, useCurrentUser } from "../../features/auth";
import { listCompanies, type Company } from "../../features/companies/api";
import {
  acknowledgeWorkProgress,
  bulkDeleteWorkProgressAttachments,
  bulkDownloadWorkProgressAttachments,
  commentWorkProgress,
  downloadWorkProgressReviewCsv,
  fetchWorkProgressFileBlob,
  getWorkProgressReviewDetail,
  listWorkProgressReview,
  listWorkProgressReviewGallery,
  workProgressFileUrl,
  type WorkProgressAttachmentMeta,
  type WorkProgressReviewDetail,
  type WorkProgressReviewGalleryItem,
  type WorkProgressReviewListItem,
} from "../../features/work-progress/api";

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

function GalleryThumb({ att, compact }: { att: WorkProgressAttachmentMeta; compact?: boolean }) {
  if (!isImageAttachment(att)) {
    return (
      <div
        className={`flex items-center justify-center rounded border border-[var(--color-border)] bg-[var(--color-header)] text-xs font-bold text-[var(--color-text-soft)] ${compact ? "h-12 w-12 text-[10px]" : "h-28 w-full"}`}
      >
        PDF
      </div>
    );
  }
  if (compact) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
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
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      className="h-28 w-full rounded border border-[var(--color-border)] object-cover"
      height={112}
      loading="lazy"
      src={workProgressFileUrl(att.id)}
      width={200}
    />
  );
}

function ReviewAdminBody() {
  const user = useCurrentUser();
  const adminAllCompanies = isAdministrator(user);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyFilter, setCompanyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [userIdFilter, setUserIdFilter] = useState("");
  const [locationIdFilter, setLocationIdFilter] = useState("");
  const [titleSearch, setTitleSearch] = useState("");

  const [items, setItems] = useState<WorkProgressReviewListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [listError, setListError] = useState("");
  const [listLoading, setListLoading] = useState(true);

  const [galleryItems, setGalleryItems] = useState<WorkProgressReviewGalleryItem[]>([]);
  const [galleryTotal, setGalleryTotal] = useState(0);
  const [galleryError, setGalleryError] = useState("");
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [galleryBulkError, setGalleryBulkError] = useState("");
  const [exportCsvBusy, setExportCsvBusy] = useState(false);
  const [exportCsvError, setExportCsvError] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkProgressReviewDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);

  const [ackNote, setAckNote] = useState("");
  const [commentText, setCommentText] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const loadCompanies = useCallback(async () => {
    if (!adminAllCompanies) {
      return;
    }
    try {
      const data = await listCompanies();
      setCompanies(data);
    } catch {
      setCompanies([]);
    }
  }, [adminAllCompanies]);

  const refreshListAndGallery = useCallback(async () => {
    setListLoading(true);
    setGalleryLoading(true);
    setListError("");
    setGalleryError("");
    setSelectedFileIds(new Set());
    const base = {
      company_id: adminAllCompanies && companyFilter ? companyFilter : undefined,
      user_id: userIdFilter.trim() || undefined,
      location_id: locationIdFilter.trim() || undefined,
      status: statusFilter.trim() || undefined,
      date_from: dateFrom.trim() || undefined,
      date_to: dateTo.trim() || undefined,
      title_search: titleSearch.trim() || undefined,
    };
    try {
      const [listData, galData] = await Promise.all([
        listWorkProgressReview({ ...base, limit: 100, offset: 0 }),
        listWorkProgressReviewGallery({ ...base, limit: 48, offset: 0 }),
      ]);
      setItems(listData.items);
      setTotal(listData.total);
      setGalleryItems(galData.items);
      setGalleryTotal(galData.total);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not load data.";
      setListError(msg);
      setGalleryError(msg);
      setItems([]);
      setTotal(0);
      setGalleryItems([]);
      setGalleryTotal(0);
    } finally {
      setListLoading(false);
      setGalleryLoading(false);
    }
  }, [
    adminAllCompanies,
    companyFilter,
    dateFrom,
    dateTo,
    locationIdFilter,
    statusFilter,
    titleSearch,
    userIdFilter,
  ]);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  useEffect(() => {
    void refreshListAndGallery();
  }, [refreshListAndGallery]);

  const openDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    setAckNote("");
    setCommentText("");
    setActionError("");
    try {
      const d = await getWorkProgressReviewDetail(id);
      setDetail(d);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Could not load detail.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  async function handleAcknowledge(event: FormEvent) {
    event.preventDefault();
    if (!selectedId) {
      return;
    }
    setActionBusy(true);
    setActionError("");
    try {
      const d = await acknowledgeWorkProgress(selectedId, ackNote.trim() || null);
      setDetail(d);
      setAckNote("");
      await refreshListAndGallery();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Acknowledge failed.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleComment(event: FormEvent) {
    event.preventDefault();
    if (!selectedId) {
      return;
    }
    setActionBusy(true);
    setActionError("");
    try {
      const d = await commentWorkProgress(selectedId, commentText.trim());
      setDetail(d);
      setCommentText("");
      await refreshListAndGallery();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Comment failed.");
    } finally {
      setActionBusy(false);
    }
  }

  async function openFile(fileId: string) {
    try {
      const blob = await fetchWorkProgressFileBlob(fileId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      // ignore
    }
  }

  function toggleFileSelection(fileId: string) {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  }

  async function handleBulkDownload() {
    if (selectedFileIds.size === 0) {
      return;
    }
    setBulkBusy(true);
    setGalleryBulkError("");
    try {
      const blob = await bulkDownloadWorkProgressAttachments(Array.from(selectedFileIds));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "work-progress-attachments.zip";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setGalleryBulkError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedFileIds.size === 0) {
      return;
    }
    if (!window.confirm(`Delete ${selectedFileIds.size} selected attachment(s)? This cannot be undone.`)) {
      return;
    }
    setBulkBusy(true);
    setGalleryBulkError("");
    try {
      await bulkDeleteWorkProgressAttachments(Array.from(selectedFileIds));
      setSelectedFileIds(new Set());
      await refreshListAndGallery();
      if (selectedId) {
        await openDetail(selectedId);
      }
    } catch (err) {
      setGalleryBulkError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBulkBusy(false);
    }
  }

  const selectedCount = selectedFileIds.size;

  const exportReviewCsv = useCallback(async () => {
    setExportCsvError("");
    setExportCsvBusy(true);
    const params = {
      company_id: adminAllCompanies && companyFilter ? companyFilter : undefined,
      user_id: userIdFilter.trim() || undefined,
      location_id: locationIdFilter.trim() || undefined,
      status: statusFilter.trim() || undefined,
      date_from: dateFrom.trim() || undefined,
      date_to: dateTo.trim() || undefined,
      title_search: titleSearch.trim() || undefined,
    };
    try {
      await downloadWorkProgressReviewCsv(params);
    } catch (err) {
      setExportCsvError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExportCsvBusy(false);
    }
  }, [
    adminAllCompanies,
    companyFilter,
    dateFrom,
    dateTo,
    locationIdFilter,
    statusFilter,
    titleSearch,
    userIdFilter,
  ]);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">Filters</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {adminAllCompanies ? (
            <label className="block min-w-0 text-xs font-bold text-[var(--color-text-soft)]">
              <span className="text-[var(--color-text)]">Company</span>
              <select
                className="mt-1 h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                onChange={(e) => setCompanyFilter(e.target.value)}
                value={companyFilter}
              >
                <option value="">All companies</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block min-w-0 text-xs font-bold text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">Status</span>
            <select
              className="mt-1 h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
              onChange={(e) => setStatusFilter(e.target.value)}
              value={statusFilter}
            >
              <option value="">Any</option>
              <option value="submitted">Submitted</option>
              <option value="reviewed">Reviewed</option>
            </select>
          </label>
          <label className="block min-w-0 text-xs font-bold text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">Date from</span>
            <Input className="mt-1" onChange={(e) => setDateFrom(e.target.value)} type="date" value={dateFrom} />
          </label>
          <label className="block min-w-0 text-xs font-bold text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">Date to</span>
            <Input className="mt-1" onChange={(e) => setDateTo(e.target.value)} type="date" value={dateTo} />
          </label>
          <label className="block min-w-0 text-xs font-bold text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">Employee user ID</span>
            <Input className="mt-1 font-mono text-xs" onChange={(e) => setUserIdFilter(e.target.value)} value={userIdFilter} />
          </label>
          <label className="block min-w-0 text-xs font-bold text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">Location ID</span>
            <Input
              className="mt-1 font-mono text-xs"
              onChange={(e) => setLocationIdFilter(e.target.value)}
              value={locationIdFilter}
            />
          </label>
          <label className="block min-w-0 text-xs font-bold text-[var(--color-text-soft)] sm:col-span-2">
            <span className="text-[var(--color-text)]">Title / tag search</span>
            <Input
              className="mt-1"
              onChange={(e) => setTitleSearch(e.target.value)}
              placeholder="Matches entry title"
              value={titleSearch}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button onClick={() => void refreshListAndGallery()} type="button" variant="secondary">
            Apply filters
          </Button>
          <Button
            disabled={exportCsvBusy || total === 0}
            onClick={() => void exportReviewCsv()}
            type="button"
            variant="secondary"
          >
            {exportCsvBusy ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
        {exportCsvError ? (
          <p className="mt-2 text-sm text-[var(--color-danger-700)]">{exportCsvError}</p>
        ) : null}
      </div>

      {listError || galleryError ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
          {listError || galleryError}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
        <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
            Submissions ({total})
          </p>
        </div>
        <div className="p-2">
          {listLoading ? <p className="p-2 text-sm text-[var(--color-text-muted)]">Loading…</p> : null}
          {!listLoading && items.length === 0 ? (
            <p className="p-3 text-sm text-[var(--color-text-muted)]">No rows match the current filters.</p>
          ) : null}
          {!listLoading && items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{formatDate(row.work_date)}</TableCell>
                    <TableCell>
                      <button
                        className="text-left font-medium text-[var(--color-action-text)] underline decoration-[var(--color-border-dark)] underline-offset-2"
                        onClick={() => void openDetail(row.id)}
                        type="button"
                      >
                        {row.employee_name || row.user_email}
                      </button>
                    </TableCell>
                    <TableCell>{row.location_name}</TableCell>
                    <TableCell>{row.title}</TableCell>
                    <TableCell>{row.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
            Attachment gallery ({galleryTotal})
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--color-text-muted)]">Selected: {selectedCount}</span>
            <Button
              disabled={bulkBusy || selectedCount === 0}
              onClick={() => void handleBulkDownload()}
              size="sm"
              type="button"
              variant="secondary"
            >
              {bulkBusy ? "Working…" : "Download ZIP"}
            </Button>
            <Button
              disabled={bulkBusy || selectedCount === 0}
              onClick={() => void handleBulkDelete()}
              size="sm"
              type="button"
              variant="secondary"
            >
              {bulkBusy ? "Working…" : "Delete selected"}
            </Button>
          </div>
        </div>
        {galleryBulkError ? (
          <p className="border-b border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {galleryBulkError}
          </p>
        ) : null}
        <div className="p-3">
          {galleryLoading ? <p className="text-sm text-[var(--color-text-muted)]">Loading gallery…</p> : null}
          {!galleryLoading && galleryItems.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No attachments match the current filters.</p>
          ) : null}
          {!galleryLoading && galleryItems.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {galleryItems.map((row) => {
                const id = row.attachment.id;
                const checked = selectedFileIds.has(id);
                return (
                  <div
                    className="relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-2 text-xs"
                    key={id}
                  >
                    <label className="absolute left-2 top-2 z-10 flex cursor-pointer items-center gap-1 rounded bg-[var(--color-cell)]/90 px-1.5 py-0.5">
                      <input
                        checked={checked}
                        className="h-3.5 w-3.5"
                        onChange={() => toggleFileSelection(id)}
                        type="checkbox"
                      />
                    </label>
                    <button
                      className="block w-full text-left"
                      onClick={() => void openFile(id)}
                      type="button"
                    >
                      <GalleryThumb att={row.attachment} />
                    </button>
                    <p className="mt-2 font-medium text-[var(--color-text)]">
                      {row.employee_name || row.user_email}
                    </p>
                    <p className="text-[var(--color-text-muted)]">{row.location_name}</p>
                    <p className="text-[var(--color-text-muted)]">{formatDate(row.work_date)}</p>
                    <p className="mt-1 line-clamp-2 font-medium text-[var(--color-text)]">{row.title}</p>
                    <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                      {row.attachment.original_filename} · stored {formatBytes(row.attachment.stored_size_bytes ?? row.attachment.file_size_bytes)}
                      {row.attachment.image_width != null && row.attachment.image_height != null
                        ? ` · ${row.attachment.image_width}×${row.attachment.image_height}`
                        : ""}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {selectedId ? (
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
          <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
              Detail
            </p>
          </div>
          <div className="space-y-3 p-4 text-sm">
            {detailLoading ? <p className="text-[var(--color-text-muted)]">Loading detail…</p> : null}
            {detailError ? <p className="text-[var(--color-danger-700)]">{detailError}</p> : null}
            {detail ? (
              <>
                <dl className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-[var(--color-text-muted)]">Employee</dt>
                    <dd className="font-medium">{detail.employee_name || detail.user_email}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--color-text-muted)]">Work date</dt>
                    <dd>{formatDate(detail.work_date)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--color-text-muted)]">Site</dt>
                    <dd>{detail.location_name}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--color-text-muted)]">Progress status</dt>
                    <dd>{detail.progress_status}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-[var(--color-text-muted)]">Title</dt>
                    <dd className="font-medium">{detail.title}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-[var(--color-text-muted)]">Notes</dt>
                    <dd className="whitespace-pre-wrap">{detail.notes || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--color-text-muted)]">Review status</dt>
                    <dd>{detail.status}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--color-text-muted)]">Percent</dt>
                    <dd>{detail.percent_complete ?? "—"}</dd>
                  </div>
                </dl>
                {detail.review_note ? (
                  <div className="rounded border border-[var(--color-border)] bg-[var(--color-header)] p-2">
                    <p className="text-xs font-bold text-[var(--color-text-soft)]">Review notes</p>
                    <p className="mt-1 whitespace-pre-wrap text-[var(--color-text)]">{detail.review_note}</p>
                  </div>
                ) : null}
                <div>
                  <p className="text-xs font-bold text-[var(--color-text-soft)]">Attachments</p>
                  <ul className="mt-1 divide-y divide-[var(--color-border)] border border-[var(--color-border)]">
                    {detail.attachments.map((a) => (
                      <li className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5" key={a.id}>
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <div className="shrink-0">
                            <GalleryThumb att={a} compact />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate">{a.original_filename}</p>
                            <p className="text-[10px] text-[var(--color-text-muted)]">
                              {formatBytes(a.stored_size_bytes ?? a.file_size_bytes)}
                              {a.image_width != null && a.image_height != null
                                ? ` · ${a.image_width}×${a.image_height}`
                                : ""}
                            </p>
                          </div>
                        </div>
                        <Button onClick={() => void openFile(a.id)} size="sm" type="button" variant="secondary">
                          Open
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
                {actionError ? <p className="text-[var(--color-danger-700)]">{actionError}</p> : null}
                {detail.status === "submitted" ? (
                  <form className="space-y-2 border-t border-[var(--color-border)] pt-3" onSubmit={handleAcknowledge}>
                    <p className="text-xs font-bold text-[var(--color-text-soft)]">Acknowledge</p>
                    <textarea
                      className="min-h-[3rem] w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-1 text-sm"
                      onChange={(e) => setAckNote(e.target.value)}
                      placeholder="Optional note"
                      value={ackNote}
                    />
                    <Button disabled={actionBusy} type="submit" variant="primary">
                      {actionBusy ? "Working…" : "Mark reviewed"}
                    </Button>
                  </form>
                ) : null}
                {detail.status === "reviewed" ? (
                  <form className="space-y-2 border-t border-[var(--color-border)] pt-3" onSubmit={handleComment}>
                    <p className="text-xs font-bold text-[var(--color-text-soft)]">Add comment</p>
                    <textarea
                      className="min-h-[3rem] w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-1 text-sm"
                      onChange={(e) => setCommentText(e.target.value)}
                      required
                      value={commentText}
                    />
                    <Button disabled={actionBusy} type="submit" variant="secondary">
                      {actionBusy ? "Working…" : "Append comment"}
                    </Button>
                  </form>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function WorkProgressReviewClient() {
  return (
    <Sheet>
      <PageHeader
        action={<LogoutButton />}
        description="Review site progress from employees you manage. Files open in a protected session."
        title="Work progress review"
      />
      <SheetBody className="min-w-0 space-y-4 md:p-5">
        <RoleGuard
          allowedRoles={["administrator", "admin"]}
          fallback={
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm text-[var(--color-text)]">
              You do not have permission to review work progress.
            </div>
          }
        >
          <ReviewAdminBody />
        </RoleGuard>
      </SheetBody>
    </Sheet>
  );
}
