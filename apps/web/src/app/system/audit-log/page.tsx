import { AppShell } from "../../../components/layout";
import { AuthGuard, RoleGuard } from "../../../features/auth";
import { AuditLogScreen } from "../../../features/audit/audit-log-screen";

export default function SystemAuditLogPage() {
  return (
    <AuthGuard>
      <RoleGuard
        allowedRoles={["admin", "administrator"]}
        fallback={
          <AppShell activeHref="/dashboard">
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              Audit log is available to company admins and administrators.
            </div>
          </AppShell>
        }
      >
        <AppShell activeHref="/system/audit-log">
          <AuditLogScreen />
        </AppShell>
      </RoleGuard>
    </AuthGuard>
  );
}
