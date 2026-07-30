import { RoleGuard } from "@/features/auth";
import { ToolboxTalkDetailClient } from "../toolbox-talk-detail-client";

type PageProps = {
  params: Promise<{ talkId: string }>;
};

export default async function ToolboxTalkDetailPage({ params }: PageProps) {
  const { talkId } = await params;
  return (
    <RoleGuard allowedRoles={["admin", "administrator"]}>
          <ToolboxTalkDetailClient talkId={talkId} />
        </RoleGuard>
  );
}
