import { RoleGuard } from "@/features/auth";
import { FinanceModuleGate } from "@/features/finance/finance-module-gate";
import { FinanceWorkspace } from "@/features/finance/finance-workspace";

export default function FinancePage() {
  return (
    <RoleGuard allowedRoles={["administrator", "admin"]}>
      <FinanceModuleGate>
        <FinanceWorkspace />
      </FinanceModuleGate>
    </RoleGuard>
  );
}
