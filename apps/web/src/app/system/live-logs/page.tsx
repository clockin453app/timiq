import { AppShell } from "../../../components/layout";
import { AuthGuard, RoleGuard } from "../../../features/auth";
import { LiveLogsScreen } from "../../../features/presence/live-logs-screen";

export default function SystemLiveLogsPage() {
  return (
    <AuthGuard>
      <RoleGuard
        allowedRoles={["administrator"]}
        fallback={
          <AppShell activeHref="/dashboard">
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              Live logs are available to administrators only.
            </div>
          </AppShell>
        }
      >
        <AppShell activeHref="/system/live-logs">
          <LiveLogsScreen />
        </AppShell>
      </RoleGuard>
    </AuthGuard>
  );
}
