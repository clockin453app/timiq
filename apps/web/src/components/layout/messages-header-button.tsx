"use client";

import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { isAdministrator, useCurrentUser } from "../../features/auth";
import {
  fetchNotificationSummary,
  type NotificationSummary,
} from "../../features/notifications/api";
import { navBadgesFromSummary } from "../../features/notifications/nav-badges";
import { useT } from "../../lib/i18n";

type MessagesHeaderButtonProps = {
  activeHref?: string;
  companyId?: string | null;
};

export function MessagesHeaderButton({ activeHref = "/dashboard", companyId = null }: MessagesHeaderButtonProps) {
  const user = useCurrentUser();
  const t = useT();
  const [unread, setUnread] = useState(0);

  const scopeCompany = isAdministrator(user) ? companyId : null;

  const applySummary = useCallback((row: NotificationSummary) => {
    const badges = navBadgesFromSummary(row.items);
    setUnread(badges["/messages"] ?? 0);
  }, []);

  useEffect(() => {
    const onSummary = (event: Event) => {
      applySummary((event as CustomEvent<NotificationSummary>).detail);
    };
    window.addEventListener("timiq:notification-summary", onSummary);
    void fetchNotificationSummary(scopeCompany)
      .then(applySummary)
      .catch(() => setUnread(0));
    return () => window.removeEventListener("timiq:notification-summary", onSummary);
  }, [applySummary, scopeCompany]);

  const active =
    activeHref === "/messages" || activeHref.startsWith("/messages/");
  const label = t("messaging.header_button_aria", "Messages");
  const badge = unread > 99 ? "99+" : unread > 0 ? String(unread) : "";

  return (
    <Link
      aria-label={label}
      className={[
        "relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border transition-colors",
        active
          ? "border-[var(--color-btn-active-border)] bg-[var(--color-btn-active-bg)] text-[var(--color-text)]"
          : "border-[var(--color-btn-default-border)] bg-[var(--color-btn-default-bg)] text-[var(--color-text-muted)] hover:bg-[var(--color-btn-default-hover)]",
      ].join(" ")}
      href="/messages?tab=messages"
      title={label}
    >
      <MessageSquare aria-hidden className="h-5 w-5" />
      {badge ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
