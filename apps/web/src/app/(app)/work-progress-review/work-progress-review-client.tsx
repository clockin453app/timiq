"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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
} from "@/components/ui";
import { isAdministrator, RoleGuard, useCurrentUser } from "@/features/auth";
import { listCompanies, type Company } from "@/features/companies/api";
import { listLocations, type Location } from "@/features/locations/api";
import {
  archiveWorkProgressReviewEntry,
  bulkDeleteWorkProgressAttachments,
  bulkDownloadWorkProgressAttachments,
  fetchWorkProgressFileBlob,
  listWorkProgressEmployeeFilterOptions,
  listWorkProgressReview,
  listWorkProgressReviewGallery,
  permanentDeleteWorkProgressSubmission,
  WORK_PROGRESS_GALLERY_PAGE_SIZE,
  WORK_PROGRESS_SELECTION_MAX,
  WORK_PROGRESS_ZIP_MAX_FILES,
  workProgressThumbnailUrl,
  type WorkProgressAttachmentMeta,
  type WorkProgressEmployeeFilterOption,
  type WorkProgressReviewGalleryItem,
  type WorkProgressReviewListItem,
} from "@/features/work-progress/api";
import { useT } from "@/lib/i18n";

const SUBMISSION_PAGE_SIZE = 25;
const COMPACT_ACTION_BTN =
  "h-7 min-h-[28px] px-2 text-xs font-semibold leading-none";
const DENSE_HEAD = "px-2 py-1 text-[11px] font-bold uppercase tracking-wide";
const DENSE_CELL = "px-2 py-1 text-xs";

