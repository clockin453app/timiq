import { AppShell } from "../../components/layout";
import { Sheet } from "../../components/ui";
import { AuthGuard, RoleGuard } from "../../features/auth";

import { AdminGuideClient } from "./admin-guide-client";

export default function AdminGuidePage() {
  return (
    <AuthGuard>
      <RoleGuard
        allowedRoles={["administrator"]}
        fallback={
          <AppShell activeHref="/dashboard">
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              The administrator guide is available to platform administrators only.
            </div>
          </AppShell>
        }
      >
        <AppShell activeHref="/admin-guide">
          <Sheet>
            <AdminGuideClient />
          </Sheet>
        </AppShell>
      </RoleGuard>
    </AuthGuard>
  );
}
