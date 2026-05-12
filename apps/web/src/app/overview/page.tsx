import { AppShell } from "../../components/layout";
import { AuthGuard, RoleGuard } from "../../features/auth";
import Link from "next/link";

import { OverviewClient } from "./overview-client";

function OverviewDenied() {
  return (
    <div className="mx-auto max-w-lg rounded border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-6 text-sm text-[var(--color-text)]">
      <p className="font-semibold">Overview is not available for your role.</p>
      <p className="mt-2 text-[var(--color-text-muted)]">
        Use your personal <Link className="text-[var(--color-link)] underline" href="/dashboard">Dashboard</Link>{" "}
        instead.
      </p>
    </div>
  );
}

export default function OverviewPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/overview">
        <RoleGuard allowedRoles={["admin", "administrator"]} fallback={<OverviewDenied />}>
          <OverviewClient />
        </RoleGuard>
      </AppShell>
    </AuthGuard>
  );
}
