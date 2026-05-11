import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";

import { WorkProgressReviewClient } from "./work-progress-review-client";

export default function WorkProgressReviewPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/work-progress-review">
        <WorkProgressReviewClient />
      </AppShell>
    </AuthGuard>
  );
}
