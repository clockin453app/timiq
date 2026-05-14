"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  fetchNotificationSummary,
  postNotificationMarkSeen,
  type NotificationSummary,
  type NotificationSummaryItem,
} from "../../features/notifications/api";
import { isAdministrator, useCurrentUser } from "../../features/auth";
import { useT } from "../../lib/i18n";

type NotificationBellProps = {
  /** Administrator: scope company-specific review counts (optional). */
  companyId?: string | null;
};

/** Kinds that support dismiss-from-bell via mark-seen (matches backend `_SEEN_ALLOWED_KINDS`). */
const SEEN_MARK_KINDS = new Set(["week_report_ready", "payslip_ready", "leave_approved", "leave_rejected"]);

const GROUP_ORDER = ["messages", "safety", "payroll", "time", "admin"];

function groupRank(g: string | null | undefined): number {
  const key = (g ?? "").trim();
  const idx = GROUP_ORDER.indexOf(key);
  return idx === -1 ? 99 : idx;
}

function sortNotificationItems(items: NotificationSummaryItem[]): NotificationSummaryItem[] {
  return [...items].sort((a, b) => {
    const gr = groupRank(a.group) - groupRank(b.group);
    if (gr !== 0) {
      return gr;
    }
    return a.title.localeCompare(b.title);
  });
}

function groupHeading(group: string | null | undefined): string | null {
  switch ((group ?? "").trim()) {
    case "messages":
      return "Messages";
    case "safety":
      return "Safety";
    case "payroll":
      return "Payroll";
    case "time":
      return "Time";
    case "admin":
      return "Admin";
    default:
      return null;
  }
}

export function NotificationBell({ companyId = null }: NotificationBellProps) {
  const user = useCurrentUser();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const scopeCompany = isAdministrator(user) ? companyId : null;

  const load = useCallback(async () => {
    setErr(null);
    try {
      const row = await fetchNotificationSummary(scopeCompany);
      setData(row);
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

  const total = data?.total_count ?? 0;
  const badge = total > 99 ? "99+" : total > 0 ? String(total) : "";
  const sortedItems = data ? sortNotificationItems(data.items) : [];

  function onItemNavigate(it: NotificationSummaryItem) {
    setOpen(false);
    const key = (it.target_key ?? "").trim();
    if (SEEN_MARK_KINDS.has(it.kind) && key) {
      void postNotificationMarkSeen({ kind: it.kind, target_key: key }).then(
        () => load(),
        () => undefined,
      );
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={t("notifications.bell_aria", "Notifications")}
        className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] text-[var(--color-text-muted)] hover:bg-[var(--color-btn-default-hover)]"
        type="button"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell aria-hidden className="h-5 w-5" />
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
            className="fixed inset-0 z-[29] cursor-default bg-transparent"
            type="button"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-[100] mt-1 w-[min(100vw-1rem,22rem)] max-w-[min(22rem,calc(100vw-1rem))] rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-sheet)] shadow-[0_4px_16px_rgba(15,23,42,0.12)]">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
              <p className="text-sm font-semibold text-[var(--color-text)]">
                {t("notifications.title", "Notifications")}
              </p>
              <button
                className="text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                type="button"
                onClick={() => void load()}
              >
                {t("notifications.refresh", "Refresh")}
              </button>
            </div>
            <div className="max-h-[min(70dvh,24rem)] overflow-y-auto py-1">
              {err ? (
                <p className="px-3 py-2 text-xs text-red-700">{err}</p>
              ) : !data || data.items.length === 0 ? (
                <p className="px-3 py-3 text-sm text-[var(--color-text-muted)]">
                  {t("notifications.empty", "No notifications")}
                </p>
              ) : (
                <ul className="min-w-0">
                  {sortedItems.map((it, idx) => {
                    const prev = idx > 0 ? sortedItems[idx - 1] : null;
                    const gh = groupHeading(it.group);
                    const showGroup = gh && (!prev || groupHeading(prev.group) !== gh);
                    const itemKey = `${it.kind}:${it.target_key ?? ""}`;
                    return (
                      <li key={itemKey} className="border-b border-[var(--color-border)] last:border-b-0">
                        {showGroup ? (
                          <p className="px-3 pt-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">
                            {gh}
                          </p>
                        ) : null}
                        <Link
                          className="block px-3 py-2.5 text-left hover:bg-[var(--color-cell)]"
                          href={it.href}
                          onClick={() => onItemNavigate(it)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-medium text-[var(--color-text)]">{it.title}</span>
                            <span className="shrink-0 rounded bg-[var(--color-header)] px-1.5 py-0.5 text-xs font-semibold text-[var(--color-text)]">
                              {it.count}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{it.description}</p>
                        </Link>
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
