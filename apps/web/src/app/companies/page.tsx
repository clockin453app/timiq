import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";
import { CompaniesClient } from "./companies-client";

export default function CompaniesPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/companies">
        <CompaniesClient />
      </AppShell>
    </AuthGuard>
  );
}