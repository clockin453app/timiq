import { RoleGuard } from "@/features/auth";
import { FormsManageClient } from "./forms-manage-client";

export default function FormsManagePage() {
  return (
    <RoleGuard
        allowedRoles={["administrator", "admin"]}
        fallback={
          <div className="p-6 text-sm text-[var(--color-text-soft)]">
            You do not have access to template management.
          </div>
        }
      >
        <FormsManageClient />
      </RoleGuard>
  );
}
