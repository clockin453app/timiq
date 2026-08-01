import { RoleGuard } from "@/features/auth";
import { RamsReaderClient } from "@/features/rams/rams-reader-client";

type PageProps = {
  params: Promise<{ assessmentId: string }>;
};

export default async function RamsReadPage({ params }: PageProps) {
  const { assessmentId } = await params;
  return (
    <RoleGuard allowedRoles={["employee"]}>
      <RamsReaderClient assessmentId={assessmentId} />
    </RoleGuard>
  );
}
