import { redirect } from "next/navigation";

export default function LegacyAuditLogRedirect() {
  redirect("/system/audit-log");
}
