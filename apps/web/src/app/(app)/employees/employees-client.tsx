"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import {
  Button,
  FilterSearch,
  FilterToolbar,
  PageHeader,
  Sheet,
  SheetBody,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import {
  createManagedUser,
  inviteUserByEmail,
  isAdministrator,
  listManagedUsers,
  RoleGuard,
  useCurrentUser,
  type AuthUser,
  type SystemRole,
} from "@/features/auth";
import { CompanySelector } from "@/features/companies/company-selector";
import { listCompanies, type Company } from "@/features/companies/api";
import { useAdministratorCompanyScope } from "@/features/companies/selected-company";

import { EmployeePhotoButton } from "@/features/employees/employee-photo-button";
import { EmployeePhotoViewer } from "@/features/employees/employee-photo-viewer";
import {
  employeeDisplayName,
  resolvePayrollTypeDisplay,
} from "@/features/employees/employee-identity";
import { PayrollTypeBadge } from "@/features/employees/payroll-type-badge";
import { employeeRoleLabel, genericStatusLabel } from "@/lib/i18n/display-labels";
import { useT } from "@/lib/i18n";
import { EmployeeDetailPanel } from "./employee-detail-panel";

function formatEmployeeDisplayName(user: AuthUser): string {
  return employeeDisplayName(user);
}

function getRoleOptions(currentUser: AuthUser): SystemRole[] {
  if (isAdministrator(currentUser)) {
    return ["employee", "admin", "administrator"];
  }

  return ["employee"];
}

const fieldLabelClass = "block text-xs font-semibold text-[var(--color-text)]";
const fieldInputClass =
  "mt-1 h-11 w-full min-w-0 rounded border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm";

