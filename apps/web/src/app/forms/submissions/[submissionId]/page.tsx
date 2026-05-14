import { AppShell } from "../../../../components/layout";
import { AuthGuard } from "../../../../features/auth";

import { FormSubmissionClient } from "./form-submission-client";

type PageProps = {
  params: Promise<{ submissionId: string }>;
};

export default async function FormSubmissionPage({ params }: PageProps) {
  const { submissionId } = await params;
  return (
    <AuthGuard>
      <AppShell activeHref="/forms">
        <FormSubmissionClient submissionId={submissionId} />
      </AppShell>
    </AuthGuard>
  );
}
