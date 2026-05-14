import { AppShell } from "../../../components/layout";
import { AuthGuard, RoleGuard } from "../../../features/auth";

import { PrivacyRequestsClient } from "./privacy-requests-client";

export default function PrivacyRequestsPage() {
  return (
    <AuthGuard>
      <RoleGuard
        allowedRoles={["administrator", "admin"]}
        fallback={
          <AppShell activeHref="/privacy/requests">
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              You do not have permission to view privacy requests.
            </div>
          </AppShell>
        }
      >
        <AppShell activeHref="/privacy/requests">
          <PrivacyRequestsClient />
        </AppShell>
      </RoleGuard>
    </AuthGuard>
  );
}
