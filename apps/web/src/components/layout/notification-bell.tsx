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

const GROUP_ORDER = ["account", "messages", "safety", "payroll", "time", "leave", "admin"];

function itemCategory(it: NotificationSummaryItem): string {
  return (it.category ?? it.group ?? "").trim();
}

function groupRank(g: string | null | undefined): number {
  const key = (g ?? "").trim();
  const idx = GROUP_ORDER.indexOf(key);
  return idx === -1 ? 99 : idx;
}

function sortNotificationItems(items: NotificationSummaryItem[]): NotificationSummaryItem[] {
  return [...items].sort((a, b) => {
    const gr = groupRank(itemCategory(a)) - groupRank(itemCategory(b));
    if (gr !== 0) {
      return gr;
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
  const sortedItems = data ? sortNotificationItems(data.items) : [];

  function categoryHeading(cat: string): string {
    switch (cat) {
      case "account":
        return t("notifications.category_account", "Account setup");
      case "messages":
        return t("notifications.category_messages", "Messages");
      case "safety":
        return t("notifications.category_safety", "Safety");
      case "payroll":
        return t("notifications.category_payroll", "Payroll");
      case "time":
        return t("notifications.category_time", "Time");
      case "leave":
        return t("notifications.category_leave", "Leave");
      case "admin":
        return t("notifications.category_admin", "Admin");
      default:
        return cat || t("notifications.category_admin", "Admin");
    }
  }

  async function onItemNavigate(it: NotificationSummaryItem) {
    setOpen(false);
    if (it.kind === "announcement") {
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
    const empty = { total_count: 0, items: [] };
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
                  className="text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  type="button"
                  onClick={() => void load()}
                >
                  {t("notifications.refresh", "Refresh")}
                </button>
                {total > 0 ? (
                  <button
                    className="text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
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
                  {sortedItems.map((it, idx) => {
                    const prev = idx > 0 ? sortedItems[idx - 1] : null;
                    const cat = itemCategory(it);
                    const gh = categoryHeading(cat);
                    const showGroup = gh && (!prev || itemCategory(prev) !== cat);
                    const itemKey = `${it.kind}:${it.target_key ?? ""}`;
                    return (
                      <li key={itemKey} className="border-b border-[var(--color-border)] last:border-b-0">
                        {showGroup ? (
                          <p className="px-3 pt-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                            {gh}
                          </p>
                        ) : null}
                        <div className="flex items-stretch hover:bg-[var(--color-cell)]">
                          <Link
                            className="block min-w-0 flex-1 px-3 py-2.5 text-left"
                            href={it.href}
                            onClick={() => void onItemNavigate(it)}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex min-w-0 flex-1 items-start gap-2">
                                <span
                                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                                    it.priority === "high" ? "bg-red-500" : "bg-[var(--color-border-dark)]"
                                  }`}
                                  aria-hidden
                                />
                                <span className="min-w-0 text-sm font-medium text-[var(--color-text)]">{it.title}</span>
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
                            <p className="mt-0.5 pl-4 text-xs text-[var(--color-text-muted)]">{it.description}</p>
                          </Link>
                          {SEEN_MARK_KINDS.has(it.kind) && (it.target_key ?? "").trim() ? (
                            <button
                              className="shrink-0 px-2 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
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
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
