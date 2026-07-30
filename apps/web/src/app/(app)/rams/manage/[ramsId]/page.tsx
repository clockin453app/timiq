import { RoleGuard } from "@/features/auth";
import { RamsDetailClient } from "../rams-detail-client";

type PageProps = {
  params: Promise<{ ramsId: string }>;
};

export default async function RamsDetailPage({ params }: PageProps) {
  const { ramsId } = await params;
  return (
    <RoleGuard allowedRoles={["admin", "administrator"]}>
          <RamsDetailClient ramsId={ramsId} />
        </RoleGuard>
  );
}
