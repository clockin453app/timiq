import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";
import { SettingsClient } from "./settings-client";

export default function SettingsPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/settings">
        <SettingsClient />
      </AppShell>
    </AuthGuard>
  );
}
