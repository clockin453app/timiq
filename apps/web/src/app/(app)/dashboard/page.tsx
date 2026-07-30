import { AdminDashboardRedirect } from "@/features/auth";
import { DashboardHome } from "./dashboard-client";

export default function DashboardPage() {
  return (
    <AdminDashboardRedirect>
          <DashboardHome />
        </AdminDashboardRedirect>
  );
}
