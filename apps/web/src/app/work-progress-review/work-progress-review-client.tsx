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
  commentWorkProgress,
  fetchWorkProgressFileBlob,
  getWorkProgressReviewDetail,
  listWorkProgressReview,
  type WorkProgressReviewDetail,
  type WorkProgressReviewListItem,
} from "../../features/work-progress/api";

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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

  const [items, setItems] = useState<WorkProgressReviewListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [listError, setListError] = useState("");
  const [listLoading, setListLoading] = useState(true);

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

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError("");
    try {
      const data = await listWorkProgressReview({
        company_id: adminAllCompanies && companyFilter ? companyFilter : undefined,
        user_id: userIdFilter.trim() || undefined,
        location_id: locationIdFilter.trim() || undefined,
        status: statusFilter.trim() || undefined,
        date_from: dateFrom.trim() || undefined,
        date_to: dateTo.trim() || undefined,
        limit: 100,
        offset: 0,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Could not load list.");
      setItems([]);
      setTotal(0);
    } finally {
      setListLoading(false);
    }
  }, [adminAllCompanies, companyFilter, dateFrom, dateTo, locationIdFilter, statusFilter, userIdFilter]);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

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
      await loadList();
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
      await loadList();
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

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">Filters</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {adminAllCompanies ? (
            <label className="block text-xs font-bold text-[var(--color-text-soft)]">
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
          <label className="block text-xs font-bold text-[var(--color-text-soft)]">
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
          <label className="block text-xs font-bold text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">Date from</span>
            <Input className="mt-1" onChange={(e) => setDateFrom(e.target.value)} type="date" value={dateFrom} />
          </label>
          <label className="block text-xs font-bold text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">Date to</span>
            <Input className="mt-1" onChange={(e) => setDateTo(e.target.value)} type="date" value={dateTo} />
          </label>
          <label className="block text-xs font-bold text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">Employee user ID</span>
            <Input className="mt-1 font-mono text-xs" onChange={(e) => setUserIdFilter(e.target.value)} value={userIdFilter} />
          </label>
          <label className="block text-xs font-bold text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">Location ID</span>
            <Input
              className="mt-1 font-mono text-xs"
              onChange={(e) => setLocationIdFilter(e.target.value)}
              value={locationIdFilter}
            />
          </label>
        </div>
        <div className="mt-3">
          <Button onClick={() => void loadList()} type="button" variant="secondary">
            Apply filters
          </Button>
        </div>
      </div>

      {listError ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
          {listError}
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
                        <span className="truncate">{a.original_filename}</span>
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
      <SheetBody className="space-y-4 md:p-5">
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
