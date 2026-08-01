import { RoleGuard } from "@/features/auth";
import { RamsUploadClient } from "../rams-upload-client";

export default function UploadRamsPage() {
  return (
    <RoleGuard allowedRoles={["admin", "administrator"]}>
      <RamsUploadClient />
    </RoleGuard>
  );
}
