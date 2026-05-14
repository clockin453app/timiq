import { AppShell } from "../../../components/layout";
import { AuthGuard, RoleGuard } from "../../../features/auth";

import { LeaveManageClient } from "./leave-manage-client";

export default function LeaveManagePage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/leave/manage">
        <RoleGuard
          allowedRoles={["admin", "administrator"]}
          fallback={
            <p className="text-sm text-[var(--color-text-soft)]">
              You do not have access to leave management.{" "}
              <a className="font-semibold text-[var(--color-text)] underline" href="/leave">
                Leave
              </a>
            </p>
          }
        >
          <LeaveManageClient />
        </RoleGuard>
      </AppShell>
    </AuthGuard>
  );
}
