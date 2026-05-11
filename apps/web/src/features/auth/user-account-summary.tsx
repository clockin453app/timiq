"use client";

import { useCurrentUser } from "./auth-context";

function formatRole(role: string) {
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function UserAccountSummary() {
  const user = useCurrentUser();

  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-sheet)] px-4 py-5 text-xs">
      <p className="truncate font-semibold text-[var(--color-text)]" title={user.email}>
        {user.email}
      </p>
      <p className="mt-2 inline-flex rounded border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
        {formatRole(user.system_role)}
      </p>
    </div>
  );
}