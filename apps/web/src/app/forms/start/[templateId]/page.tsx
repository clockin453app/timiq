import { AppShell } from "../../../../components/layout";
import { AuthGuard } from "../../../../features/auth";

import { FormStartClient } from "./form-start-client";

type PageProps = {
  params: Promise<{ templateId: string }>;
};

export default async function FormStartPage({ params }: PageProps) {
  const { templateId } = await params;
  return (
    <AuthGuard>
      <AppShell activeHref="/forms">
        <FormStartClient templateId={templateId} />
      </AppShell>
    </AuthGuard>
  );
}
