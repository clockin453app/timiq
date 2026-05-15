"use client";

import Link from "next/link";

import { useT } from "../../lib/i18n";
import { useCurrentUser } from "./auth-context";
import { LogoutButton } from "./logout-button";

function formatRole(role: string) {
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

type UserAccountSummaryProps = {
  /** Compact row layout for desktop sidebar footer. */
  layout?: "default" | "compact";
};

const footerLinkClass =
  "inline-flex min-h-8 items-center rounded-[var(--radius-md)] px-2 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-header)]";

export function UserAccountSummary({ layout = "default" }: UserAccountSummaryProps) {
  const user = useCurrentUser();
  const t = useT();

  if (layout === "compact") {
    return (
      <div className="border-t border-[var(--color-border-dark)] bg-[var(--color-cell)] px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--color-text)]" title={user.email}>
            {user.email}
          </p>
          <span className="shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-header)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            {formatRole(user.system_role)}
          </span>
        </div>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
          <Link className={footerLinkClass} href="/profile">
            {t("nav.profile", "Profile")}
          </Link>
          <span aria-hidden className="text-[var(--color-text-soft)]">
            ·
          </span>
          <Link className={footerLinkClass} href="/settings">
            {t("nav.settings", "Settings")}
          </Link>
          <span aria-hidden className="text-[var(--color-text-soft)]">
            ·
          </span>
          <LogoutButton className="!h-8 !min-h-8 shrink-0 px-2.5 text-xs" size="sm" />
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--color-border-dark)] bg-[var(--color-cell)] px-4 py-4 text-xs">
      <p className="truncate font-semibold text-[#111827]" title={user.email}>
        {user.email}
      </p>
      <p className="mt-2 inline-flex rounded border border-[var(--color-border-dark)] bg-[#f3f4f6] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#4b5563]">
        {formatRole(user.system_role)}
      </p>
      <div className="mt-3 space-y-1">
        <Link
          className="block min-h-[36px] rounded-[var(--radius-md)] px-2 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-header)]"
          href="/profile"
        >
          {t("nav.profile", "Profile")}
        </Link>
        <Link
          className="block min-h-[36px] rounded-[var(--radius-md)] px-2 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-header)]"
          href="/settings"
        >
          {t("nav.settings", "Settings")}
        </Link>
        <LogoutButton className="mt-1 w-full" />
      </div>
    </div>
  );
}
