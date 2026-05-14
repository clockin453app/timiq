import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";

import { LeaveClient } from "./leave-client";

export default function LeavePage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/leave">
        <LeaveClient />
      </AppShell>
    </AuthGuard>
  );
}
