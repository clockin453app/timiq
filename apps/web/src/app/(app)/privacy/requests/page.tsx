import { RoleGuard } from "@/features/auth";
import { PrivacyRequestsClient } from "./privacy-requests-client";

export default function PrivacyRequestsPage() {
  return (
    <RoleGuard
        allowedRoles={["administrator", "admin"]}
        fallback={
          <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              You do not have permission to view privacy requests.
            </div>
        }
      >
        <PrivacyRequestsClient />
      </RoleGuard>
  );
}
