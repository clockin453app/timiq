import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";

import { OnboardingReviewClient } from "./onboarding-review-client";

export default function OnboardingReviewPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/onboarding-review">
        <OnboardingReviewClient />
      </AppShell>
    </AuthGuard>
  );
}
