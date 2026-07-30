
import { FormSubmissionClient } from "./form-submission-client";

type PageProps = {
  params: Promise<{ submissionId: string }>;
};

export default async function FormSubmissionPage({ params }: PageProps) {
  const { submissionId } = await params;
  return (
    <FormSubmissionClient submissionId={submissionId} />
  );
}
