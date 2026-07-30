import { RoleGuard } from "@/features/auth";
import { PayePayHistoryClient } from "./paye-pay-history-client";

export default function PayePayHistoryPage() {
  return (
    <RoleGuard
        allowedRoles={["employee"]}
        fallback={
          <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              PAYE Pay History is available to employee accounts only.
            </div>
        }
      >
        <PayePayHistoryClient />
      </RoleGuard>
  );
}
