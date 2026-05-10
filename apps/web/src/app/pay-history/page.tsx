import { AppShell } from "../../components/layout";
import { AuthGuard, RoleGuard } from "../../features/auth";

import { PayHistoryClient } from "./pay-history-client";

export default function PayHistoryPage() {
  return (
    <AuthGuard>
      <RoleGuard
        allowedRoles={["employee"]}
        fallback={
          <AppShell activeHref="/dashboard">
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              Pay history is available to employee accounts only.
            </div>
          </AppShell>
        }
      >
        <AppShell activeHref="/pay-history">
          <PayHistoryClient />
        </AppShell>
      </RoleGuard>
    </AuthGuard>
  );
}
