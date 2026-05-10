import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";

import { TimesheetsClient } from "./timesheets-client";

export default function TimesheetsPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/timesheets">
        <TimesheetsClient />
      </AppShell>
    </AuthGuard>
  );
}
