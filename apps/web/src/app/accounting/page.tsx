import { AppShell } from "../../components/layout";
import { AuthGuard, RoleGuard } from "../../features/auth";

import { AccountingClient } from "./accounting-client";

export default function AccountingPage() {
  return (
    <AuthGuard>
      <RoleGuard
        allowedRoles={["administrator", "admin"]}
        fallback={
          <AppShell activeHref="/accounting">
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              You do not have permission to view accounting settings.
            </div>
          </AppShell>
        }
      >
        <AppShell activeHref="/accounting">
          <AccountingClient />
        </AppShell>
      </RoleGuard>
    </AuthGuard>
  );
}
