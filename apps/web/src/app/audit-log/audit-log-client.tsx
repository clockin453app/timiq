"use client";

import { useEffect, useState } from "react";

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
import { RoleGuard } from "../../features/auth";
import { listAuditEvents, type AuditEvent } from "../../features/audit/api";

export function AuditLogClient() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function loadEvents() {
      setIsLoading(true);
      try {
        const records = await listAuditEvents();
        setEvents(records);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not load audit logs.");
      } finally {
        setIsLoading(false);
      }
    }

    loadEvents();
  }, []);

  return (
    <Sheet>
      <PageHeader title="Audit Log" description="Track core management actions and changes." />
      <SheetBody>
        <RoleGuard
          allowedRoles={["administrator"]}
          fallback={
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              You do not have permission to view audit logs.
            </div>
          }
        >
          {errorMessage ? (
            <div className="mb-3 border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
              {errorMessage}
            </div>
          ) : null}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Entity ID</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4}>Loading audit events...</TableCell>
                </TableRow>
              ) : null}
              {!isLoading && events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>No audit events found.</TableCell>
                </TableRow>
              ) : null}
              {!isLoading
                ? events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell>{event.action}</TableCell>
                      <TableCell>{event.entity_type}</TableCell>
                      <TableCell>{event.entity_id ?? "-"}</TableCell>
                      <TableCell>{new Date(event.created_at).toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                : null}
            </TableBody>
          </Table>
        </RoleGuard>
      </SheetBody>
    </Sheet>
  );
}
