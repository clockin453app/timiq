import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";

import { PrivacyClient } from "./privacy-client";

export default function PrivacyPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/privacy">
        <PrivacyClient />
      </AppShell>
    </AuthGuard>
  );
}
