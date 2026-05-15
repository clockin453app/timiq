"use client";

import Link from "next/link";
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
import { listWorkplaces, type Workplace } from "../../features/workplaces/api";
import { useT } from "../../lib/i18n";

export function WorkplacesClient() {
  const t = useT();
  const [workplaces, setWorkplaces] = useState<Workplace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const data = await listWorkplaces();
        if (!cancelled) {
          setWorkplaces(data);
        }
      } catch {
        if (!cancelled) {
          setErrorMessage(t("workplaces.load_error", "Could not load legacy CIS records."));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <Sheet>
      <PageHeader
        title={t("workplaces.deprecated_title", "Legacy CIS records")}
        description={t(
          "workplaces.deprecated_description",
          "CIS workplace records are no longer used for operational setup. Manage the company default CIS deduction under Site payroll rules.",
        )}
      />

      <SheetBody className="min-w-0 space-y-4">
        <RoleGuard
          allowedRoles={["administrator", "admin"]}
          fallback={
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
              {t("workplaces.no_permission", "You do not have permission to view legacy CIS records.")}
            </div>
          }
        >
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-3 text-sm">
            <p className="font-semibold text-[var(--color-text)]">
              {t("workplaces.moved_title", "CIS settings have moved")}
            </p>
            <p className="mt-1 text-[var(--color-text-muted)]">
              {t(
                "workplaces.moved_body",
                "Set the default CIS deduction % on Site payroll rules. Sites control clocking, GPS, access, and budget labour — not these legacy records.",
              )}
            </p>
            <Link
              className="mt-3 inline-flex text-sm font-semibold text-[var(--color-text)] underline"
              href="/site-payroll-rules#cis-settings"
            >
              {t("workplaces.open_cis_settings", "Open CIS settings →")}
            </Link>
          </div>

          {errorMessage ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
              {errorMessage}
            </div>
          ) : null}

          <p className="text-xs text-[var(--color-text-muted)]">
            {t(
              "workplaces.read_only_note",
              "Existing records are listed read-only. Payroll uses employee CIS %, then the company default, then a legacy workplace rate only if no company default is set.",
            )}
          </p>

          <Table className="min-w-0">
            <TableHeader>
              <TableRow>
                <TableHead>{t("workplaces.col_name", "Name")}</TableHead>
                <TableHead>{t("workplaces.col_code", "Code")}</TableHead>
                <TableHead>{t("workplaces.col_status", "Status")}</TableHead>
                <TableHead>{t("workplaces.col_cis", "Legacy CIS %")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4}>{t("workplaces.loading", "Loading…")}</TableCell>
                </TableRow>
              ) : null}
              {!isLoading && workplaces.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>{t("workplaces.empty", "No legacy CIS records.")}</TableCell>
                </TableRow>
              ) : null}
              {!isLoading
                ? workplaces.map((workplace) => (
                    <TableRow key={workplace.id}>
                      <TableCell>{workplace.name}</TableCell>
                      <TableCell>{workplace.code ?? "—"}</TableCell>
                      <TableCell>
                        {workplace.is_active
                          ? t("workplaces.status_active", "Active")
                          : t("workplaces.status_inactive", "Inactive")}
                      </TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {workplace.tax_rate != null && workplace.tax_rate !== ""
                          ? `${workplace.tax_rate}%`
                          : "—"}
                      </TableCell>
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
