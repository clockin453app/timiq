"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Button,
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
import { isAdministrator, useCurrentUser } from "../auth";
import { listCompanies, type Company } from "../companies/api";
import { AuditEventDetails } from "./audit-event-details";
import {
  formatAuditActionLabel,
  formatAuditActor,
  formatAuditEventSummary,
  formatAuditSubject,
  formatAuditTarget,
} from "./audit-format";
import { listAuditEvents, type AuditEventListItem, type AuditEventListResponse } from "./api";

const PAGE_SIZE = 50;

export function AuditLogScreen() {
  const user = useCurrentUser();
  const adminUser = isAdministrator(user);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [search, setSearch] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [subjectUserId, setSubjectUserId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<AuditEventListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const filterRef = useRef({
    dateFrom,
    dateTo,
    action,
    entityType,
    search,
    actorUserId,
    subjectUserId,
    companyId,
    adminUser,
  });
  filterRef.current = {
    dateFrom,
    dateTo,
    action,
    entityType,
    search,
    actorUserId,
    subjectUserId,
    companyId,
    adminUser,
  };

  const runQuery = useCallback(async (nextOffset: number) => {
    const f = filterRef.current;
    setLoading(true);
    setError("");
    try {
      const res = await listAuditEvents({
        dateFrom: f.dateFrom || undefined,
        dateTo: f.dateTo || undefined,
        action: f.action || undefined,
        entityType: f.entityType || undefined,
        search: f.search || undefined,
        actorUserId: f.actorUserId || undefined,
        subjectUserId: f.subjectUserId || undefined,
        companyId: f.adminUser ? f.companyId || undefined : undefined,
        limit: PAGE_SIZE,
        offset: nextOffset,
      });
      setData(res);
      setOffset(nextOffset);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Could not load audit logs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!adminUser) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await listCompanies();
        if (!cancelled) {
          setCompanies(list);
        }
      } catch {
        if (!cancelled) {
          setCompanies([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminUser]);

  useEffect(() => {
    void runQuery(0);
  }, [runQuery]);

  function onSubmitFilters(e: FormEvent) {
    e.preventDefault();
    void runQuery(0);
  }

  const rows: AuditEventListItem[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  const companyOptions = useMemo(
    () => companies.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [companies],
  );

  return (
    <Sheet>
      <PageHeader
        title="Audit log"
        description="Company-scoped for admins; full visibility for administrators. Sensitive detail fields are redacted server-side before this page loads."
      />
      <SheetBody className="space-y-4">
        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        <form
          className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 text-sm shadow-sm"
          onSubmit={onSubmitFilters}
        >
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">From date</span>
              <input
                className="w-full rounded border border-[var(--color-border-dark)] bg-white px-2 py-1.5 text-sm"
                onChange={(e) => setDateFrom(e.target.value)}
                type="date"
                value={dateFrom}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">To date</span>
              <input
                className="w-full rounded border border-[var(--color-border-dark)] bg-white px-2 py-1.5 text-sm"
                onChange={(e) => setDateTo(e.target.value)}
                type="date"
                value={dateTo}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">Action contains</span>
              <input
                className="w-full rounded border border-[var(--color-border-dark)] bg-white px-2 py-1.5 text-sm"
                onChange={(e) => setAction(e.target.value)}
                value={action}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">Entity type contains</span>
              <input
                className="w-full rounded border border-[var(--color-border-dark)] bg-white px-2 py-1.5 text-sm"
                onChange={(e) => setEntityType(e.target.value)}
                value={entityType}
              />
            </label>
            <label className="block space-y-1 md:col-span-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">Search</span>
              <input
                className="w-full rounded border border-[var(--color-border-dark)] bg-white px-2 py-1.5 text-sm"
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Action, entity, or details text"
                value={search}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">Actor user id</span>
              <input
                className="w-full rounded border border-[var(--color-border-dark)] bg-white px-2 py-1.5 font-mono text-xs"
                onChange={(e) => setActorUserId(e.target.value)}
                value={actorUserId}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">Subject user id</span>
              <input
                className="w-full rounded border border-[var(--color-border-dark)] bg-white px-2 py-1.5 font-mono text-xs"
                onChange={(e) => setSubjectUserId(e.target.value)}
                value={subjectUserId}
              />
            </label>
            {adminUser ? (
              <label className="block space-y-1 md:col-span-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-[#374151]">Company</span>
                <select
                  className="w-full rounded border border-[var(--color-border-dark)] bg-white px-2 py-1.5 text-sm"
                  onChange={(e) => setCompanyId(e.target.value)}
                  value={companyId}
                >
                  <option value="">All companies</option>
                  {companyOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Apply filters</Button>
            <Button
              onClick={() => {
                setDateFrom("");
                setDateTo("");
                setAction("");
                setEntityType("");
                setSearch("");
                setActorUserId("");
                setSubjectUserId("");
                setCompanyId("");
                void runQuery(0);
              }}
              type="button"
              variant="secondary"
            >
              Clear
            </Button>
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-text-muted)]">
          <span>{loading ? "Loading…" : `Showing ${rows.length} of ${total} events`}</span>
          <div className="flex gap-2">
            <Button
              disabled={!hasPrev || loading}
              onClick={() => void runQuery(Math.max(0, offset - PAGE_SIZE))}
              type="button"
              variant="secondary"
            >
              Previous
            </Button>
            <Button
              disabled={!hasNext || loading}
              onClick={() => void runQuery(offset + PAGE_SIZE)}
              type="button"
              variant="secondary"
            >
              Next
            </Button>
          </div>
        </div>

        <div className="min-w-0 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border-dark)]">
          <Table className="min-w-[52rem] text-sm">
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead className="w-[6.5rem]">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading && rows.length === 0 ? (
                <TableRow>
                  <TableCell className="text-[var(--color-text-muted)]" colSpan={8}>
                    No audit events match the current filters.
                  </TableCell>
                </TableRow>
              ) : null}
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8}>Loading audit events…</TableCell>
                </TableRow>
              ) : null}
              {!loading
                ? rows.map((ev) => (
                    <TableRow key={ev.id} className="align-top">
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(ev.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="max-w-[11rem] break-words text-xs">{formatAuditActor(ev)}</TableCell>
                      <TableCell className="max-w-[12rem] break-words text-xs font-medium text-[var(--color-text)]">
                        {formatAuditActionLabel(ev.action)}
                      </TableCell>
                      <TableCell className="max-w-[10rem] break-words text-xs text-[var(--color-text-muted)]">
                        {formatAuditTarget(ev)}
                      </TableCell>
                      <TableCell className="max-w-[11rem] break-words text-xs">{formatAuditSubject(ev)}</TableCell>
                      <TableCell className="max-w-[9rem] break-words text-xs">{ev.company_name || "—"}</TableCell>
                      <TableCell className="max-w-[18rem] break-words text-xs text-[var(--color-text)]">
                        {formatAuditEventSummary(ev)}
                      </TableCell>
                      <TableCell className="text-xs">
                        <AuditEventDetails event={ev} />
                      </TableCell>
                    </TableRow>
                  ))
                : null}
            </TableBody>
          </Table>
        </div>
      </SheetBody>
    </Sheet>
  );
}
