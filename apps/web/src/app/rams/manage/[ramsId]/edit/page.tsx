import { AppShell } from "../../../../../components/layout";
import { AuthGuard, RoleGuard } from "../../../../../features/auth";

import { RamsEditorClient } from "../../rams-editor-client";

type PageProps = {
  params: Promise<{ ramsId: string }>;
};

export default async function EditRamsPage({ params }: PageProps) {
  const { ramsId } = await params;
  return (
    <AuthGuard>
      <AppShell activeHref="/rams/manage">
        <RoleGuard allowedRoles={["admin", "administrator"]}>
          <RamsEditorClient ramsId={ramsId} />
        </RoleGuard>
      </AppShell>
    </AuthGuard>
  );
}
