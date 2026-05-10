import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";
import { LocationsClient } from "./locations-client";

export default function LocationsPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/locations">
        <LocationsClient />
      </AppShell>
    </AuthGuard>
  );
}