import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";
import { WorkplacesClient } from "./workplaces-client";

export default function WorkplacesPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/workplaces">
        <WorkplacesClient />
      </AppShell>
    </AuthGuard>
  );
}
