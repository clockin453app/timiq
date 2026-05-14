import { AppShell } from "../../../components/layout";
import { AuthGuard, RoleGuard } from "../../../features/auth";

import { ToolboxTalksManageClient } from "./toolbox-talks-manage-client";

export default function ToolboxTalksManagePage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/toolbox-talks/manage">
        <RoleGuard
          allowedRoles={["admin", "administrator"]}
          fallback={
            <p className="text-sm text-[var(--color-text-soft)]">
              You do not have access to manage toolbox talks.{" "}
              <a className="font-semibold text-[var(--color-text)] underline" href="/toolbox-talks">
                Toolbox talks
              </a>
            </p>
          }
        >
          <ToolboxTalksManageClient />
        </RoleGuard>
      </AppShell>
    </AuthGuard>
  );
}
