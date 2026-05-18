import { AppShell } from "../../../components/layout";
import { AuthGuard, RoleGuard } from "../../../features/auth";

import { TimesheetWeekDetailClient } from "./timesheet-week-detail-client";

type TimesheetWeekPageProps = {
  searchParams: Promise<{
    week_start?: string;
  }>;
};

export default async function TimesheetWeekPage({ searchParams }: TimesheetWeekPageProps) {
  const params = await searchParams;
  const weekStart = params.week_start ?? "";

  return (
    <AuthGuard>
      <RoleGuard
        allowedRoles={["employee"]}
        fallback={
          <AppShell activeHref="/dashboard">
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              Timesheets are available to employee accounts only.
            </div>
          </AppShell>
        }
      >
        <AppShell activeHref="/timesheets">
          <TimesheetWeekDetailClient weekStart={weekStart} />
        </AppShell>
      </RoleGuard>
    </AuthGuard>
  );
}
