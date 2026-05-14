import { Suspense } from "react";

import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";

import { MessagesClient } from "./messages-client";

export default function MessagesPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/messages">
        <Suspense fallback={<p className="p-4 text-sm text-[var(--color-text-muted)]">Loading messages…</p>}>
          <MessagesClient />
        </Suspense>
      </AppShell>
    </AuthGuard>
  );
}
