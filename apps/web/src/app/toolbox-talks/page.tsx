import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";

import { ToolboxTalksClient } from "./toolbox-talks-client";

export default function ToolboxTalksPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/toolbox-talks">
        <ToolboxTalksClient />
      </AppShell>
    </AuthGuard>
  );
}
