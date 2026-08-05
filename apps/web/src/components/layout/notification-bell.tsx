"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  fetchNotificationSummary,
  postNotificationMarkAllSeen,
  postNotificationMarkSeen,
  type NotificationSummary,
  type NotificationSummaryItem,
} from "../../features/notifications/api";
import {
  DATE_GROUP_ORDER,
  dateGroupHeading,
  formatNotificationOccurredAt,
  notificationDateGroup,
  type NotificationDateGroup,
} from "../../features/notifications/format-occurred-at";
import { isAdministrator, useCurrentUser } from "../../features/auth";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";

type NotificationBellProps = {
  /** Administrator: scope company-specific review counts (optional). */
  companyId?: string | null;
};

const SEEN_MARK_KINDS = new Set([
  "week_report_ready",
  "payslip_ready",
  "leave_approved",
  "leave_rejected",
  "announcement",
  "face_check_setup",
  "rams_ack",
  "toolbox_sign",
  "form_complete",
  "form_review",
  "rams_review",
  "toolbox_review",
  "payroll_pending",
  "time_review",
  "leave_request_pending",
  "attendance_late_arrival",
  "attendance_forgot_clock_in",
  "attendance_missing_clock_in",
  "attendance_forgot_clock_out",
  "message_received",
  "announcement_published",
  "leave_request_submitted",
  "leave_request_approved",
  "leave_request_rejected",
  "rams_ack_required",
  "toolbox_sign_required",
  "form_submitted",
  "form_reviewed",
  "form_rejected",
  "payroll_paid",
]);

function sortByOccurredAt(items: NotificationSummaryItem[]): NotificationSummaryItem[] {
  return [...items].sort((a, b) => {
    const aTs = a.occurred_at ? Date.parse(a.occurred_at) : Number.NaN;
    const bTs = b.occurred_at ? Date.parse(b.occurred_at) : Number.NaN;
    const aMissing = Number.isNaN(aTs);
    const bMissing = Number.isNaN(bTs);
    if (aMissing !== bMissing) {
      return aMissing ? 1 : -1;
    }
    if (!aMissing && !bMissing && aTs !== bTs) {
      return bTs - aTs;
    }
    return a.title.localeCompare(b.title);
  });
}

