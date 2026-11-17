"use client";

import { RoleGuard } from "@/features/auth";
import { FinanceAuditTrail } from "@/features/finance/finance-audit-trail";
import { FinanceModuleGate } from "@/features/finance/finance-module-gate";

export default function FinanceAuditPage() {
  return (
    <RoleGuard allowedRoles={["administrator", "admin"]}>
      <FinanceModuleGate>
        <FinanceAuditTrail />
      </FinanceModuleGate>
    </RoleGuard>
  );
}
