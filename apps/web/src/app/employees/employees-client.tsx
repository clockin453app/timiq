"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

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
  createManagedUser,
  isAdministrator,
  listManagedUsers,
  RoleGuard,
  useCurrentUser,
  type AuthUser,
  type SystemRole,
} from "../../features/auth";
import { listCompanies, type Company } from "../../features/companies/api";

import { EmployeeDetailPanel } from "./employee-detail-panel";

function formatEmployeeDisplayName(user: AuthUser): string {
  const first = user.profile_first_name?.trim();
  const last = user.profile_last_name?.trim();
  if (first || last) {
    return [first, last].filter(Boolean).join(" ");
  }
  return "—";
}

function formatRole(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function getRoleOptions(currentUser: AuthUser): SystemRole[] {
  if (isAdministrator(currentUser)) {
    return ["employee", "admin", "administrator"];
  }

  return ["employee"];
}

export function EmployeesClient() {
  const currentUser = useCurrentUser();

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("Employee12345");
  const [systemRole, setSystemRole] = useState<SystemRole>("employee");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [panelUserId, setPanelUserId] = useState<string | null>(null);

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const roleOptions = getRoleOptions(currentUser);

  const showCompanySelector =
    isAdministrator(currentUser) && systemRole !== "administrator";

  const formGridClassName = useMemo(() => {
    return showCompanySelector
      ? "grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
      : "grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto]";
  }, [showCompanySelector]);

  const panelUser = useMemo(() => {
    if (!panelUserId) {
      return null;
    }
    return users.find((item) => item.id === panelUserId) ?? null;
  }, [panelUserId, users]);

  const filteredUsers = useMemo(() => {
    const query = employeeSearch.trim().toLowerCase();
    if (!query) {
      return users;
    }

    return users.filter((userItem) => {
      const name = formatEmployeeDisplayName(userItem).toLowerCase();
      const mail = userItem.email.toLowerCase();
      return name.includes(query) || mail.includes(query);
    });
  }, [employeeSearch, users]);

  async function loadUsers() {
    setIsLoading(true);

    try {
      const loadedUsers = await listManagedUsers();
      setUsers(loadedUsers);
    } catch {
      setErrorMessage("Could not load users.");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadCompaniesForPage() {
    try {
      const loadedCompanies = await listCompanies();
      setCompanies(loadedCompanies);

      const firstActiveCompany = loadedCompanies.find((company) => company.is_active);

      if (firstActiveCompany) {
        setCompanyId((currentValue) => currentValue || firstActiveCompany.id);
      }
    } catch {
      // Company list is only required for administrator company selection.
    }
  }

  useEffect(() => {
    loadUsers();
    loadCompaniesForPage();
  }, []);

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setErrorMessage("");
    setSuccessMessage("");
    setIsCreating(true);

    const selectedCompanyId = showCompanySelector ? companyId : undefined;

    if (showCompanySelector && !selectedCompanyId) {
      setErrorMessage("Select a company for this user.");
      setIsCreating(false);
      return;
    }

    try {
      const createdUser = await createManagedUser({
        email,
        password,
        system_role: systemRole,
        is_active: true,
        company_id: selectedCompanyId,
      });

      setSuccessMessage(`Created ${createdUser.email}`);
      setEmail("");
      setPassword("Employee12345");
      setSystemRole("employee");

      const firstActiveCompany = companies.find((company) => company.is_active);

      if (isAdministrator(currentUser) && firstActiveCompany) {
        setCompanyId(firstActiveCompany.id);
      }

      await loadUsers();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not create user.",
      );
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Sheet>
      <PageHeader
        title="Employees"
        description="Create, review, edit, activate, deactivate, and reset user accounts."
      />

      <SheetBody>
        <RoleGuard
          allowedRoles={["administrator", "admin"]}
          fallback={
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              You do not have permission to manage users.
            </div>
          }
        >
          <div className="mb-3 border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2 text-sm">
            {isAdministrator(currentUser)
              ? "You can create users for any company."
              : "You can create Employee accounts for your company only."}
          </div>

          <form
            className="mb-4 border border-[var(--color-border)] bg-[var(--color-cell)] p-3"
            onSubmit={handleCreateUser}
          >
            <div className={formGridClassName}>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                Email
                <input
                  autoComplete="email"
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  name="email"
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </label>

              <label className="block text-xs font-bold text-[var(--color-text)]">
                Temporary password
                <input
                  autoComplete="new-password"
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  name="password"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="text"
                  value={password}
                />
              </label>

              <label className="block text-xs font-bold text-[var(--color-text)]">
                Role
                <select
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  onChange={(event) => setSystemRole(event.target.value as SystemRole)}
                  value={systemRole}
                >
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>
                      {formatRole(role)}
                    </option>
                  ))}
                </select>
              </label>

              {showCompanySelector ? (
                <label className="block text-xs font-bold text-[var(--color-text)]">
                  Company
                  <select
                    className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setCompanyId(event.target.value)}
                    required
                    value={companyId}
                  >
                    {companies
                      .filter((company) => company.is_active)
                      .map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.name}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}

              <div className="flex flex-col">
                <span className="mb-1 text-xs font-bold opacity-0">Action</span>
                <Button className="h-10" disabled={isCreating} type="submit">
                  {isCreating ? "Creating..." : "Create user"}
                </Button>
              </div>
            </div>
          </form>

          <label className="mb-3 block text-xs font-bold text-[var(--color-text)]">
            Search employees
            <input
              className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm md:max-w-md"
              onChange={(event) => setEmployeeSearch(event.target.value)}
              placeholder="Filter by name or email"
              type="search"
              value={employeeSearch}
            />
          </label>

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
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7}>Loading users...</TableCell>
                </TableRow>
              ) : null}

              {!isLoading && users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>No users found.</TableCell>
                </TableRow>
              ) : null}

              {!isLoading && users.length > 0 && filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>No users match this filter.</TableCell>
                </TableRow>
              ) : null}

              {!isLoading
                ? filteredUsers.map((userItem) => {
                    const company = companies.find((item) => item.id === userItem.company_id);

                    return (
                      <TableRow key={userItem.id}>
                        <TableCell>{formatEmployeeDisplayName(userItem)}</TableCell>
                        <TableCell>{userItem.email}</TableCell>
                        <TableCell>{formatRole(userItem.system_role)}</TableCell>
                        <TableCell>{userItem.is_active ? "Active" : "Inactive"}</TableCell>
                        <TableCell>
                          {company?.name ??
                            (userItem.company_id ? "Assigned company" : "Global")}
                        </TableCell>
                        <TableCell>
                          {new Date(userItem.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Button
                            disabled={userItem.id === currentUser.id}
                            onClick={() => {
                              setPanelUserId(userItem.id);
                              setErrorMessage("");
                              setSuccessMessage("");
                            }}
                            type="button"
                          >
                            Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                : null}
            </TableBody>
          </Table>

          {panelUser ? (
            <EmployeeDetailPanel
              companies={companies}
              currentUser={currentUser}
              onClose={() => setPanelUserId(null)}
              onRefresh={loadUsers}
              user={panelUser}
            />
          ) : null}
        </RoleGuard>
      </SheetBody>
    </Sheet>
  );
}
