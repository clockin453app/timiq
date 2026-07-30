import { RoleGuard } from "@/features/auth";
import { PayHistoryClient } from "./pay-history-client";

export default function PayHistoryPage() {
  return (
    <RoleGuard
        allowedRoles={["employee"]}
        fallback={
          <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              Pay history is available to employee accounts only.
            </div>
        }
      >
        <PayHistoryClient />
      </RoleGuard>
  );
}
