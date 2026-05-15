"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import {
  Button,
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
import {
  createWorkplace,
  listWorkplaces,
  patchWorkplaceTax,
  updateWorkplaceStatus,
  type Workplace,
} from "../../features/workplaces/api";
import { useT } from "../../lib/i18n";

export function WorkplacesClient() {
  const t = useT();
  const [workplaces, setWorkplaces] = useState<Workplace[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  async function loadWorkplaces() {
    setIsLoading(true);
    try {
      const data = await listWorkplaces();
      setWorkplaces(data);
    } catch {
      setErrorMessage(t("workplaces.load_error", "Could not load CIS workplaces."));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkplaces();
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");
    setIsCreating(true);

    try {
      const created = await createWorkplace({
        name,
        code: code || null,
        address: address || null,
        is_active: true,
      });
      setSuccessMessage(t("workplaces.created", "Created {name}.").replace("{name}", created.name));
      setName("");
      setCode("");
      setAddress("");
      await loadWorkplaces();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("workplaces.create_error", "Could not create record."));
    } finally {
      setIsCreating(false);
    }
  }

  async function handleWorkplaceTax(workplace: Workplace) {
    const raw = prompt(
      t(
        "workplaces.cis_prompt",
        "CIS deduction % for this payroll workplace (optional; used after employee and company defaults)",
      ),
      workplace.tax_rate ?? "",
    );
    if (raw === null) {
      return;
    }
    setErrorMessage("");
    setSuccessMessage("");
    setUpdatingId(workplace.id);
    try {
      const trimmed = raw.trim();
      await patchWorkplaceTax(workplace.id, {
        tax_rate: trimmed === "" ? null : trimmed,
      });
      setSuccessMessage(t("workplaces.tax_updated", "Updated CIS % for {name}.").replace("{name}", workplace.name));
      await loadWorkplaces();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("workplaces.tax_error", "Could not update CIS %."));
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleToggleStatus(workplace: Workplace) {
    setErrorMessage("");
    setSuccessMessage("");
    setUpdatingId(workplace.id);
    try {
      const updated = await updateWorkplaceStatus(workplace.id, !workplace.is_active);
      setSuccessMessage(
        updated.is_active
          ? t("workplaces.activated", "{name} is active.").replace("{name}", updated.name)
          : t("workplaces.deactivated", "{name} is inactive.").replace("{name}", updated.name),
      );
      await loadWorkplaces();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("workplaces.status_error", "Could not update status."));
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <Sheet>
      <PageHeader
        title={t("workplaces.title", "CIS Workplaces")}
        description={t(
          "workplaces.description",
          "Payroll/CIS reporting labels and deduction rates. Not used for clock-in, GPS, or site access.",
        )}
      />

      <SheetBody className="min-w-0 space-y-4">
        <RoleGuard
          allowedRoles={["administrator", "admin"]}
          fallback={
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
              {t("workplaces.no_permission", "You do not have permission to manage CIS workplaces.")}
            </div>
          }
        >
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] border-l-4 border-l-[var(--color-warning-700)] bg-[var(--color-header)] px-3 py-3 text-sm text-[var(--color-text)]">
            <p className="font-semibold">{t("workplaces.not_sites_title", "Not the same as Sites")}</p>
            <p className="mt-1.5 text-[var(--color-text-muted)]">
              {t(
                "workplaces.not_sites_body",
                "Operational locations (clock-in, geofence, site access, site payroll rules) are managed under Sites. A workplace named “Kennington” here is a separate payroll record unless you link them in a future migration.",
              )}
            </p>
            <Link
              className="mt-2 inline-block text-sm font-semibold text-[var(--color-text)] underline"
              href="/locations"
            >
              {t("workplaces.manage_sites_link", "Manage operational sites →")}
            </Link>
          </div>

          <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
            {t(
              "workplaces.cis_fallback_note",
              "Payroll uses employee CIS % first, then the first workplace (alphabetical by name) with a CIS % set, then the company default. Shifts are not assigned to workplaces today.",
            )}
          </p>

          <form
            className="w-full max-w-[min(48rem,calc(100vw-2rem))] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-cell)] p-3"
            onSubmit={handleCreate}
          >
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
              {t("workplaces.add_record", "Add payroll workplace record")}
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,180px)_minmax(0,1fr)_auto]">
              <label className="block text-xs font-bold text-[var(--color-text)]">
                {t("workplaces.field_name", "Name")}
                <input
                  className="mt-1 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  onChange={(event) => setName(event.target.value)}
                  required
                  type="text"
                  value={name}
                />
              </label>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                {t("workplaces.field_code", "Workplace code")}
                <input
                  className="mt-1 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  onChange={(event) => setCode(event.target.value)}
                  type="text"
                  value={code}
                />
              </label>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                {t("workplaces.field_address", "Address (optional)")}
                <input
                  className="mt-1 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  onChange={(event) => setAddress(event.target.value)}
                  type="text"
                  value={address}
                />
              </label>
              <div className="flex flex-col">
                <span className="mb-1 text-xs font-bold opacity-0">Action</span>
                <Button className="h-10" disabled={isCreating} type="submit">
                  {isCreating
                    ? t("workplaces.creating", "Creating…")
                    : t("workplaces.create_button", "Add record")}
                </Button>
              </div>
            </div>
          </form>

          {errorMessage ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
              {errorMessage}
            </div>
          ) : null}

          {successMessage ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm">
              {successMessage}
            </div>
          ) : null}

          <Table className="min-w-0">
            <TableHeader>
              <TableRow>
                <TableHead>{t("workplaces.col_name", "Name")}</TableHead>
                <TableHead>{t("workplaces.col_code", "Workplace code")}</TableHead>
                <TableHead>{t("workplaces.col_status", "Status")}</TableHead>
                <TableHead>{t("workplaces.col_cis", "CIS deduction %")}</TableHead>
                <TableHead>{t("workplaces.col_actions", "Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5}>{t("workplaces.loading", "Loading…")}</TableCell>
                </TableRow>
              ) : null}
              {!isLoading && workplaces.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>{t("workplaces.empty", "No CIS workplace records yet.")}</TableCell>
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
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            disabled={updatingId === workplace.id}
                            onClick={() => void handleWorkplaceTax(workplace)}
                            type="button"
                            variant="secondary"
                          >
                            {t("workplaces.set_cis", "Set CIS %")}
                          </Button>
                          <Button
                            disabled={updatingId === workplace.id}
                            onClick={() => void handleToggleStatus(workplace)}
                            type="button"
                            variant="secondary"
                          >
                            {updatingId === workplace.id
                              ? t("workplaces.updating", "Updating…")
                              : workplace.is_active
                                ? t("workplaces.deactivate", "Deactivate")
                                : t("workplaces.activate", "Activate")}
                          </Button>
                        </div>
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
