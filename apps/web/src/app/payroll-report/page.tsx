import { AppShell } from "../../components/layout";
import { AuthGuard, RoleGuard } from "../../features/auth";

import { PayrollReportClient } from "./payroll-report-client";

export default function PayrollReportPage() {
  return (
    <AuthGuard>
      <RoleGuard
        allowedRoles={["administrator", "admin"]}
        fallback={
          <AppShell activeHref="/payroll-report">
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              You do not have permission to view payroll reports.
            </div>
          </AppShell>
        }
      >
        <AppShell activeHref="/payroll-report">
          <PayrollReportClient />
        </AppShell>
      </RoleGuard>
    </AuthGuard>
  );
}
