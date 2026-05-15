import { AppShell } from "../../components/layout";
import { AdminDashboardRedirect, AuthGuard } from "../../features/auth";

import { DashboardHome } from "./dashboard-client";

export default function DashboardPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/dashboard">
        <AdminDashboardRedirect>
          <DashboardHome />
        </AdminDashboardRedirect>
      </AppShell>
    </AuthGuard>
  );
}
