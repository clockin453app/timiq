import { AppShell } from "../../../components/layout";
import { AuthGuard, RoleGuard } from "../../../features/auth";

import { PayWeekDetailClient } from "./pay-week-detail-client";

type PayWeekDetailPageProps = {
  params: Promise<{
    itemId: string;
  }>;
};

export default async function PayWeekDetailPage({ params }: PayWeekDetailPageProps) {
  const { itemId } = await params;

  return (
    <AuthGuard>
      <RoleGuard
        allowedRoles={["employee", "admin", "administrator"]}
        fallback={
          <AppShell activeHref="/dashboard">
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              You do not have access to this page.
            </div>
          </AppShell>
        }
      >
        <AppShell activeHref="/pay-history">
          <PayWeekDetailClient itemId={itemId} />
        </AppShell>
      </RoleGuard>
    </AuthGuard>
  );
}
