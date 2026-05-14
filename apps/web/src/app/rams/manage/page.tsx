import { AppShell } from "../../../components/layout";
import { AuthGuard, RoleGuard } from "../../../features/auth";

import { RamsManageClient } from "./rams-manage-client";

export default function RamsManagePage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/rams/manage">
        <RoleGuard
          allowedRoles={["admin", "administrator"]}
          fallback={
            <p className="text-sm text-[var(--color-text-soft)]">
              You do not have access to manage RAMS.{" "}
              <a className="font-semibold text-[var(--color-text)] underline" href="/rams">
                RAMS
              </a>
            </p>
          }
        >
          <RamsManageClient />
        </RoleGuard>
      </AppShell>
    </AuthGuard>
  );
}
