import { AppShell } from "../../../components/layout";
import { AuthGuard, RoleGuard } from "../../../features/auth";

import { FormsManageClient } from "./forms-manage-client";

export default function FormsManagePage() {
  return (
    <AuthGuard>
      <RoleGuard
        allowedRoles={["administrator", "admin"]}
        fallback={
          <div className="p-6 text-sm text-[var(--color-text-soft)]">
            You do not have access to template management.
          </div>
        }
      >
        <AppShell activeHref="/forms/manage">
          <FormsManageClient />
        </AppShell>
      </RoleGuard>
    </AuthGuard>
  );
}
