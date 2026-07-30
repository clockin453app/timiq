import { RoleGuard } from "@/features/auth";
import { BudgetsClient } from "./budgets-client";

export default function BudgetsPage() {
  return (
    <RoleGuard
        allowedRoles={["administrator", "admin"]}
        fallback={
          <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              You do not have permission to view the budget calculator.
            </div>
        }
      >
        <BudgetsClient />
      </RoleGuard>
  );
}
