
import { EmployeeClockSelfiesClient } from "./employee-clock-selfies-client";

type EmployeeClockSelfiesPageProps = {
  params: Promise<{
    userId: string;
  }>;
};

export default async function EmployeeClockSelfiesPage({ params }: EmployeeClockSelfiesPageProps) {
  const { userId } = await params;

  return (
    <EmployeeClockSelfiesClient userId={userId} />
  );
}
