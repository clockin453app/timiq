import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";
import { SiteAccessClient } from "./site-access-client";

export default function SiteAccessPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/site-access">
        <SiteAccessClient />
      </AppShell>
    </AuthGuard>
  );
}
