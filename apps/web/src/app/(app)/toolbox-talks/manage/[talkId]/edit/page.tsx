import { RoleGuard } from "@/features/auth";
import { ToolboxTalkEditorClient } from "../../toolbox-talk-editor-client";

type PageProps = {
  params: Promise<{ talkId: string }>;
};

export default async function EditToolboxTalkPage({ params }: PageProps) {
  const { talkId } = await params;
  return (
    <RoleGuard allowedRoles={["admin", "administrator"]}>
          <ToolboxTalkEditorClient talkId={talkId} />
        </RoleGuard>
  );
}
