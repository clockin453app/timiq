import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";
import { ClockSelfieReviewClient } from "./clock-selfie-review-client";

export default function ClockSelfieReviewPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/clock-selfie-review">
        <ClockSelfieReviewClient />
      </AppShell>
    </AuthGuard>
  );
}
