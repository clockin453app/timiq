import { AppShell } from "../../components/layout";
import { AuthGuard, RoleGuard } from "../../features/auth";
import { MonthlyPayeClient } from "./monthly-paye-client";

export default function MonthlyPayePage() {
  return (
    <AuthGuard>
      <RoleGuard
        allowedRoles={["administrator", "admin"]}
        fallback={
          <AppShell activeHref="/dashboard">
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              Monthly PAYE Report is available to admins and administrators.
            </div>
          </AppShell>
        }
      >
        <AppShell activeHref="/monthly-paye">
          <MonthlyPayeClient />
        </AppShell>
      </RoleGuard>
    </AuthGuard>
  );
}
