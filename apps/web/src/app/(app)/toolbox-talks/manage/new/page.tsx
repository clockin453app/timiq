import { RoleGuard } from "@/features/auth";
import { ToolboxTalkEditorClient } from "../toolbox-talk-editor-client";

export default function NewToolboxTalkPage() {
  return (
    <RoleGuard allowedRoles={["admin", "administrator"]}>
          <ToolboxTalkEditorClient />
        </RoleGuard>
  );
}
