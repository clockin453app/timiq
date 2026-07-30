import { RoleGuard } from "@/features/auth";
import { SystemHealthScreen } from "@/features/system-health/system-health-screen";

export default function SystemHealthPage() {
  return (
    <RoleGuard
        allowedRoles={["administrator"]}
        fallback={
          <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              System health is available to administrators only.
            </div>
        }
      >
        <SystemHealthScreen />
      </RoleGuard>
  );
}
