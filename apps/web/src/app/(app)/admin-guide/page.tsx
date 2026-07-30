import { Sheet } from "@/components/ui";
import { RoleGuard } from "@/features/auth";
import { AdminGuideClient } from "./admin-guide-client";

export default function AdminGuidePage() {
  return (
    <RoleGuard
        allowedRoles={["administrator"]}
        fallback={
          <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              The administrator guide is available to platform administrators only.
            </div>
        }
      >
        <Sheet>
            <AdminGuideClient />
          </Sheet>
      </RoleGuard>
  );
}
