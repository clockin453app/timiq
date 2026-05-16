import { AppShell } from "../../../../components/layout";
import { AuthGuard, RoleGuard } from "../../../../features/auth";

import { RamsEditorClient } from "../rams-editor-client";

export default function NewRamsPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/rams/manage">
        <RoleGuard allowedRoles={["admin", "administrator"]}>
          <RamsEditorClient />
        </RoleGuard>
      </AppShell>
    </AuthGuard>
  );
}
