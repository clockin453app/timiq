import { RoleGuard } from "@/features/auth";
import { PayrollReportClient } from "./payroll-report-client";

export default function PayrollReportPage() {
  return (
    <RoleGuard
        allowedRoles={["administrator", "admin"]}
        fallback={
          <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              You do not have permission to view payroll reports.
            </div>
        }
      >
        <PayrollReportClient />
      </RoleGuard>
  );
}
