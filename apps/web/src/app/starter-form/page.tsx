import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";

import { StarterFormClient } from "./starter-form-client";

export default function StarterFormPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/starter-form">
        <StarterFormClient />
      </AppShell>
    </AuthGuard>
  );
}
