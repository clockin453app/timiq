import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";
import { ClockClient } from "./clock-client";

export default function ClockPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/clock">
        <ClockClient />
      </AppShell>
    </AuthGuard>
  );
}
