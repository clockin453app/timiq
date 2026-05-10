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
  resetManagedUserPassword,
  RoleGuard,
  updateManagedUser,
  updateManagedUserStatus,
  useCurrentUser,
  type AuthUser,
  type SystemRole,
} from "../../features/auth";
import { listCompanies, type Company } from "../../features/companies/api";

type EditingUserState = {
  id: string;
  email: string;
  systemRole: SystemRole;
  companyId: string;
};

type PasswordResetState = {
  id: string;
  password: string;
};

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
  const [editingUser, setEditingUser] = useState<EditingUserState | null>(null);
  const [passwordReset, setPasswordReset] = useState<PasswordResetState | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  const roleOptions = getRoleOptions(currentUser);

  const showCompanySelector =
    isAdministrator(currentUser) && systemRole !== "administrator";

  const formGridClassName = useMemo(() => {
    return showCompanySelector
      ? "grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
      : "grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto]";
  }, [showCompanySelector]);

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

      const firstActiveCompany = loadedCompanies.find(
        (company) => company.is_active,
      );

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

  function startEditingUser(user: AuthUser) {
    setErrorMessage("");
    setSuccessMessage("");

    setEditingUser({
      id: user.id,
      email: user.email,
      systemRole: user.system_role,
      companyId: user.company_id ?? "",
    });
  }

  function cancelEditingUser() {
    setEditingUser(null);
    setErrorMessage("");
  }

  async function saveEditingUser() {
    if (!editingUser) {
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");
    setUpdatingUserId(editingUser.id);

    try {
      const updatedUser = await updateManagedUser(editingUser.id, {
        email: editingUser.email,
        system_role: editingUser.systemRole,
        company_id:
          isAdministrator(currentUser) &&
          editingUser.systemRole !== "administrator"
            ? editingUser.companyId || null
            : null,
      });

      setSuccessMessage(`Updated ${updatedUser.email}`);
      setEditingUser(null);
      await loadUsers();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not update user.",
      );
    } finally {
      setUpdatingUserId(null);
    }
  }

  function startPasswordReset(user: AuthUser) {
    setErrorMessage("");
    setSuccessMessage("");

    setPasswordReset({
      id: user.id,
      password: user.system_role === "admin" ? "Admin12345" : "Employee12345",
    });
  }

  function cancelPasswordReset() {
    setPasswordReset(null);
    setErrorMessage("");
  }

  async function savePasswordReset() {
    if (!passwordReset) {
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");
    setUpdatingUserId(passwordReset.id);

    try {
      const updatedUser = await resetManagedUserPassword(
        passwordReset.id,
        passwordReset.password,
      );

      setSuccessMessage(`Password reset for ${updatedUser.email}`);
      setPasswordReset(null);
      await loadUsers();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not reset password.",
      );
    } finally {
      setUpdatingUserId(null);
    }
  }

  async function handleToggleUserStatus(user: AuthUser) {
    setErrorMessage("");
    setSuccessMessage("");
    setUpdatingUserId(user.id);

    try {
      const updatedUser = await updateManagedUserStatus(user.id, !user.is_active);

      setSuccessMessage(
        `${updatedUser.email} is now ${
          updatedUser.is_active ? "active" : "inactive"
        }`,
      );

      await loadUsers();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not update user.",
      );
    } finally {
      setUpdatingUserId(null);
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
                  onChange={(event) =>
                    setSystemRole(event.target.value as SystemRole)
                  }
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
                  <TableCell colSpan={6}>Loading users...</TableCell>
                </TableRow>
              ) : null}

              {!isLoading && users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>No users found.</TableCell>
                </TableRow>
              ) : null}

              {!isLoading
                ? users.map((user) => {
                    const company = companies.find(
                      (item) => item.id === user.company_id,
                    );
                    const isEditing = editingUser?.id === user.id;
                    const isResettingPassword = passwordReset?.id === user.id;

                    if (isEditing && editingUser) {
                      return (
                        <TableRow key={user.id}>
                          <TableCell>
                            <input
                              className="h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                              onChange={(event) =>
                                setEditingUser({
                                  ...editingUser,
                                  email: event.target.value,
                                })
                              }
                              type="email"
                              value={editingUser.email}
                            />
                          </TableCell>

                          <TableCell>
                            <select
                              className="h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                              disabled={!isAdministrator(currentUser)}
                              onChange={(event) =>
                                setEditingUser({
                                  ...editingUser,
                                  systemRole: event.target.value as SystemRole,
                                  companyId:
                                    event.target.value === "administrator"
                                      ? ""
                                      : editingUser.companyId,
                                })
                              }
                              value={editingUser.systemRole}
                            >
                              {getRoleOptions(currentUser).map((role) => (
                                <option key={role} value={role}>
                                  {formatRole(role)}
                                </option>
                              ))}
                            </select>
                          </TableCell>

                          <TableCell>
                            {user.is_active ? "Active" : "Inactive"}
                          </TableCell>

                          <TableCell>
                            {isAdministrator(currentUser) &&
                            editingUser.systemRole !== "administrator" ? (
                              <select
                                className="h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                                onChange={(event) =>
                                  setEditingUser({
                                    ...editingUser,
                                    companyId: event.target.value,
                                  })
                                }
                                value={editingUser.companyId}
                              >
                                <option value="">Global</option>
                                {companies
                                  .filter((item) => item.is_active)
                                  .map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.name}
                                    </option>
                                  ))}
                              </select>
                            ) : (
                              company?.name ??
                              (user.company_id ? "Assigned company" : "Global")
                            )}
                          </TableCell>

                          <TableCell>
                            {new Date(user.created_at).toLocaleDateString()}
                          </TableCell>

                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                disabled={updatingUserId === user.id}
                                onClick={saveEditingUser}
                                type="button"
                              >
                                Save
                              </Button>

                              <Button
                                disabled={updatingUserId === user.id}
                                onClick={cancelEditingUser}
                                type="button"
                              >
                                Cancel
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    }

                    if (isResettingPassword && passwordReset) {
                      return (
                        <TableRow key={user.id}>
                          <TableCell>{user.email}</TableCell>
                          <TableCell>{formatRole(user.system_role)}</TableCell>
                          <TableCell>
                            {user.is_active ? "Active" : "Inactive"}
                          </TableCell>
                          <TableCell>
                            {company?.name ??
                              (user.company_id ? "Assigned company" : "Global")}
                          </TableCell>
                          <TableCell>
                            {new Date(user.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <input
                                className="h-9 w-40 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                                onChange={(event) =>
                                  setPasswordReset({
                                    ...passwordReset,
                                    password: event.target.value,
                                  })
                                }
                                type="text"
                                value={passwordReset.password}
                              />

                              <Button
                                disabled={updatingUserId === user.id}
                                onClick={savePasswordReset}
                                type="button"
                              >
                                Save password
                              </Button>

                              <Button
                                disabled={updatingUserId === user.id}
                                onClick={cancelPasswordReset}
                                type="button"
                              >
                                Cancel
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    }

                    return (
                      <TableRow key={user.id}>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>{formatRole(user.system_role)}</TableCell>
                        <TableCell>
                          {user.is_active ? "Active" : "Inactive"}
                        </TableCell>
                        <TableCell>
                          {company?.name ??
                            (user.company_id ? "Assigned company" : "Global")}
                        </TableCell>
                        <TableCell>
                          {new Date(user.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              disabled={user.id === currentUser.id}
                              onClick={() => startEditingUser(user)}
                              type="button"
                            >
                              Edit
                            </Button>

                            <Button
                              disabled={user.id === currentUser.id}
                              onClick={() => startPasswordReset(user)}
                              type="button"
                            >
                              Reset password
                            </Button>

                            <Button
                              disabled={
                                user.id === currentUser.id ||
                                updatingUserId === user.id
                              }
                              onClick={() => handleToggleUserStatus(user)}
                              type="button"
                            >
                              {updatingUserId === user.id
                                ? "Updating..."
                                : user.is_active
                                  ? "Deactivate"
                                  : "Activate"}
                            </Button>
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
  );
}