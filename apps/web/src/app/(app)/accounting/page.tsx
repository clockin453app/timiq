import { RoleGuard } from "@/features/auth";
import { AccountingClient } from "./accounting-client";

export default function AccountingPage() {
  return (
    <RoleGuard
        allowedRoles={["administrator", "admin"]}
        fallback={
          <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              You do not have permission to view accounting settings.
            </div>
        }
      >
        <AccountingClient />
      </RoleGuard>
  );
}
