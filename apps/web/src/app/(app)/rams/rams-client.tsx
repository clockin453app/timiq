"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { PageHeader } from "@/components/ui";
import { isEmployee, useCurrentUser } from "@/features/auth";
import { listMyRams, type RamsAssessmentListItem } from "@/features/rams/api";
import { listLocations, type Location } from "@/features/locations/api";
import { useT } from "@/lib/i18n";

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function riskChipClass(level: string): string {
  switch (level) {
    case "low":
      return "border-emerald-400 bg-emerald-50 text-emerald-900";
    case "medium":
      return "border-amber-400 bg-amber-50 text-amber-950";
    case "high":
      return "border-orange-500 bg-orange-50 text-orange-950";
    case "critical":
      return "border-red-600 bg-red-50 text-red-950";
    default:
      return "border-[var(--color-border)] bg-[var(--color-cell)] text-[var(--color-text)]";
  }
}

export type RamsListActionKind = "review" | "continue" | "sign" | "view";

export function employeeRamsListAction(row: RamsAssessmentListItem): RamsListActionKind {
  if (row.my_ack_status === "acknowledged") return "view";
  if (row.reading_required) {
    if (row.reading_status === "completed") return "sign";
    if (row.reading_status === "in_progress") return "continue";
    return "review";
  }
  return "sign";
}

export function employeeRamsListActionLabel(kind: RamsListActionKind): string {
  switch (kind) {
    case "continue":
      return "Continue reading";
    case "sign":
      return "Sign RAMS";
    case "view":
      return "View RAMS record";
    default:
      return "Review RAMS";
  }
}

function employeeStatusLabel(row: RamsAssessmentListItem): string {
  if (row.my_ack_status === "acknowledged") return "Acknowledged";
  if (row.my_ack_status === "declined") return "Declined";
  if (row.reading_required) {
    if (row.reading_status === "completed") return "Ready to sign";
    if (row.reading_status === "in_progress") return "In progress";
    return "Needs review";
  }
  return "Needs acknowledgement";
}

type ListBucket = "needs_action" | "in_progress" | "acknowledged";

function bucketFor(row: RamsAssessmentListItem): ListBucket {
  if (row.my_ack_status === "acknowledged") return "acknowledged";
  if (row.reading_required && (row.reading_status === "in_progress" || row.reading_status === "completed")) {
    return "in_progress";
  }
  return "needs_action";
}

const PRIMARY_ACTION_CLASS =
  "mt-3 inline-flex min-h-[52px] w-full items-center justify-center rounded border border-[var(--color-btn-primary-border)] bg-[var(--color-btn-primary-bg)] px-3 text-sm font-semibold text-[var(--color-btn-primary-fg)] hover:border-[var(--color-btn-primary-hover-bg)] hover:bg-[var(--color-btn-primary-hover-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-btn-primary-border)] active:translate-y-[0.5px]";

function RamsListCardSkeleton() {
  return (
    <div
      aria-hidden
      className="animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
    >
      <div className="h-4 w-3/5 rounded bg-[var(--color-border)]" />
      <div className="mt-3 h-3 w-2/5 rounded bg-[var(--color-border)]" />
      <div className="mt-2 h-3 w-1/2 rounded bg-[var(--color-border)]" />
      <div className="mt-3 h-[52px] w-full rounded bg-[var(--color-border)]" />
    </div>
  );
}

