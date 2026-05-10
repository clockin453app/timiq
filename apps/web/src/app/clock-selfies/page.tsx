import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";
import { ClockSelfiesClient } from "./clock-selfies-client";

export default function ClockSelfiesPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/clock">
        <ClockSelfiesClient />
      </AppShell>
    </AuthGuard>
  );
}
