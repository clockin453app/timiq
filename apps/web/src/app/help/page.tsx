import { AppShell } from "../../components/layout";
import { Sheet } from "../../components/ui";
import { AuthGuard } from "../../features/auth";

import { HelpCentreClient } from "./help-client";

export default function HelpPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/help">
        <Sheet>
          <HelpCentreClient />
        </Sheet>
      </AppShell>
    </AuthGuard>
  );
}
