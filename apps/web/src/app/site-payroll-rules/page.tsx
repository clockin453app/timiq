import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";
import { SitePayrollRulesClient } from "./site-payroll-rules-client";

export default function SitePayrollRulesPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/site-payroll-rules">
        <SitePayrollRulesClient />
      </AppShell>
    </AuthGuard>
  );
}
