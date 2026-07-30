import { RoleGuard } from "@/features/auth";
import { LiveLogsScreen } from "@/features/presence/live-logs-screen";

export default function SystemLiveLogsPage() {
  return (
    <RoleGuard
        allowedRoles={["administrator"]}
        fallback={
          <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              Live logs are available to administrators only.
            </div>
        }
      >
        <LiveLogsScreen />
      </RoleGuard>
  );
}
