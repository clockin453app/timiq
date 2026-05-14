import { AppShell } from "../../../components/layout";
import { AuthGuard, RoleGuard } from "../../../features/auth";

import { FormsReviewClient } from "./forms-review-client";

export default function FormsReviewPage() {
  return (
    <AuthGuard>
      <RoleGuard
        allowedRoles={["administrator", "admin"]}
        fallback={
          <div className="p-6 text-sm text-[var(--color-text-soft)]">
            You do not have access to form review.
          </div>
        }
      >
        <AppShell activeHref="/forms/review">
          <FormsReviewClient />
        </AppShell>
      </RoleGuard>
    </AuthGuard>
  );
}
