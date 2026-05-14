import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";

import { MessagesClient } from "./messages-client";

export default function MessagesPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/messages">
        <MessagesClient />
      </AppShell>
    </AuthGuard>
  );
}