export function NotificationBell({ companyId = null }: NotificationBellProps) {
  const user = useCurrentUser();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mobileHub, setMobileHub] = useState(false);
  const [locallySeenKeys, setLocallySeenKeys] = useState<Set<string>>(() => new Set());

  const scopeCompany = isAdministrator(user) ? companyId : null;

  const load = useCallback(async () => {
    setErr(null);
    try {
      const row = await fetchNotificationSummary(scopeCompany);
      setData(row);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("timiq:notification-summary", { detail: row }));
      }
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : "Failed to load.");
    }
  }, [scopeCompany]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onFocus = () => {
      void load();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const fn = () => setMobileHub(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  const total = data?.total_count ?? 0;
  const badge = total > 99 ? "99+" : total > 0 ? String(total) : "";
  const sortedItems = data ? sortByOccurredAt(data.items) : [];

  const grouped: { group: NotificationDateGroup; items: NotificationSummaryItem[] }[] = [];
  for (const group of DATE_GROUP_ORDER) {
    const rows = sortedItems.filter((it) => notificationDateGroup(it.occurred_at) === group);
    if (rows.length > 0) {
      grouped.push({ group, items: rows });
    }
  }

  async function onItemNavigate(it: NotificationSummaryItem) {
    setOpen(false);
    const itemKey = `${it.kind}:${(it.target_key ?? "").trim()}`;
    if (it.kind === "announcement") {
      setLocallySeenKeys((prev) => new Set(prev).add(itemKey));
      await postNotificationMarkSeen({
        kind: "announcement",
        mark_all_for_kind: true,
        company_id: scopeCompany,
      }).catch(() => undefined);
      void load();
      return;
    }
    const key = (it.target_key ?? "").trim();
    if (SEEN_MARK_KINDS.has(it.kind) && key) {
      setLocallySeenKeys((prev) => new Set(prev).add(itemKey));
      await postNotificationMarkSeen({
        kind: it.kind,
        target_key: key,
        company_id: scopeCompany,
      }).catch(() => undefined);
      void load();
    }
  }

  async function onDismissItem(it: NotificationSummaryItem) {
    const key = (it.target_key ?? "").trim();
    if (!key || !SEEN_MARK_KINDS.has(it.kind)) {
      return;
    }
    const itemKey = `${it.kind}:${key}`;
    setLocallySeenKeys((prev) => new Set(prev).add(itemKey));
    await postNotificationMarkSeen({
      kind: it.kind,
      target_key: key,
      company_id: scopeCompany,
    }).catch(() => undefined);
    void load();
  }

  async function onMarkAllSeen() {
    const visibleItems = sortedItems
      .map((it) => ({ kind: it.kind, target_key: (it.target_key ?? "").trim() }))
      .filter((it) => it.target_key);
    await postNotificationMarkAllSeen({ company_id: scopeCompany, items: visibleItems }).catch(() => undefined);
    const empty: NotificationSummary = {
      total_count: 0,
      items: [],
      messages_unread_count: data?.messages_unread_count ?? 0,
    };
    setData(empty);
    window.dispatchEvent(new CustomEvent("timiq:notification-summary", { detail: empty }));
    void load();
  }

  const panelClasses = mobileHub
    ? "fixed left-2 right-2 top-14 z-[100] max-h-[min(78dvh,calc(100dvh-5rem))] rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] shadow-[0_4px_16px_rgba(15,23,42,0.12)]"
    : "absolute right-0 z-[100] mt-1 w-[min(100vw-1rem,22rem)] max-w-[min(22rem,calc(100vw-1rem))] max-h-[min(85dvh,calc(100dvh-4rem))] rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] shadow-[0_4px_16px_rgba(15,23,42,0.12)]";

  return (
    <div className="relative shrink-0">
      <button
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={t("notifications.bell_aria", "Notifications")}
        className={cn("relative", uiClasses.topBarIconButton)}
        type="button"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell aria-hidden className="h-5 w-5 text-current" strokeWidth={2.25} />
        {badge ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button
            aria-label={t("notifications.close_overlay", "Close")}
            className="fixed inset-0 z-[29] cursor-default bg-black/10"
            type="button"
            onClick={() => setOpen(false)}
          />
          <div className={`${panelClasses} flex flex-col overflow-hidden`}>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
              <p className="text-sm font-semibold text-[var(--color-text)]">{t("notifications.title", "Notifications")}</p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  className="min-h-11 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  type="button"
                  onClick={() => void load()}
                >
                  {t("notifications.refresh", "Refresh")}
                </button>
                {total > 0 ? (
                  <button
                    className="min-h-11 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    type="button"
                    onClick={() => void onMarkAllSeen()}
                  >
                    {t("notifications.mark_all_seen", "Mark all seen")}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain py-1">
              {err ? (
                <p className="px-3 py-2 text-xs text-red-700">{err}</p>
              ) : !data || data.items.length === 0 ? (
                <p className="px-3 py-3 text-sm text-[var(--color-text-muted)]">{t("notifications.empty", "No notifications")}</p>
              ) : (
                <ul className="min-w-0">
                  {grouped.map(({ group, items }) => (
                    <li key={group} className="min-w-0">
                      <p className="px-3 pt-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                        {dateGroupHeading(group)}
                      </p>
                      <ul className="min-w-0">
                        {items.map((it) => {
                          const itemKey = `${it.kind}:${it.target_key ?? ""}`;
                          const when = formatNotificationOccurredAt(it.occurred_at);
                          const seen = Boolean(it.is_seen) || locallySeenKeys.has(itemKey);
                          const unseen = !seen;
                          return (
                            <li key={itemKey} className="border-b border-[var(--color-border)] last:border-b-0">
                              <div
                                className={`flex items-stretch border-l-4 ${
                                  unseen
                                    ? "border-l-sky-500 bg-sky-50/80 hover:bg-sky-50"
                                    : "border-l-transparent bg-[var(--color-sheet)] hover:bg-[var(--color-cell)]"
                                }`}
                              >
                                <Link
                                  aria-label={
                                    unseen
                                      ? `${it.title}. Unread notification`
                                      : `${it.title}. Seen notification`
                                  }
                                  className="block min-h-11 min-w-0 flex-1 px-3 py-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-btn-active-border)]"
                                  href={it.href}
                                  onClick={() => void onItemNavigate(it)}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex min-w-0 flex-1 items-start gap-2">
                                      <span
                                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                                          unseen
                                            ? it.priority === "high"
                                              ? "bg-red-500"
                                              : "bg-sky-600"
                                            : "bg-[var(--color-border-dark)]"
                                        }`}
                                        aria-hidden
                                      />
                                      <span
                                        className={`min-w-0 break-words text-sm text-[var(--color-text)] ${
                                          unseen ? "font-bold" : "font-normal"
                                        }`}
                                      >
                                        {it.title}
                                        {unseen ? (
                                          <span className="sr-only"> {t("notifications.unread", "Unread")}</span>
                                        ) : null}
                                      </span>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                                      {it.priority === "high" ? (
                                        <span className="rounded bg-red-100 px-1 py-0.5 text-[10px] font-bold uppercase text-red-900">
                                          {t("notifications.priority_high", "High")}
                                        </span>
                                      ) : null}
                                      <span className="rounded bg-[var(--color-header)] px-1.5 py-0.5 text-xs font-semibold text-[var(--color-text)]">
                                        {it.count}
                                      </span>
                                    </div>
                                  </div>
                                  <p
                                    className={`mt-0.5 break-words pl-4 text-xs ${
                                      unseen ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]"
                                    }`}
                                  >
                                    {it.description}
                                  </p>
                                  {when ? (
                                    <p
                                      className={`mt-1 pl-4 text-[11px] ${
                                        unseen ? "text-[var(--color-text-muted)]" : "text-[var(--color-text-soft)]"
                                      }`}
                                      title={when.exact}
                                      aria-label={when.exact}
                                    >
                                      {when.label}
                                    </p>
                                  ) : null}
                                </Link>
                                {SEEN_MARK_KINDS.has(it.kind) && (it.target_key ?? "").trim() ? (
                                  <button
                                    className="min-h-11 shrink-0 px-3 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                                    type="button"
                                    onClick={() => void onDismissItem(it)}
                                  >
                                    {t("notifications.dismiss", "Dismiss")}
                                  </button>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
