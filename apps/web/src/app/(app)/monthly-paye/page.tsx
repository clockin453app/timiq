import { RoleGuard } from "@/features/auth";
import { MonthlyPayeClient } from "./monthly-paye-client";

export default function MonthlyPayePage() {
  return (
    <RoleGuard
        allowedRoles={["administrator", "admin"]}
        fallback={
          <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              Monthly PAYE Report is available to admins and administrators.
            </div>
        }
      >
        <MonthlyPayeClient />
      </RoleGuard>
  );
}
