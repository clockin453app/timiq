import { RoleGuard } from "@/features/auth";
import { RamsEditorClient } from "../rams-editor-client";

export default function NewRamsPage() {
  return (
    <RoleGuard allowedRoles={["admin", "administrator"]}>
          <RamsEditorClient />
        </RoleGuard>
  );
}
