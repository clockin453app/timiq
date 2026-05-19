import { AppShell } from "../../components/layout";
import { AuthGuard, RoleGuard } from "../../features/auth";

import { PayePayHistoryClient } from "./paye-pay-history-client";

export default function PayePayHistoryPage() {
  return (
    <AuthGuard>
      <RoleGuard
        allowedRoles={["employee"]}
        fallback={
          <AppShell activeHref="/dashboard">
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              PAYE Pay History is available to employee accounts only.
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