function formatDate(iso: string) {
  const value = new Date(iso);
  return Number.isNaN(value.getTime())
    ? iso
    : value.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function formatBytes(value: number | null | undefined) {
  if (value == null) return "Size unavailable";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function employeeLabel(option: WorkProgressEmployeeFilterOption) {
  const name = option.display_name?.trim() || option.email;
  return option.is_active ? name : `${name} (inactive)`;
}

function TruncateText({ value, className }: { value: string; className?: string }) {
  return (
    <span
      className={`block truncate focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${className ?? ""}`}
      tabIndex={0}
      title={value}
    >
      {value}
    </span>
  );
}

type ViewerItem = {
  attachment: WorkProgressAttachmentMeta;
  employee: string;
  site: string;
  workDate: string;
  title: string;
};

type PictureTileProps = {
  row: WorkProgressReviewGalleryItem;
  checked: boolean;
  metadataOpen: boolean;
  checkbox: ReactNode;
  onMetadata: () => void;
  onOpen: (button: HTMLButtonElement | null) => void;
};

function PictureTile({
  row,
  checked,
  metadataOpen,
  checkbox,
  onMetadata,
  onOpen,
}: PictureTileProps) {
  const [broken, setBroken] = useState(false);
  const openButton = useRef<HTMLButtonElement | null>(null);
  const metadataId = `picture-meta-${row.attachment.id}`;
  const dimensions =
    row.attachment.image_width != null && row.attachment.image_height != null
      ? `${row.attachment.image_width}×${row.attachment.image_height}`
      : "Dimensions unavailable";
  const metadata = `${row.employee_name || row.user_email}. ${row.location_name}. ${formatDate(
    row.work_date,
  )}. ${row.title}. ${row.attachment.original_filename}. ${dimensions}. ${formatBytes(
    row.attachment.stored_size_bytes ?? row.attachment.file_size_bytes,
  )}.`;

  return (
    <article
      className={`group relative overflow-visible rounded-[var(--radius-md)] ${
        checked ? "ring-2 ring-[var(--color-accent)]" : ""
      }`}
    >
      <div className="relative aspect-square overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)]">
        {checkbox}
        <button
          aria-describedby={metadataId}
          aria-label={`Open ${row.attachment.original_filename}`}
          className="absolute inset-0 block h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]"
          onClick={() => onOpen(openButton.current)}
          ref={openButton}
          type="button"
        >
          {broken ? (
            <span className="flex h-full items-center justify-center px-2 text-center text-xs font-semibold text-[var(--color-text-soft)]">
              Unavailable
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              className="h-full w-full object-cover"
              decoding="async"
              loading="lazy"
              onError={() => setBroken(true)}
              src={workProgressThumbnailUrl(row.attachment.id)}
            />
          )}
        </button>
        <button
          aria-controls={metadataId}
          aria-expanded={metadataOpen}
          aria-label={`Information for ${row.attachment.original_filename}`}
          className="absolute bottom-1 right-1 z-20 rounded bg-[var(--color-cell)]/95 px-2 py-1 text-[10px] font-bold shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          onClick={onMetadata}
          type="button"
        >
          Info
        </button>
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 max-h-full overflow-hidden bg-black/80 p-2 pr-12 text-[10px] leading-snug text-white transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${
            metadataOpen ? "opacity-100" : "opacity-0"
          }`}
        >
          <p>{row.employee_name || row.user_email}</p>
          <p>{row.location_name} · {formatDate(row.work_date)}</p>
          <p className="truncate">{row.title}</p>
          <p className="truncate">{row.attachment.original_filename}</p>
          <p>{dimensions} · {formatBytes(row.attachment.stored_size_bytes ?? row.attachment.file_size_bytes)}</p>
        </div>
      </div>
      <span className="sr-only" id={metadataId}>{metadata}</span>
    </article>
  );
}

function WorkProgressPicturesBody() {
  const user = useCurrentUser();
  const administrator = isAdministrator(user);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [employees, setEmployees] = useState<WorkProgressEmployeeFilterOption[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [titleSearch, setTitleSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);

  const [submissions, setSubmissions] = useState<WorkProgressReviewListItem[]>([]);
  const [submissionTotal, setSubmissionTotal] = useState(0);
  const [submissionOffset, setSubmissionOffset] = useState(0);
  const [submissionLoading, setSubmissionLoading] = useState(true);
  const [submissionError, setSubmissionError] = useState("");

  const [pictures, setPictures] = useState<WorkProgressReviewGalleryItem[]>([]);
  const [pictureTotal, setPictureTotal] = useState(0);
  const [pictureOffset, setPictureOffset] = useState(0);
  const [pictureLoading, setPictureLoading] = useState(true);
  const [pictureError, setPictureError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [shownSubmission, setShownSubmission] = useState<WorkProgressReviewListItem | null>(null);
  const [metadataOpenId, setMetadataOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [bulkError, setBulkError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<WorkProgressReviewListItem | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const deleteOpenerRef = useRef<HTMLButtonElement | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement | null>(null);

  const [viewerItems, setViewerItems] = useState<ViewerItem[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState("");
  const viewerOpener = useRef<HTMLButtonElement | null>(null);

  const baseFilters = useMemo(
    () => ({
      company_id: administrator && companyId ? companyId : undefined,
      user_id: employeeId || undefined,
      location_id: locationId || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      title_search: titleSearch.trim() || undefined,
      include_archived: includeArchived,
    }),
    [administrator, companyId, dateFrom, dateTo, employeeId, includeArchived, locationId, titleSearch],
  );

  const clearForFilterChange = useCallback(() => {
    setSelectedIds(new Set());
    setSubmissionOffset(0);
    setPictureOffset(0);
    setShownSubmission(null);
    setMetadataOpenId(null);
    setMessage("");
    setBulkError("");
  }, []);

  useEffect(() => {
    if (!administrator) return;
    void listCompanies().then(setCompanies).catch(() => setCompanies([]));
  }, [administrator]);

  useEffect(() => {
    if (administrator && !companyId) {
      setEmployees([]);
      setLocations([]);
      return;
    }
    const scope = administrator ? companyId : undefined;
    void Promise.all([listWorkProgressEmployeeFilterOptions(scope), listLocations(scope)])
      .then(([employeeRows, locationRows]) => {
        setEmployees(employeeRows);
        setLocations(locationRows);
      })
      .catch(() => {
        setEmployees([]);
        setLocations([]);
      });
  }, [administrator, companyId]);

  useEffect(() => {
    let active = true;
    setSubmissionLoading(true);
    setSubmissionError("");
    void listWorkProgressReview({
      ...baseFilters,
      limit: SUBMISSION_PAGE_SIZE,
      offset: submissionOffset,
    })
      .then((data) => {
        if (!active) return;
        setSubmissions(data.items);
        setSubmissionTotal(data.total);
      })
      .catch((error) => {
        if (!active) return;
        setSubmissionError(error instanceof Error ? error.message : "Could not load submissions.");
        setSubmissions([]);
        setSubmissionTotal(0);
      })
      .finally(() => {
        if (active) setSubmissionLoading(false);
      });
    return () => {
      active = false;
    };
  }, [baseFilters, refreshToken, submissionOffset]);

  useEffect(() => {
    let active = true;
    setPictureLoading(true);
    setPictureError("");
    void listWorkProgressReviewGallery({
      ...baseFilters,
      entry_id: shownSubmission?.id,
      limit: WORK_PROGRESS_GALLERY_PAGE_SIZE,
      offset: pictureOffset,
    })
      .then((data) => {
        if (!active) return;
        setPictures(data.items);
        setPictureTotal(data.total);
      })
      .catch((error) => {
        if (!active) return;
        setPictureError(error instanceof Error ? error.message : "Could not load pictures.");
        setPictures([]);
        setPictureTotal(0);
      })
      .finally(() => {
        if (active) setPictureLoading(false);
      });
    return () => {
      active = false;
    };
  }, [baseFilters, pictureOffset, refreshToken, shownSubmission]);

  const filteredEmployees = useMemo(() => {
    const search = employeeSearch.trim().toLowerCase();
    if (!search) return employees;
    return employees.filter(
      (item) =>
        (item.display_name || "").toLowerCase().includes(search) ||
        item.email.toLowerCase().includes(search),
    );
  }, [employeeSearch, employees]);

  const viewerList = useMemo<ViewerItem[]>(
    () =>
      pictures.map((row) => ({
        attachment: row.attachment,
        employee: row.employee_name || row.user_email,
        site: row.location_name,
        workDate: row.work_date,
        title: row.title,
      })),
    [pictures],
  );
  const viewerItem = viewerIndex == null ? null : viewerItems[viewerIndex] ?? null;

  useEffect(() => {
    if (!viewerItem) {
      setViewerUrl(null);
      setViewerError("");
      return;
    }
    let disposed = false;
    let objectUrl: string | null = null;
    setViewerLoading(true);
    setViewerError("");
    setViewerUrl(null);
    void fetchWorkProgressFileBlob(viewerItem.attachment.id)
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setViewerUrl(objectUrl);
      })
      .catch((error) => {
        if (!disposed) setViewerError(error instanceof Error ? error.message : "Could not open picture.");
      })
      .finally(() => {
        if (!disposed) setViewerLoading(false);
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [viewerItem]);

  const closeViewer = useCallback(() => {
    const opener = viewerOpener.current;
    setViewerItems([]);
    setViewerIndex(null);
    window.setTimeout(() => opener?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!viewerItem) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeViewer();
      if (event.key === "ArrowLeft") setViewerIndex((index) => index == null ? index : Math.max(0, index - 1));
      if (event.key === "ArrowRight") {
        setViewerIndex((index) => index == null ? index : Math.min(viewerItems.length - 1, index + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = oldOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [closeViewer, viewerItem, viewerItems.length]);

  function updateFilter(update: () => void) {
    clearForFilterChange();
    update();
  }

  function togglePicture(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < WORK_PROGRESS_SELECTION_MAX) next.add(id);
      else setMessage("Selection is limited to 200 pictures.");
      return next;
    });
  }

  function selectCurrentPage() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const row of pictures) {
        if (next.size >= WORK_PROGRESS_SELECTION_MAX) {
          setMessage("Selection is limited to 200 pictures.");
          break;
        }
        next.add(row.attachment.id);
      }
      return next;
    });
  }

  async function downloadZip() {
    if (selectedIds.size === 0) return;
    if (selectedIds.size > WORK_PROGRESS_ZIP_MAX_FILES) {
      setBulkError("ZIP limited to 48 pictures.");
      return;
    }
    setBusy(true);
    setBulkError("");
    try {
      const blob = await bulkDownloadWorkProgressAttachments(Array.from(selectedIds));
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "work-progress-pictures.zip";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : "Could not download ZIP.");
    } finally {
      setBusy(false);
    }
  }

  async function deletePictures() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Permanently delete ${selectedIds.size} selected picture(s)? This cannot be undone.`)) return;
    setBusy(true);
    setBulkError("");
    try {
      const result = await bulkDeleteWorkProgressAttachments(Array.from(selectedIds));
      setSelectedIds(new Set());
      setMessage(
        result.warning
          ? `Deleted ${result.deleted_count} picture records. ${result.warning}`
          : `Deleted ${result.deleted_count} picture(s). Storage cleaned for ${result.storage_cleanup_ok}.`,
      );
      setRefreshToken((value) => value + 1);
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : "Could not delete pictures.");
    } finally {
      setBusy(false);
    }
  }

  async function archiveSubmission(row: WorkProgressReviewListItem) {
    const confirmed = window.confirm(
      "Archive this submission?\n\nIt will disappear from active management views. Its attachments and audit history will be preserved. This is not permanent deletion.",
    );
    if (!confirmed) return;
    setBusy(true);
    setSubmissionError("");
    try {
      await archiveWorkProgressReviewEntry(row.id);
      if (shownSubmission?.id === row.id) {
        setShownSubmission(null);
        setPictureOffset(0);
        setSelectedIds(new Set());
      }
      setRefreshToken((value) => value + 1);
      setMessage("Submission archived. Pictures and audit history were preserved.");
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : "Could not archive submission.");
    } finally {
      setBusy(false);
    }
  }

  function openPermanentDelete(row: WorkProgressReviewListItem, opener: HTMLButtonElement | null) {
    deleteOpenerRef.current = opener;
    setDeleteConfirmText("");
    setDeleteError("");
    setDeleteTarget(row);
  }

  function closePermanentDelete() {
    setDeleteTarget(null);
    setDeleteConfirmText("");
    setDeleteError("");
    window.requestAnimationFrame(() => {
      deleteOpenerRef.current?.focus();
    });
  }

  async function confirmPermanentDelete() {
    if (!deleteTarget || deleteConfirmText.trim() !== "DELETE") return;
    const target = deleteTarget;
    setBusy(true);
    setDeleteError("");
    setSubmissionError("");
    try {
      const result = await permanentDeleteWorkProgressSubmission(target.id);
      const remainingOnPage = submissions.filter((row) => row.id !== target.id);
      // Stale IDs can belong to pictures outside the current gallery page, so drop the whole set.
      setSelectedIds(new Set());
      if (shownSubmission?.id === target.id) {
        setShownSubmission(null);
        setPictureOffset(0);
      }
      if (remainingOnPage.length === 0 && submissionOffset > 0) {
        setSubmissionOffset(Math.max(0, submissionOffset - SUBMISSION_PAGE_SIZE));
      }
      setDeleteTarget(null);
      setDeleteConfirmText("");
      setMessage(
        result.warning
          ? `Permanently deleted submission and ${result.deleted_attachment_count} picture(s). ${result.warning}`
          : `Permanently deleted submission and ${result.deleted_attachment_count} picture(s).`,
      );
      setRefreshToken((value) => value + 1);
      window.requestAnimationFrame(() => {
        deleteOpenerRef.current?.focus();
      });
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not permanently delete submission.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!deleteTarget) return;
    const dialog = deleteDialogRef.current;
    deleteCancelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busy) closePermanentDelete();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [deleteTarget, busy]);

  const deleteConfirmReady = deleteConfirmText.trim() === "DELETE";
  const submissionStart = submissionTotal === 0 ? 0 : submissionOffset + 1;
  const submissionEnd = submissionOffset + submissions.length;
  const pictureStart = pictureTotal === 0 ? 0 : pictureOffset + 1;
  const pictureEnd = pictureOffset + pictures.length;

  return (
    <div className="space-y-4">
      <section className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">Filters</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {administrator ? (
            <label className="text-xs font-bold">
              Company
              <select
                className="mt-1 h-9 w-full rounded border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                onChange={(event) => updateFilter(() => {
                  setCompanyId(event.target.value);
                  setEmployeeId("");
                  setLocationId("");
                })}
                value={companyId}
              >
                <option value="">All companies</option>
                {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            </label>
          ) : null}
          <label className="text-xs font-bold sm:col-span-2">
            Employee
            <Input
              className="mt-1"
              onChange={(event) => setEmployeeSearch(event.target.value)}
              placeholder="Search employees by name or email"
              value={employeeSearch}
            />
            <select
              className="mt-1 h-9 w-full rounded border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
              disabled={administrator && !companyId}
              onChange={(event) => updateFilter(() => setEmployeeId(event.target.value))}
              value={employeeId}
            >
              <option value="">All employees</option>
              {filteredEmployees.map((employee) => (
                <option key={employee.user_id} value={employee.user_id}>{employeeLabel(employee)} — {employee.email}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            Site
            <select
              className="mt-1 h-9 w-full rounded border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
              disabled={administrator && !companyId}
              onChange={(event) => updateFilter(() => setLocationId(event.target.value))}
              value={locationId}
            >
              <option value="">All sites</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold">
            Date from
            <Input className="mt-1" onChange={(event) => updateFilter(() => setDateFrom(event.target.value))} type="date" value={dateFrom} />
          </label>
          <label className="text-xs font-bold">
            Date to
            <Input className="mt-1" onChange={(event) => updateFilter(() => setDateTo(event.target.value))} type="date" value={dateTo} />
          </label>
          <label className="text-xs font-bold sm:col-span-2">
            Title / type
            <Input className="mt-1" onChange={(event) => updateFilter(() => setTitleSearch(event.target.value))} placeholder="Search submission title" value={titleSearch} />
          </label>
          <label className="flex items-center gap-2 self-end py-2 text-sm font-semibold">
            <input checked={includeArchived} onChange={(event) => updateFilter(() => setIncludeArchived(event.target.checked))} type="checkbox" />
            Include archived submissions
          </label>
        </div>
      </section>

      <section className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
        <header className="flex items-center justify-between border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider">Submissions ({submissionTotal})</p>
          <span className="text-xs text-[var(--color-text-muted)]">{submissionStart}–{submissionEnd} of {submissionTotal}</span>
        </header>
        {submissionError ? <p className="px-3 py-2 text-sm text-[var(--color-danger-700)]">{submissionError}</p> : null}
        <div className="w-full min-w-0 max-w-full overflow-x-auto p-2">
          {submissionLoading ? <p className="p-2 text-sm text-[var(--color-text-muted)]">Loading submissions…</p> : null}
          {!submissionLoading && submissions.length === 0 ? <p className="p-2 text-sm text-[var(--color-text-muted)]">No submissions match these filters.</p> : null}
          {!submissionLoading && submissions.length > 0 ? (
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className={`${DENSE_HEAD} w-[6.5rem]`}>Date</TableHead>
                  <TableHead className={DENSE_HEAD}>Employee</TableHead>
                  <TableHead className={DENSE_HEAD}>Site</TableHead>
                  <TableHead className={DENSE_HEAD}>Title / type</TableHead>
                  <TableHead className={`${DENSE_HEAD} w-14 text-right`}>Pictures</TableHead>
                  <TableHead className={`${DENSE_HEAD} whitespace-nowrap`}>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.map((row) => {
                  const employee = row.employee_name || row.user_email;
                  return (
                  <TableRow className={row.status === "archived" ? "opacity-65" : undefined} key={row.id}>
                    <TableCell className={`${DENSE_CELL} w-[6.5rem] whitespace-nowrap`}>{formatDate(row.work_date)}</TableCell>
                    <TableCell className={`${DENSE_CELL} max-w-[9rem]`}>
                      <TruncateText value={employee} />
                    </TableCell>
                    <TableCell className={`${DENSE_CELL} max-w-[9rem]`}>
                      <TruncateText value={row.location_name} />
                    </TableCell>
                    <TableCell className={`${DENSE_CELL} max-w-[14rem]`}>
                      <span className="inline-flex max-w-full items-center gap-1">
                        <TruncateText className="min-w-0" value={row.title} />
                        {row.status === "archived" ? (
                          <span className="shrink-0 text-[10px] font-bold uppercase text-[var(--color-text-muted)]">Archived</span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className={`${DENSE_CELL} w-14 text-right tabular-nums`}>{row.attachment_count}</TableCell>
                    <TableCell className={`${DENSE_CELL} whitespace-nowrap`}>
                      <div className="hidden flex-wrap items-center gap-1 md:flex">
                        <Button
                          aria-label="Show pictures from this submission"
                          className={COMPACT_ACTION_BTN}
                          onClick={() => {
                            setShownSubmission(row);
                            setPictureOffset(0);
                            setSelectedIds(new Set());
                          }}
                          size="sm"
                          title="Show pictures from this submission"
                          type="button"
                          variant="secondary"
                        >
                          Pictures
                        </Button>
                        <Button
                          aria-label="Archive this submission"
                          className={COMPACT_ACTION_BTN}
                          disabled={busy || row.status === "archived"}
                          onClick={() => void archiveSubmission(row)}
                          size="sm"
                          title="Archive this submission"
                          type="button"
                          variant="secondary"
                        >
                          Archive
                        </Button>
                        <Button
                          aria-label="Permanently delete this submission"
                          className={COMPACT_ACTION_BTN}
                          disabled={busy}
                          onClick={(event) => openPermanentDelete(row, event.currentTarget)}
                          size="sm"
                          title="Permanently delete this submission"
                          type="button"
                          variant="danger"
                        >
                          Delete
                        </Button>
                      </div>
                      <label className="md:hidden">
                        <span className="sr-only">Actions for {row.title}</span>
                        <select
                          aria-label={`Actions for ${row.title}`}
                          className="timiq-select h-8 w-full min-w-0 max-w-[11rem] rounded border border-[var(--color-border-dark)] bg-[var(--color-input)] px-1"
                          defaultValue=""
                          disabled={busy}
                          onChange={(event) => {
                            const action = event.target.value;
                            event.target.value = "";
                            if (action === "pictures") {
                              setShownSubmission(row);
                              setPictureOffset(0);
                              setSelectedIds(new Set());
                            } else if (action === "archive") {
                              void archiveSubmission(row);
                            } else if (action === "delete") {
                              openPermanentDelete(row, event.currentTarget as unknown as HTMLButtonElement);
                            }
                          }}
                        >
                          <option disabled value="">Actions…</option>
                          <option value="pictures">Pictures</option>
                          <option disabled={row.status === "archived"} value="archive">Archive</option>
                          <option value="delete">Delete</option>
                        </select>
                      </label>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-[var(--color-border)] px-3 py-2">
          <Button disabled={submissionOffset === 0 || submissionLoading} onClick={() => setSubmissionOffset(Math.max(0, submissionOffset - SUBMISSION_PAGE_SIZE))} size="sm" type="button" variant="secondary">Previous</Button>
          <Button disabled={submissionOffset + submissions.length >= submissionTotal || submissionLoading} onClick={() => setSubmissionOffset(submissionOffset + SUBMISSION_PAGE_SIZE)} size="sm" type="button" variant="secondary">Next</Button>
        </footer>
      </section>

      <section className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider">Picture gallery ({pictureTotal})</p>
            <p className="text-xs text-[var(--color-text-muted)]">Selected: {selectedIds.size} · ZIP limited to 48 pictures</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={selectCurrentPage} size="sm" type="button" variant="secondary">Select current page ({pictures.length})</Button>
            <Button onClick={() => setSelectedIds(new Set())} size="sm" type="button" variant="secondary">Clear selection</Button>
            <Button disabled={busy || selectedIds.size === 0 || selectedIds.size > WORK_PROGRESS_ZIP_MAX_FILES} onClick={() => void downloadZip()} size="sm" type="button" variant="secondary">Download ZIP</Button>
            <Button disabled={busy || selectedIds.size === 0} onClick={() => void deletePictures()} size="sm" type="button" variant="secondary">Delete selected</Button>
          </div>
        </header>
        {shownSubmission ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2 text-sm">
            <p>Showing pictures from <strong>{shownSubmission.employee_name || shownSubmission.user_email}</strong> — {shownSubmission.title} — {formatDate(shownSubmission.work_date)}</p>
            <Button onClick={() => {
              setShownSubmission(null);
              setPictureOffset(0);
              setSelectedIds(new Set());
            }} size="sm" type="button" variant="secondary">Show all pictures</Button>
          </div>
        ) : null}
        {bulkError || pictureError ? <p className="px-3 py-2 text-sm text-[var(--color-danger-700)]">{bulkError || pictureError}</p> : null}
        {message ? <p className="px-3 py-2 text-sm text-[var(--color-text-muted)]">{message}</p> : null}
        <div className="flex items-center justify-between border-y border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
          <span>{pictureStart}–{pictureEnd} of {pictureTotal}</span>
          <div className="flex gap-2">
            <Button disabled={pictureOffset === 0 || pictureLoading} onClick={() => setPictureOffset(Math.max(0, pictureOffset - WORK_PROGRESS_GALLERY_PAGE_SIZE))} size="sm" type="button" variant="secondary">Previous</Button>
            <Button disabled={pictureOffset + pictures.length >= pictureTotal || pictureLoading} onClick={() => setPictureOffset(pictureOffset + WORK_PROGRESS_GALLERY_PAGE_SIZE)} size="sm" type="button" variant="secondary">Next</Button>
          </div>
        </div>
        <div className="p-3">
          {pictureLoading ? <p className="text-sm text-[var(--color-text-muted)]">Loading pictures…</p> : null}
          {!pictureLoading && pictures.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">No pictures match these filters.</p> : null}
          {!pictureLoading && pictures.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
              {pictures.map((row, index) => (
                <PictureTile
                  checked={selectedIds.has(row.attachment.id)}
                  checkbox={<label className="absolute left-1 top-1 z-20 rounded bg-[var(--color-cell)]/95 p-1"><span className="sr-only">Select {row.attachment.original_filename}</span><input checked={selectedIds.has(row.attachment.id)} onChange={() => togglePicture(row.attachment.id)} type="checkbox" /></label>}
                  key={row.attachment.id}
                  metadataOpen={metadataOpenId === row.attachment.id}
                  onMetadata={() => setMetadataOpenId((current) => current === row.attachment.id ? null : row.attachment.id)}
                  onOpen={(button) => {
                    viewerOpener.current = button;
                    setViewerItems(viewerList);
                    setViewerIndex(index);
                  }}
                  row={row}
                />
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {viewerItem ? (
        <div aria-modal="true" className="fixed inset-0 z-[2200] flex items-center justify-center bg-black/70 p-3" onClick={closeViewer} role="dialog">
          <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded bg-[var(--color-sheet)]" onClick={(event) => event.stopPropagation()}>
            <header className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-border-dark)] p-3">
              <div><p className="font-semibold">{viewerItem.title}</p><p className="text-xs text-[var(--color-text-muted)]">{viewerItem.employee} · {viewerItem.site} · {formatDate(viewerItem.workDate)} · {viewerItem.attachment.original_filename}</p></div>
              <div className="flex gap-2">
                <Button disabled={viewerIndex === 0} onClick={() => setViewerIndex((value) => value == null ? value : Math.max(0, value - 1))} size="sm" type="button" variant="secondary">Previous</Button>
                <Button disabled={viewerIndex === viewerItems.length - 1} onClick={() => setViewerIndex((value) => value == null ? value : Math.min(viewerItems.length - 1, value + 1))} size="sm" type="button" variant="secondary">Next</Button>
                <Button onClick={closeViewer} size="sm" type="button" variant="secondary">Close</Button>
              </div>
            </header>
            <div className="flex min-h-52 flex-1 items-center justify-center overflow-auto p-3">
              {viewerLoading ? <p>Loading picture…</p> : null}
              {viewerError ? <p className="text-[var(--color-danger-700)]">{viewerError}</p> : null}
              {viewerUrl && !viewerError ? <img alt={viewerItem.attachment.original_filename} className="max-h-[calc(100dvh-9rem)] max-w-full object-contain" src={viewerUrl} /> : null}
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          aria-labelledby="wp-permanent-delete-title"
          aria-modal="true"
          className="fixed inset-0 z-[2300] flex items-start justify-center overflow-x-hidden overflow-y-auto bg-black/55 p-2 sm:p-3 md:p-6"
          role="dialog"
        >
          <div
            className="mt-3 max-h-[calc(100dvh-1.5rem)] w-full min-w-0 max-w-full overflow-y-auto overflow-x-hidden overscroll-contain rounded-[var(--radius-md)] border-2 border-[var(--color-danger-700)] bg-[var(--color-sheet)] shadow-lg sm:mt-8 sm:max-w-lg"
            onClick={(event) => event.stopPropagation()}
            ref={deleteDialogRef}
          >
            <header className="border-b border-[var(--color-danger-700)]/40 bg-[var(--color-danger-50)] px-4 py-3">
              <h2 className="text-base font-bold text-[var(--color-danger-700)]" id="wp-permanent-delete-title">
                Permanently delete submission
              </h2>
            </header>
            <div className="space-y-3 px-4 py-4 text-sm">
              <p>This will permanently delete the submission and all of its pictures. This cannot be undone.</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="font-bold text-[var(--color-text-muted)]">Employee</dt>
                <dd>{deleteTarget.employee_name || deleteTarget.user_email}</dd>
                <dt className="font-bold text-[var(--color-text-muted)]">Work date</dt>
                <dd>{formatDate(deleteTarget.work_date)}</dd>
                <dt className="font-bold text-[var(--color-text-muted)]">Title</dt>
                <dd>{deleteTarget.title}</dd>
                <dt className="font-bold text-[var(--color-text-muted)]">Pictures</dt>
                <dd>{deleteTarget.attachment_count}</dd>
              </dl>
              <p className="rounded border border-[var(--color-danger-700)]/30 bg-[var(--color-danger-50)] px-3 py-2 text-xs font-semibold text-[var(--color-danger-700)]">
                Pictures belonging to this submission will also be permanently deleted from storage.
              </p>
              <label className="block text-xs font-bold">
                Type DELETE to confirm
                <Input
                  autoComplete="off"
                  className="mt-1 font-mono tracking-wide"
                  disabled={busy}
                  onChange={(event) => setDeleteConfirmText(event.target.value)}
                  spellCheck={false}
                  value={deleteConfirmText}
                />
              </label>
              {deleteError ? <p className="text-sm text-[var(--color-danger-700)]">{deleteError}</p> : null}
            </div>
            <footer className="flex justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3">
              <Button
                disabled={busy}
                onClick={closePermanentDelete}
                ref={deleteCancelRef}
                size="sm"
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                disabled={busy || !deleteConfirmReady}
                onClick={() => void confirmPermanentDelete()}
                size="sm"
                type="button"
                variant="danger"
              >
                Permanently delete
              </Button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function WorkProgressReviewClient() {
  const t = useT();
  return (
    <Sheet>
      <PageHeader
        description={t("work_progress.page_description_full", "Manage protected site progress pictures submitted by employees.")}
        title={t("work_progress.page_title", "Work Progress Pictures")}
      />
      <SheetBody className="min-w-0 space-y-4 md:p-5">
        <RoleGuard
          allowedRoles={["administrator", "admin"]}
          fallback={<div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">You do not have permission to manage Work Progress Pictures.</div>}
        >
          <WorkProgressPicturesBody />
        </RoleGuard>
      </SheetBody>
    </Sheet>
  );
}
