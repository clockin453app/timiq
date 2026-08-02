import { RoleGuard } from "@/features/auth";

import { EmployeeRamsDetailClient } from "./employee-rams-detail-client";

type PageProps = {
  params: Promise<{ assessmentId: string }>;
};

export default async function EmployeeRamsDetailPage({ params }: PageProps) {
  const { assessmentId } = await params;
  return (
    <RoleGuard allowedRoles={["employee"]}>
      <EmployeeRamsDetailClient assessmentId={assessmentId} />
    </RoleGuard>
  );
}
