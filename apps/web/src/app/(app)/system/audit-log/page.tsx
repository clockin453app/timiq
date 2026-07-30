import { RoleGuard } from "@/features/auth";
import { AuditLogScreen } from "@/features/audit/audit-log-screen";

export default function SystemAuditLogPage() {
  return (
    <RoleGuard
        allowedRoles={["admin", "administrator"]}
        fallback={
          <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              Audit log is available to company admins and administrators.
            </div>
        }
      >
        <AuditLogScreen />
      </RoleGuard>
  );
}