function RamsListCard({
  row,
  siteName,
}: {
  row: RamsAssessmentListItem;
  siteName: string;
}) {
  const action = employeeRamsListAction(row);
  const progressText =
    row.reading_required &&
    row.reading_total_pages != null &&
    row.reading_status &&
    row.reading_status !== "not_started"
      ? `${row.reading_viewed_count ?? 0} of ${row.reading_total_pages} pages viewed`
      : null;

  return (
    <Link
      className="block w-full min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left shadow-sm transition hover:border-[var(--color-text-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-btn-primary-border)]"
      href={`/rams/${row.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 break-words text-base font-semibold text-[var(--color-text)]">{row.title}</h3>
        <span className={`shrink-0 rounded border px-2 py-0.5 text-xs capitalize ${riskChipClass(row.risk_level)}`}>
          {row.risk_level}
        </span>
      </div>
      <dl className="mt-2 space-y-1 text-xs text-[var(--color-text-soft)]">
        <div>
          <dt className="inline font-medium text-[var(--color-text)]">Site: </dt>
          <dd className="inline">{siteName}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-[var(--color-text)]">Review date: </dt>
          <dd className="inline">{formatDate(row.review_due_date)}</dd>
        </div>
        <div>
          <dt className="inline font-medium text-[var(--color-text)]">Status: </dt>
          <dd className="inline">{employeeStatusLabel(row)}</dd>
        </div>
        {progressText ? (
          <div>
            <dt className="inline font-medium text-[var(--color-text)]">Reading: </dt>
            <dd className="inline">{progressText}</dd>
          </div>
        ) : null}
      </dl>
      <span className={PRIMARY_ACTION_CLASS}>{employeeRamsListActionLabel(action)}</span>
    </Link>
  );
}

function Section({
  title,
  children,
  empty,
}: {
  title: string;
  children: ReactNode;
  empty: boolean;
}) {
  if (empty) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function RamsClient() {
  const t = useT();
  const currentUser = useCurrentUser();
  const [items, setItems] = useState<RamsAssessmentListItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const employee = Boolean(currentUser && isEmployee(currentUser));

  const loadList = useCallback(async () => {
    if (!employee) {
      setItems([]);
      setLocations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [list, locs] = await Promise.all([listMyRams(), listLocations().catch(() => [])]);
      setItems(list);
      setLocations(locs);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rams.error_load", "Could not load RAMS."));
    } finally {
      setLoading(false);
    }
  }, [employee, t]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const locationName = useCallback(
    (id: string | null) => {
      if (!id) return "—";
      return locations.find((l) => l.id === id)?.name ?? "—";
    },
    [locations],
  );

  const buckets = useMemo(() => {
    const needs_action: RamsAssessmentListItem[] = [];
    const in_progress: RamsAssessmentListItem[] = [];
    const acknowledged: RamsAssessmentListItem[] = [];
    for (const row of items) {
      const b = bucketFor(row);
      if (b === "acknowledged") acknowledged.push(row);
      else if (b === "in_progress") in_progress.push(row);
      else needs_action.push(row);
    }
    const byUpdated = (a: RamsAssessmentListItem, b: RamsAssessmentListItem) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    needs_action.sort(byUpdated);
    in_progress.sort(byUpdated);
    acknowledged.sort(byUpdated);
    return { needs_action, in_progress, acknowledged };
  }, [items]);

  return (
    <div className="w-full min-w-0 max-w-full space-y-5 pb-[max(1rem,calc(var(--layout-mobile-bottom-nav-height)+0.75rem))] md:pb-4">
      <PageHeader
        title={t("rams.title", "My RAMS")}
        description={t("rams.employee_intro", "Review assigned risk assessments and acknowledge.")}
      />
      {!isEmployee(currentUser) ? (
        <p className="text-sm text-[var(--color-text-soft)]">
          {t(
            "rams.employee_only_hint",
            "RAMS acknowledgement is for employee accounts. Managers can use Manage RAMS.",
          )}{" "}
          <a className="font-semibold underline" href="/rams/manage">
            {t("rams.manage_link", "Manage RAMS")}
          </a>
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label={t("rams.loading", "Loading…")}>
          <RamsListCardSkeleton />
          <RamsListCardSkeleton />
        </div>
      ) : employee ? (
        items.length === 0 ? (
          <p className="text-sm text-[var(--color-text-soft)]">{t("rams.empty", "No RAMS assigned yet.")}</p>
        ) : (
          <div className="space-y-6">
            <Section title="Needs action" empty={buckets.needs_action.length === 0}>
              {buckets.needs_action.map((row) => (
                <RamsListCard key={row.id} row={row} siteName={locationName(row.location_id)} />
              ))}
            </Section>
            <Section title="In progress" empty={buckets.in_progress.length === 0}>
              {buckets.in_progress.map((row) => (
                <RamsListCard key={row.id} row={row} siteName={locationName(row.location_id)} />
              ))}
            </Section>
            <Section title="Acknowledged" empty={buckets.acknowledged.length === 0}>
              {buckets.acknowledged.map((row) => (
                <RamsListCard key={row.id} row={row} siteName={locationName(row.location_id)} />
              ))}
            </Section>
          </div>
        )
      ) : null}
    </div>
  );
}