export function EmployeesClient() {
  const t = useT();
  const currentUser = useCurrentUser();
  const searchParams = useSearchParams();

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("Employee12345");
  const [systemRole, setSystemRole] = useState<SystemRole>("employee");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [panelUserId, setPanelUserId] = useState<string | null>(null);
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  const [viewerReturnFocus, setViewerReturnFocus] = useState<HTMLElement | null>(null);

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFirstName, setInviteFirstName] = useState("");
  const [inviteLastName, setInviteLastName] = useState("");
  const [invitePersonalMessage, setInvitePersonalMessage] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [inviteDevLink, setInviteDevLink] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);

  const roleOptions = getRoleOptions(currentUser);

  const adminView = isAdministrator(currentUser);
  const companyScope = useAdministratorCompanyScope(currentUser, companies);
  const showCompanySelector =
    isAdministrator(currentUser) && systemRole !== "administrator";

  const panelUser = useMemo(() => {
    if (!panelUserId) {
      return null;
    }
    return users.find((item) => item.id === panelUserId) ?? null;
  }, [panelUserId, users]);

  const viewerUser = useMemo(() => {
    if (!viewerUserId) {
      return null;
    }
    return users.find((item) => item.id === viewerUserId) ?? null;
  }, [viewerUserId, users]);

  useEffect(() => {
    const requestedUserId = (searchParams.get("employeeId") ?? "").trim();
    if (!requestedUserId) {
      return;
    }
    if (users.some((item) => item.id === requestedUserId)) {
      setPanelUserId(requestedUserId);
    }
  }, [searchParams, users]);

  const filteredUsers = useMemo(() => {
    const query = employeeSearch.trim().toLowerCase();
    if (!query) {
      return users;
    }

    return users.filter((userItem) => {
      const name = formatEmployeeDisplayName(userItem).toLowerCase();
      const mail = userItem.email.toLowerCase();
      const title = (userItem.profile_job_title ?? "").trim().toLowerCase();
      return name.includes(query) || mail.includes(query) || title.includes(query);
    });
  }, [employeeSearch, users]);

  async function loadUsers(viewCompanyId: string | null) {
    setIsLoading(true);

    try {
      if (adminView && !viewCompanyId) {
        setUsers([]);
        return;
      }
      const loadedUsers = await listManagedUsers(adminView ? viewCompanyId : undefined);
      setUsers(loadedUsers);
    } catch {
      setErrorMessage(t("employees.load_error", "Could not load employees."));
    } finally {
      setIsLoading(false);
    }
  }

  async function loadCompaniesForPage() {
    try {
      const loadedCompanies = await listCompanies();
      setCompanies(loadedCompanies);
    } catch {
      // Company list is only required for administrator company selection.
    }
  }

  useEffect(() => {
    void loadCompaniesForPage();
  }, []);

  useEffect(() => {
    const viewId = adminView ? companyScope.companyId : null;
    void loadUsers(viewId);
  }, [adminView, companyScope.companyId]);

  useEffect(() => {
    if (companyScope.companyId) {
      setCompanyId(companyScope.companyId);
    }
  }, [companyScope.companyId]);

  async function handleInviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setInviteError("");
    setInviteSuccess("");
    setInviteDevLink(null);
    setErrorMessage("");
    setSuccessMessage("");
    setIsInviting(true);

    const selectedCompanyId = showCompanySelector ? companyId : undefined;

    if (showCompanySelector && !selectedCompanyId) {
      setInviteError(t("employees.select_company_required", "Select a company for this user."));
      setIsInviting(false);
      return;
    }

    try {
      const res = await inviteUserByEmail({
        email: inviteEmail.trim(),
        system_role: systemRole,
        company_id: selectedCompanyId ?? null,
        first_name: inviteFirstName.trim() || null,
        last_name: inviteLastName.trim() || null,
        personal_message: invitePersonalMessage.trim() || null,
      });

      setInviteSuccess(
        t("employees.invited_success", "Invitation sent to {{email}}.", { email: res.user.email }),
      );
      setInviteDevLink(res.dev_invite_link ?? null);
      setInviteEmail("");
      setInviteFirstName("");
      setInviteLastName("");
      setInvitePersonalMessage("");

      await loadUsers(adminView ? companyScope.companyId : null);
    } catch (error) {
      setInviteError(
        error instanceof Error ? error.message : t("employees.invite_error", "Could not send invite."),
      );
    } finally {
      setIsInviting(false);
    }
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setErrorMessage("");
    setSuccessMessage("");
    setInviteError("");
    setInviteSuccess("");
    setInviteDevLink(null);
    setIsCreating(true);

    const selectedCompanyId = showCompanySelector ? companyId : undefined;

    if (showCompanySelector && !selectedCompanyId) {
      setErrorMessage(t("employees.select_company_required", "Select a company for this user."));
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

      setSuccessMessage(
        t("employees.created_success", "Created {{email}}", { email: createdUser.email }),
      );
      setEmail("");
      setPassword("Employee12345");
      setSystemRole("employee");

      const firstActiveCompany = companies.find((company) => company.is_active);

      if (isAdministrator(currentUser) && firstActiveCompany) {
        setCompanyId(firstActiveCompany.id);
      }

      await loadUsers(adminView ? companyScope.companyId : null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("employees.create_user_error", "Could not create user."),
      );
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Sheet>
      <PageHeader
        title={t("employees.title", "Employees")}
        description={t(
          "employees.description",
          "Create, review, edit, activate, deactivate, and reset user accounts.",
        )}
      />

      <SheetBody className="min-w-0 max-w-full space-y-4 pb-[max(1rem,calc(var(--layout-mobile-bottom-nav-height)+0.75rem))] md:pb-2">
        <RoleGuard
          allowedRoles={["administrator", "admin"]}
          fallback={
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              {t("employees.permission_denied", "You do not have permission to manage users.")}
            </div>
          }
        >
          {adminView && companyScope.companies.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CompanySelector
                companies={companyScope.companies}
                onChange={companyScope.setCompanyId}
                value={companyScope.companyId}
              />
              {companyScope.scopeLabel ? (
                <p className="text-xs text-[var(--color-text-muted)]">{companyScope.scopeLabel}</p>
              ) : null}
            </div>
          ) : (
            <div className="border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2 text-sm">
              {t("employees.scope_company", "You can create Employee accounts for your company only.")}
            </div>
          )}

          {adminView && companyScope.needsCompanySelection ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
              Select a company to view its people.
            </div>
          ) : null}

          <section
            className="w-full min-w-0 max-w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-cell)]"
            data-testid="employees-account-panels"
          >
            <div className="grid w-full min-w-0 grid-cols-1 gap-0 lg:grid-cols-2 lg:divide-x lg:divide-[var(--color-border)]">
              <form
                className="flex min-w-0 flex-col gap-3 p-3 sm:p-4"
                data-testid="employees-create-panel"
                onSubmit={handleCreateUser}
              >
                <div>
                  <h2 className="text-sm font-semibold text-[var(--color-text)]">
                    {t("employees.create_section", "Create employee account")}
                  </h2>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {t(
                      "employees.create_help",
                      "Creates an active account with a temporary password the employee can change later.",
                    )}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className={fieldLabelClass}>
                    {t("employees.email", "Email")}
                    <input
                      autoComplete="email"
                      className={fieldInputClass}
                      name="email"
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      type="email"
                      value={email}
                    />
                  </label>

                  <label className={fieldLabelClass}>
                    {t("employees.temp_password", "Temporary password")}
                    <input
                      autoComplete="new-password"
                      className={fieldInputClass}
                      name="password"
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      type="text"
                      value={password}
                    />
                  </label>

                  <label className={fieldLabelClass}>
                    {t("employees.role", "Role")}
                    <select
                      className={fieldInputClass}
                      onChange={(event) => setSystemRole(event.target.value as SystemRole)}
                      value={systemRole}
                    >
                      {roleOptions.map((role) => (
                        <option key={role} value={role}>
                          {employeeRoleLabel(t, role)}
                        </option>
                      ))}
                    </select>
                  </label>

                  {showCompanySelector ? (
                    <label className={fieldLabelClass}>
                      {t("employees.company", "Company")}
                      <select
                        className={fieldInputClass}
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
                </div>
                <div className="mt-auto flex justify-start pt-1">
                  <Button className="min-h-11" disabled={isCreating} type="submit">
                    {isCreating
                      ? t("employees.creating", "Creating…")
                      : t("employees.create_user", "Create user")}
                  </Button>
                </div>
              </form>

              <form
                className="flex min-w-0 flex-col gap-3 border-t border-[var(--color-border)] p-3 sm:p-4 lg:border-t-0"
                data-testid="employees-invite-panel"
                onSubmit={handleInviteUser}
              >
                <div>
                  <h2 className="text-sm font-semibold text-[var(--color-text)]">
                    {t("employees.invite_section", "Invite employee by email")}
                  </h2>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {t(
                      "employees.invite_help",
                      "Sends an invitation link. The person sets their own password to activate the account. In local development without SMTP, an invite link is shown below after you submit.",
                    )}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className={fieldLabelClass}>
                    {t("employees.email", "Email")}
                    <input
                      autoComplete="email"
                      className={fieldInputClass}
                      name="invite_email"
                      onChange={(event) => setInviteEmail(event.target.value)}
                      required
                      type="email"
                      value={inviteEmail}
                    />
                  </label>
                  <label className={fieldLabelClass}>
                    {t("employees.first_name_optional", "First name (optional)")}
                    <input
                      className={fieldInputClass}
                      name="invite_fn"
                      onChange={(event) => setInviteFirstName(event.target.value)}
                      type="text"
                      value={inviteFirstName}
                    />
                  </label>
                  <label className={fieldLabelClass}>
                    {t("employees.last_name_optional", "Last name (optional)")}
                    <input
                      className={fieldInputClass}
                      name="invite_ln"
                      onChange={(event) => setInviteLastName(event.target.value)}
                      type="text"
                      value={inviteLastName}
                    />
                  </label>
                  <label className={`${fieldLabelClass} sm:col-span-2`}>
                    {t("employees.invite_message_long", "Personal message (optional, included in invite email)")}
                    <input
                      className={fieldInputClass}
                      name="invite_pm"
                      onChange={(event) => setInvitePersonalMessage(event.target.value)}
                      type="text"
                      value={invitePersonalMessage}
                    />
                  </label>
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {t(
                    "employees.invite_same_selection",
                    'Uses the same role and company selection as "Create user" above.',
                  )}
                </p>
                <div className="mt-auto flex justify-start pt-1">
                  <Button className="min-h-11" disabled={isInviting} type="submit">
                    {isInviting
                      ? t("employees.sending_invite", "Sending invite…")
                      : t("employees.send_invitation", "Send invitation")}
                  </Button>
                </div>
                {inviteError ? (
                  <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
                    {inviteError}
                  </div>
                ) : null}
                {inviteSuccess ? (
                  <div className="border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm">
                    {inviteSuccess}
                  </div>
                ) : null}
                {inviteDevLink ? (
                  <div className="border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-xs">
                    <p className="font-bold text-[var(--color-text)]">
                      {t("employees.dev_invite_link", "Development invite link")}
                    </p>
                    <p className="mt-1 break-all text-[var(--color-text-muted)]">{inviteDevLink}</p>
                  </div>
                ) : null}
              </form>
            </div>
          </section>

          {errorMessage ? (
            <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
              {errorMessage}
            </div>
          ) : null}

          {successMessage ? (
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm">
              {successMessage}
            </div>
          ) : null}

          <FilterToolbar aria-label={t("employees.search", "Search employees")}>
            <FilterSearch
              label={t("employees.search", "Search employees")}
              onChange={setEmployeeSearch}
              placeholder={t(
                "employees.search_name_email_placeholder",
                "Search employees by name or email",
              )}
              value={employeeSearch}
            />
          </FilterToolbar>

          <div className="w-full min-w-0 max-w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("employees.col_employee", "Employee")}</TableHead>
                  <TableHead className="w-[min(9rem,24vw)]">{t("employees.col_job_title", "Job title")}</TableHead>
                  <TableHead>{t("employees.col_role", "Role")}</TableHead>
                  <TableHead>{t("employees.col_payroll_type", "Payroll type")}</TableHead>
                  <TableHead>{t("employees.col_status", "Status")}</TableHead>
                  <TableHead>{t("employees.col_company", "Company")}</TableHead>
                  <TableHead>{t("employees.col_created", "Created")}</TableHead>
                  <TableHead>{t("employees.col_actions", "Actions")}</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8}>{t("employees.loading_users", "Loading users…")}</TableCell>
                  </TableRow>
                ) : null}

                {!isLoading && users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8}>{t("employees.no_users", "No users found.")}</TableCell>
                  </TableRow>
                ) : null}

                {!isLoading && users.length > 0 && filteredUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8}>{t("employees.no_filter_match", "No users match this filter.")}</TableCell>
                  </TableRow>
                ) : null}

                {!isLoading
                  ? filteredUsers.map((userItem) => {
                      const company = companies.find((item) => item.id === userItem.company_id);
                      const displayName = formatEmployeeDisplayName(userItem);
                      const payrollKind = resolvePayrollTypeDisplay(userItem.payroll_type);

                      return (
                        <TableRow key={userItem.id}>
                          <TableCell>
                            <div className="flex min-w-0 items-center gap-3 py-0.5">
                              <EmployeePhotoButton
                                sizeClassName="h-11 w-11"
                                user={userItem}
                                onOpen={() => {
                                  setViewerUserId(userItem.id);
                                  setViewerReturnFocus(document.activeElement as HTMLElement | null);
                                }}
                              />
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-[var(--color-text)]">
                                  {displayName}
                                </div>
                                <div className="truncate text-xs text-[var(--color-text-muted)]">
                                  {userItem.email}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[10rem] truncate text-sm text-[var(--color-text)]">
                            {(userItem.profile_job_title ?? "").trim() || "—"}
                          </TableCell>
                          <TableCell>{employeeRoleLabel(t, userItem.system_role)}</TableCell>
                          <TableCell>
                            <PayrollTypeBadge kind={payrollKind} />
                          </TableCell>
                          <TableCell>
                            {userItem.is_active
                              ? genericStatusLabel(t, "active")
                              : genericStatusLabel(t, "inactive")}
                          </TableCell>
                          <TableCell>
                            {company?.name ??
                              (userItem.company_id
                                ? t("employees.assigned_company", "Assigned company")
                                : t("employees.global_scope", "Global"))}
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
                              {t("employees.edit", "Edit")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  : null}
              </TableBody>
            </Table>
          </div>

          {panelUser ? (
            <EmployeeDetailPanel
              companies={companies}
              currentUser={currentUser}
              onClose={() => setPanelUserId(null)}
              onRefresh={() => loadUsers(adminView ? companyScope.companyId : null)}
              user={panelUser}
            />
          ) : null}

          <EmployeePhotoViewer
            open={Boolean(viewerUser)}
            user={viewerUser}
            onClose={() => {
              setViewerUserId(null);
              window.setTimeout(() => viewerReturnFocus?.focus(), 0);
              setViewerReturnFocus(null);
            }}
          />
        </RoleGuard>
      </SheetBody>
    </Sheet>
  );
}
