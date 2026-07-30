
import { FormStartClient } from "./form-start-client";

type PageProps = {
  params: Promise<{ templateId: string }>;
};

export default async function FormStartPage({ params }: PageProps) {
  const { templateId } = await params;
  return (
    <FormStartClient templateId={templateId} />
  );
}
