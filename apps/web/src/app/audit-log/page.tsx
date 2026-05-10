import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";
import { AuditLogClient } from "./audit-log-client";

export default function AuditLogPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/audit-log">
        <AuditLogClient />
      </AppShell>
    </AuthGuard>
  );
}
