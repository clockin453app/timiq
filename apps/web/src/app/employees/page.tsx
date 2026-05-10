import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";
import { EmployeesClient } from "./employees-client";

export default function EmployeesPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/employees">
        <EmployeesClient />
      </AppShell>
    </AuthGuard>
  );
}