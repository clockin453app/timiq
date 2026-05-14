import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";

import { FormsClient } from "./forms-client";

export default function FormsPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/forms">
        <FormsClient />
      </AppShell>
    </AuthGuard>
  );
}
