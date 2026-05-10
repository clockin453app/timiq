import { AppShell } from "../../../../components/layout";
import { AuthGuard } from "../../../../features/auth";
import { EmployeeClockSelfiesClient } from "./employee-clock-selfies-client";

type EmployeeClockSelfiesPageProps = {
  params: Promise<{
    userId: string;
  }>;
};

export default async function EmployeeClockSelfiesPage({ params }: EmployeeClockSelfiesPageProps) {
  const { userId } = await params;

  return (
    <AuthGuard>
      <AppShell activeHref="/employees">
        <EmployeeClockSelfiesClient userId={userId} />
      </AppShell>
    </AuthGuard>
  );
}
