import { AppShell } from "../../components/layout";
import { Sheet } from "../../components/ui";
import { AuthGuard, LogoutButton } from "../../features/auth";

import { HelpCentreClient } from "./help-client";

export default function HelpPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/help">
        <Sheet>
          <HelpCentreClient logoutAction={<LogoutButton />} />
        </Sheet>
      </AppShell>
    </AuthGuard>
  );
}
