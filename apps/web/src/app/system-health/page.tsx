import { redirect } from "next/navigation";

export default function LegacySystemHealthRedirect() {
  redirect("/system/health");
}
