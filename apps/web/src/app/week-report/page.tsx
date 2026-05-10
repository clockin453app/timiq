import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";

import { WeekReportClient } from "./week-report-client";

export default function WeekReportPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/week-report">
        <WeekReportClient />
      </AppShell>
    </AuthGuard>
  );
}
