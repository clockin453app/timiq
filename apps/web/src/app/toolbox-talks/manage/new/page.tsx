import { AppShell } from "../../../../components/layout";
import { AuthGuard, RoleGuard } from "../../../../features/auth";

import { ToolboxTalkEditorClient } from "../toolbox-talk-editor-client";

export default function NewToolboxTalkPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/toolbox-talks/manage">
        <RoleGuard allowedRoles={["admin", "administrator"]}>
          <ToolboxTalkEditorClient />
        </RoleGuard>
      </AppShell>
    </AuthGuard>
  );
}
