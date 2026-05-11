import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";

import { SiteProgressClient } from "./site-progress-client";

export default function SiteProgressPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/site-progress">
        <SiteProgressClient />
      </AppShell>
    </AuthGuard>
  );
}
