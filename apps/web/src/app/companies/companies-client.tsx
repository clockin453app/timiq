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
import {
  isAdministrator,
  RoleGuard,
  useCurrentUser,
} from "../../features/auth";
import {
  createCompany,
  listCompanies,
  updateCompany,
  updateCompanyStatus,
  type Company,
} from "../../features/companies/api";
import { useT } from "../../lib/i18n";

import { CompanyPayrollTaxModal } from "./company-payroll-tax-modal";
import { CompanyTimePolicyModal } from "./company-time-policy-modal";

type EditingCompanyState = {
  id: string;
  name: string;
};

export function CompaniesClient() {
  const t = useT();
  const currentUser = useCurrentUser();
  const administratorView = isAdministrator(currentUser);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [name, setName] = useState("");
  const [editingCompany, setEditingCompany] =
    useState<EditingCompanyState | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [updatingCompanyId, setUpdatingCompanyId] = useState<string | null>(null);
  const [policyCompany, setPolicyCompany] = useState<Company | null>(null);
  const [payrollTaxCompany, setPayrollTaxCompany] = useState<Company | null>(null);

  async function loadCompanies() {
    setIsLoading(true);

    try {
      const loadedCompanies = await listCompanies();
      setCompanies(loadedCompanies);
    } catch {
      setErrorMessage("Could not load companies.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadCompanies();
  }, []);

  async function handleCreateCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setErrorMessage("");
    setSuccessMessage("");
    setIsCreating(true);

    try {
      const createdCompany = await createCompany({
        name,
        is_active: true,
      });

      setSuccessMessage(`Created ${createdCompany.name}`);
      setName("");
      await loadCompanies();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not create company.",
      );
    } finally {
      setIsCreating(false);
    }
  }

  function startEditingCompany(company: Company) {
    setErrorMessage("");
    setSuccessMessage("");

    setEditingCompany({
      id: company.id,
      name: company.name,
    });
  }

  function cancelEditingCompany() {
    setEditingCompany(null);
    setErrorMessage("");
  }

  async function saveEditingCompany() {
    if (!editingCompany) {
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");
    setUpdatingCompanyId(editingCompany.id);

    try {
      const updatedCompany = await updateCompany(editingCompany.id, {
        name: editingCompany.name,
      });

      setSuccessMessage(`Updated ${updatedCompany.name}`);
      setEditingCompany(null);
      await loadCompanies();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not update company.",
      );
    } finally {
      setUpdatingCompanyId(null);
    }
  }

  async function handleToggleCompanyStatus(company: Company) {
    setErrorMessage("");
    setSuccessMessage("");
    setUpdatingCompanyId(company.id);

    try {
      const updatedCompany = await updateCompanyStatus(
        company.id,
        !company.is_active,
      );

      setSuccessMessage(
        `${updatedCompany.name} is now ${
          updatedCompany.is_active ? "active" : "inactive"
        }`,
      );

      await loadCompanies();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not update company.",
      );
    } finally {
      setUpdatingCompanyId(null);
    }
  }

  return (
    <>
    <Sheet>
      <PageHeader
        title={t("companies.title", "Companies")}
        description={t("companies.description", "Create, review, edit, activate, and deactivate company accounts.")}
      />

      <SheetBody className="min-w-0">
        <RoleGuard
          allowedRoles={["administrator", "admin"]}
          fallback={
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              You do not have permission to view companies.
            </div>
          }
        >
          <div className="mb-3 border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2 text-sm">
            {administratorView
              ? "You can create and manage all companies."
              : "You can review your assigned company only."}
          </div>

          {administratorView ? (
            <form
              className="mb-4 w-full max-w-[min(40rem,calc(100vw-2rem))] border border-[var(--color-border)] bg-[var(--color-cell)] p-3"
              onSubmit={handleCreateCompany}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <label className="block text-xs font-bold text-[var(--color-text)]">
                  Company name
                  <input
                    className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    name="name"
                    onChange={(event) => setName(event.target.value)}
                    required
                    type="text"
                    value={name}
                  />
                </label>

                <div className="flex flex-col">
                  <span className="mb-1 text-xs font-bold opacity-0">
                    Action
                  </span>
                  <Button className="h-10" disabled={isCreating} type="submit">
                    {isCreating ? "Creating..." : "Create company"}
                  </Button>
                </div>
              </div>
            </form>
          ) : null}

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
                <TableHead>{t("companies.name", "Name")}</TableHead>
                <TableHead>{t("companies.status", "Status")}</TableHead>
                <TableHead>Created</TableHead>
                {administratorView ? <TableHead>Default CIS %</TableHead> : null}
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={administratorView ? 5 : 4}>Loading companies...</TableCell>
                </TableRow>
              ) : null}

              {!isLoading && companies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={administratorView ? 5 : 4}>No companies found.</TableCell>
                </TableRow>
              ) : null}

              {!isLoading
                ? companies.map((company) => {
                    const isEditing = editingCompany?.id === company.id;

                    if (isEditing && editingCompany) {
                      return (
                        <TableRow key={company.id}>
                          <TableCell>
                            <input
                              className="h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                              onChange={(event) =>
                                setEditingCompany({
                                  ...editingCompany,
                                  name: event.target.value,
                                })
                              }
                              value={editingCompany.name}
                            />
                          </TableCell>

                          <TableCell>
                            {company.is_active ? "Active" : "Inactive"}
                          </TableCell>

                          <TableCell>
                            {new Date(company.created_at).toLocaleDateString()}
                          </TableCell>

                          {administratorView ? (
                            <TableCell className="text-xs">
                              {company.default_tax_rate ?? "—"}
                            </TableCell>
                          ) : null}

                          <TableCell>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                disabled={updatingCompanyId === company.id}
                                onClick={saveEditingCompany}
                                type="button"
                              >
                                Save
                              </Button>

                              <Button
                                disabled={updatingCompanyId === company.id}
                                onClick={cancelEditingCompany}
                                type="button"
                              >
                                Cancel
                              </Button>

                              <Button
                                disabled={updatingCompanyId === company.id}
                                onClick={() => setPolicyCompany(company)}
                                type="button"
                              >
                                Time policy
                              </Button>

                              {administratorView ? (
                                <Button
                                  disabled={updatingCompanyId === company.id}
                                  onClick={() => setPayrollTaxCompany(company)}
                                  type="button"
                                >
                                  CIS default
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    }

                    return (
                      <TableRow key={company.id}>
                        <TableCell>{company.name}</TableCell>
                        <TableCell>
                          {company.is_active ? "Active" : "Inactive"}
                        </TableCell>
                        <TableCell>
                          {new Date(company.created_at).toLocaleDateString()}
                        </TableCell>
                        {administratorView ? (
                          <TableCell className="text-xs">
                            {company.default_tax_rate ?? "—"}
                          </TableCell>
                        ) : null}
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {administratorView ? (
                              <>
                                <Button
                                  onClick={() => startEditingCompany(company)}
                                  type="button"
                                >
                                  Edit
                                </Button>

                                <Button
                                  disabled={updatingCompanyId === company.id}
                                  onClick={() =>
                                    handleToggleCompanyStatus(company)
                                  }
                                  type="button"
                                >
                                  {updatingCompanyId === company.id
                                    ? "Updating..."
                                    : company.is_active
                                      ? "Deactivate"
                                      : "Activate"}
                                </Button>
                              </>
                            ) : (
                              <span className="text-xs text-[var(--color-text-muted)]">
                                View only
                              </span>
                            )}
                            <Button
                              onClick={() => setPolicyCompany(company)}
                              type="button"
                            >
                              Time policy
                            </Button>

                            {administratorView ? (
                              <Button
                                onClick={() => setPayrollTaxCompany(company)}
                                type="button"
                              >
                                CIS default
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                : null}
            </TableBody>
          </Table>
        </RoleGuard>
      </SheetBody>

    </Sheet>

      {policyCompany ? (
        <CompanyTimePolicyModal
          company={policyCompany}
          onClose={() => setPolicyCompany(null)}
          onSaved={async () => {
            setSuccessMessage(`Updated time policy for ${policyCompany.name}.`);
          }}
        />
      ) : null}

      {payrollTaxCompany ? (
        <CompanyPayrollTaxModal
          company={payrollTaxCompany}
          onClose={() => setPayrollTaxCompany(null)}
          onSaved={async () => {
            setSuccessMessage(`Updated default CIS rate for ${payrollTaxCompany.name}.`);
            await loadCompanies();
          }}
        />
      ) : null}
    </>
  );
}