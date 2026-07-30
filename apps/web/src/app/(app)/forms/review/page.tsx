import { RoleGuard } from "@/features/auth";
import { FormsReviewClient } from "./forms-review-client";

export default function FormsReviewPage() {
  return (
    <RoleGuard
        allowedRoles={["administrator", "admin"]}
        fallback={
          <div className="p-6 text-sm text-[var(--color-text-soft)]">
            You do not have access to form review.
          </div>
        }
      >
        <FormsReviewClient />
      </RoleGuard>
  );
}
