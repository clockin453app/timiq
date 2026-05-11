import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";
import { LiveAttendanceClient } from "./live-attendance-client";

export default function LiveAttendancePage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/live-attendance">
        <LiveAttendanceClient />
      </AppShell>
    </AuthGuard>
  );
}
