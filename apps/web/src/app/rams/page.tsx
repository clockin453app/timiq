import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";

import { RamsClient } from "./rams-client";

export default function RamsPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/rams">
        <RamsClient />
      </AppShell>
    </AuthGuard>
  );
}
