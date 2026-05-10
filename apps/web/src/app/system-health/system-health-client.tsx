"use client";

import { useEffect, useState } from "react";

import {
  PageHeader,
  Sheet,
  SheetBody,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "../../components/ui";
import { RoleGuard } from "../../features/auth";
import { getSystemHealth, type SystemHealth } from "../../features/system-health/api";

export function SystemHealthClient() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const data = await getSystemHealth();
        setHealth(data);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not load system health.");
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  return (
    <Sheet>
      <PageHeader title="System Health" description="Core service and storage health indicators." />
      <SheetBody>
        <RoleGuard
          allowedRoles={["administrator"]}
          fallback={
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              You do not have permission to view system health.
            </div>
          }
        >
          {isLoading ? <div className="text-sm">Loading health data...</div> : null}
          {errorMessage ? (
            <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
              {errorMessage}
            </div>
          ) : null}
          {health ? (
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell>Application</TableCell>
                  <TableCell>{health.app}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Environment</TableCell>
                  <TableCell>{health.environment}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Overall status</TableCell>
                  <TableCell>{health.status}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Database</TableCell>
                  <TableCell>{health.database}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Storage</TableCell>
                  <TableCell>{health.storage}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          ) : null}
        </RoleGuard>
      </SheetBody>
    </Sheet>
  );
}
