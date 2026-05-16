"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button, PageHeader, Sheet, SheetBody, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui";
import { isAdministrator, useCurrentUser } from "../../../features/auth";
import { listCompanies, type Company } from "../../../features/companies/api";
import { listLocations, type Location } from "../../../features/locations/api";
import { listToolboxTalksAdmin, type ToolboxTalkSummary } from "../../../features/toolbox-talks/api";
import { useT } from "../../../lib/i18n";

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function ToolboxTalksManageClient() {
  const t = useT();
  const currentUser = useCurrentUser();
  const [talks, setTalks] = useState<ToolboxTalkSummary[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const companyIdParam = isAdministrator(currentUser) && filterCompanyId ? filterCompanyId : undefined;
      const [rows, locs] = await Promise.all([
        listToolboxTalksAdmin({ companyId: companyIdParam, status: filterStatus || undefined }),
        listLocations(),
      ]);
      setTalks(rows);
      setLocations(locs);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("toolbox_talks.error_load", "Could not load talks."));
    } finally {
      setLoading(false);
    }
  }, [currentUser, filterCompanyId, filterStatus, t]);

  useEffect(() => {
    if (!isAdministrator(currentUser)) return;
    let cancelled = false;
    void listCompanies()
      .then((rows) => {
        if (cancelled) return;
        setCompanies(rows);
        const first = rows.find((c) => c.is_active) ?? rows[0];
        if (first) setFilterCompanyId((prev) => prev || first.id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  useEffect(() => {
    void load();
  }, [load]);

  function locationName(id: string | null) {
    if (!id) return "—";
    return locations.find((l) => l.id === id)?.name ?? "—";
  }

  return (
    <Sheet>
      <PageHeader
        description={t("toolbox_talks.manage_intro", "Create toolbox talks, assign attendees, publish, and export sign-off records.")}
        title={t("toolbox_talks.manage_title", "Manage toolbox talks")}
      />
      <SheetBody className="min-w-0 space-y-5">
        {error ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
        <div className="flex flex-wrap items-end justify-between gap-3 border border-[var(--color-border)] bg-[var(--color-header)] p-3">
          <div className="flex flex-wrap items-end gap-3">
            {isAdministrator(currentUser) ? (
              <label className="text-xs font-semibold text-[var(--color-text)]">
                {t("toolbox_talks.filter_company", "Company")}
                <select
                  className="mt-1 block h-10 min-w-[12rem] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  onChange={(e) => setFilterCompanyId(e.target.value)}
                  value={filterCompanyId}
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="text-xs font-semibold text-[var(--color-text)]">
              {t("toolbox_talks.filter_status", "Status")}
              <select
                className="mt-1 block h-10 min-w-[10rem] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                onChange={(e) => setFilterStatus(e.target.value)}
                value={filterStatus}
              >
                <option value="">{t("toolbox_talks.all_statuses", "All")}</option>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <Button onClick={() => void load()} size="sm" type="button" variant="secondary">
              {t("common.refresh", "Refresh")}
            </Button>
          </div>
          <Link
            className="inline-flex h-9 items-center justify-center rounded border border-[var(--color-btn-primary-border)] bg-[var(--color-btn-primary-bg)] px-4 text-sm font-medium text-[var(--color-btn-primary-text)]"
            href="/toolbox-talks/manage/new"
          >
            {t("toolbox_talks.create_talk", "Create talk")}
          </Link>
        </div>

        {loading ? (
          <p className="text-sm text-[var(--color-text-soft)]">{t("common.loading", "Loading…")}</p>
        ) : talks.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--color-border)] bg-[var(--color-cell)] px-4 py-10 text-center">
            <p className="text-sm font-medium text-[var(--color-text)]">No toolbox talks match the current filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("toolbox_talks.col_title", "Title")}</TableHead>
                  <TableHead>{t("toolbox_talks.topic", "Topic")}</TableHead>
                  <TableHead>{t("toolbox_talks.col_site", "Site")}</TableHead>
                  <TableHead>{t("toolbox_talks.scheduled", "Scheduled")}</TableHead>
                  <TableHead>{t("toolbox_talks.col_status", "Status")}</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {talks.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.title}</TableCell>
                    <TableCell className="text-sm">{row.topic_display}</TableCell>
                    <TableCell className="text-sm text-[var(--color-text-soft)]">{locationName(row.location_id)}</TableCell>
                    <TableCell className="text-sm">{formatDate(row.scheduled_date)}</TableCell>
                    <TableCell className="text-sm capitalize">{row.status}</TableCell>
                    <TableCell>
                      <Link className="text-sm font-semibold text-[var(--color-text)] underline" href={`/toolbox-talks/manage/${row.id}`}>
                        {t("toolbox_talks.open", "Open")}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SheetBody>
    </Sheet>
  );
}
