"use client";

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

export function WorkplacesClient() {
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
      setErrorMessage("Could not load workplaces.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadWorkplaces();
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
      setSuccessMessage(`Created ${created.name}`);
      setName("");
      setCode("");
      setAddress("");
      await loadWorkplaces();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not create workplace.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleWorkplaceTax(workplace: Workplace) {
    const raw = prompt(
      "Workplace CIS tax % (optional fallback after company default)",
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
      setSuccessMessage(`Updated tax for ${workplace.name}.`);
      await loadWorkplaces();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not update tax.");
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
      setSuccessMessage(`${updated.name} is now ${updated.is_active ? "active" : "inactive"}`);
      await loadWorkplaces();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not update workplace.");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <Sheet>
      <PageHeader
        title="Workplaces"
        description="Create and manage workplace records by company scope."
      />

      <SheetBody className="min-w-0">
        <RoleGuard
          allowedRoles={["administrator", "admin"]}
          fallback={
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              You do not have permission to manage workplaces.
            </div>
          }
        >
          <form className="mb-4 w-full max-w-[min(48rem,calc(100vw-2rem))] border border-[var(--color-border)] bg-[var(--color-cell)] p-3" onSubmit={handleCreate}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,180px)_minmax(0,1fr)_auto]">
              <label className="block text-xs font-bold text-[var(--color-text)]">
                Name
                <input
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  onChange={(event) => setName(event.target.value)}
                  required
                  type="text"
                  value={name}
                />
              </label>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                Code
                <input
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  onChange={(event) => setCode(event.target.value)}
                  type="text"
                  value={code}
                />
              </label>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                Address
                <input
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  onChange={(event) => setAddress(event.target.value)}
                  type="text"
                  value={address}
                />
              </label>
              <div className="flex flex-col">
                <span className="mb-1 text-xs font-bold opacity-0">Action</span>
                <Button className="h-10" disabled={isCreating} type="submit">
                  {isCreating ? "Creating..." : "Create workplace"}
                </Button>
              </div>
            </div>
          </form>

          {errorMessage ? (
            <div className="mb-3 border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
              {errorMessage}
            </div>
          ) : null}

          {successMessage ? (
            <div className="mb-3 border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm">
              {successMessage}
            </div>
          ) : null}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>CIS %</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6}>Loading workplaces...</TableCell>
                </TableRow>
              ) : null}
              {!isLoading && workplaces.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>No workplaces found.</TableCell>
                </TableRow>
              ) : null}
              {!isLoading
                ? workplaces.map((workplace) => (
                    <TableRow key={workplace.id}>
                      <TableCell>{workplace.name}</TableCell>
                      <TableCell>{workplace.code ?? "-"}</TableCell>
                      <TableCell>{workplace.is_active ? "Active" : "Inactive"}</TableCell>
                      <TableCell>{new Date(workplace.created_at).toLocaleDateString()}</TableCell>
                      <TableCell className="text-xs">{workplace.tax_rate ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            disabled={updatingId === workplace.id}
                            onClick={() => handleWorkplaceTax(workplace)}
                            type="button"
                          >
                            Set CIS
                          </Button>
                          <Button
                            disabled={updatingId === workplace.id}
                            onClick={() => handleToggleStatus(workplace)}
                            type="button"
                          >
                            {updatingId === workplace.id
                              ? "Updating..."
                              : workplace.is_active
                                ? "Deactivate"
                                : "Activate"}
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
