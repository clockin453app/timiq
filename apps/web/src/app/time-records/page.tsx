import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";

import { TimeRecordsClient } from "./time-records-client";

export default function TimeRecordsPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/time-records">
        <TimeRecordsClient />
      </AppShell>
    </AuthGuard>
  );
}
