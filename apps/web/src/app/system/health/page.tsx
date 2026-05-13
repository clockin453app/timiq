import { AppShell } from "../../../components/layout";
import { AuthGuard, RoleGuard } from "../../../features/auth";
import { SystemHealthScreen } from "../../../features/system-health/system-health-screen";

export default function SystemHealthPage() {
  return (
    <AuthGuard>
      <RoleGuard
        allowedRoles={["administrator"]}
        fallback={
          <AppShell activeHref="/dashboard">
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              System health is available to administrators only.
            </div>
          </AppShell>
        }
      >
        <AppShell activeHref="/system/health">
          <SystemHealthScreen />
        </AppShell>
      </RoleGuard>
    </AuthGuard>
  );
}
