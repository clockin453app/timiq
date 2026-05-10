import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";
import { SystemHealthClient } from "./system-health-client";

export default function SystemHealthPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/system-health">
        <SystemHealthClient />
      </AppShell>
    </AuthGuard>
  );
}
