import { AppShell } from "../../components/layout";
import {
  PageHeader,
  Sheet,
  SheetBody,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui";
import { AuthGuard, LogoutButton } from "../../features/auth";

export default function DashboardPage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/dashboard">
        <Sheet>
          <PageHeader
            title="Dashboard"
            description="Workforce summary and payroll activity."
            action={<LogoutButton />}
          />

          <SheetBody>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                <TableRow>
                  <TableCell>Employees clocked in</TableCell>
                  <TableCell>0</TableCell>
                  <TableCell>Ready</TableCell>
                </TableRow>

                <TableRow>
                  <TableCell>Weekly payroll period</TableCell>
                  <TableCell>Not started</TableCell>
                  <TableCell>Setup required</TableCell>
                </TableRow>

                <TableRow>
                  <TableCell>Workplaces configured</TableCell>
                  <TableCell>0</TableCell>
                  <TableCell>Setup required</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </SheetBody>
        </Sheet>
      </AppShell>
    </AuthGuard>
  );
}