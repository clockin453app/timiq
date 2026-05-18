import { AppShell } from "../../components/layout";
import { AuthGuard, RoleGuard } from "../../features/auth";

import { PayePayHistoryClient } from "./paye-pay-history-client";

export default function PayePayHistoryPage() {
  return (
    <AuthGuard>
      <RoleGuard
        allowedRoles={["employee", "admin", "administrator"]}
        fallback={
          <AppShell activeHref="/dashboard">
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              PAYE Pay History is available to signed-in user accounts only.
            </div>
          </AppShell>
        }
      >
        <AppShell activeHref="/paye-pay-history">
          <PayePayHistoryClient />
        </AppShell>
      </RoleGuard>
    </AuthGuard>
  );
}
