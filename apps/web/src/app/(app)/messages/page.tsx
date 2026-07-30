import { Suspense } from "react";

import { MessagesClient } from "./messages-client";

export default function MessagesPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-[var(--color-text-muted)]">Loading messages…</p>}>
          <MessagesClient />
        </Suspense>
  );
}
