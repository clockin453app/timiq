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
    <div className="border-t border-[var(--color-border)] px-4 py-3 text-xs">
      <p className="font-bold text-[var(--color-text)]">{user.email}</p>
      <p className="mt-0.5 text-[var(--color-text-soft)]">
        {formatRole(user.system_role)}
      </p>
    </div>
  );
}