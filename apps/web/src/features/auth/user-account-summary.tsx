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

export function UserAccountSummary() {
  const user = useCurrentUser();
  const t = useT();

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
