"use client";

import { useSearchParams } from "next/navigation";
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
  inviteUserByEmail,
  isAdministrator,
  listManagedUsers,
  RoleGuard,
  useCurrentUser,
  type AuthUser,
  type SystemRole,
} from "../../features/auth";
import { CompanySelector } from "../../features/companies/company-selector";
import { listCompanies, type Company } from "../../features/companies/api";
import { useAdministratorCompanyScope } from "../../features/companies/selected-company";

import { employeeRoleLabel, genericStatusLabel } from "../../lib/i18n/display-labels";
import { useT } from "../../lib/i18n";
import { EmployeeDetailPanel } from "./employee-detail-panel";

function formatEmployeeDisplayName(user: AuthUser): string {
  const first = user.profile_first_name?.trim();
  const last = user.profile_last_name?.trim();
  if (first || last) {
    return [first, last].filter(Boolean).join(" ");
  }
  return "—";
}


function getRoleOptions(currentUser: AuthUser): SystemRole[] {
  if (isAdministrator(currentUser)) {
    return ["employee", "admin", "administrator"];
  }

  return ["employee"];
}

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

  const formGridClassName = useMemo(() => {
    return showCompanySelector
      ? "grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
      : "grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto]";
  }, [showCompanySelector]);

  const panelUser = useMemo(() => {
    if (!panelUserId) {
      return null;
    }
    return users.find((item) => item.id === panelUserId) ?? null;
  }, [panelUserId, users]);

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
      setInviteError(error instanceof Error ? error.message : t("employees.invite_error", "Could not send invite."));
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

      <SheetBody className="min-w-0">
        <RoleGuard
          allowedRoles={["administrator", "admin"]}
          fallback={
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              {t("employees.permission_denied", "You do not have permission to manage users.")}
            </div>
          }
        >
          {adminView && companyScope.companies.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
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
            <div className="mb-3 border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2 text-sm">
              {t("employees.scope_company", "You can create Employee accounts for your company only.")}
            </div>
          )}

          {adminView && companyScope.needsCompanySelection ? (
            <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
              Select a company to view its people.
            </div>
          ) : null}

          <form
            className="mb-4 w-full max-w-[min(48rem,calc(100vw-2rem))] border border-[var(--color-border)] bg-[var(--color-cell)] p-3"
            onSubmit={handleCreateUser}
          >
            <div className={formGridClassName}>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                {t("employees.email", "Email")}
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
                {t("employees.temp_password", "Temporary password")}
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
                {t("employees.role", "Role")}
                <select
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
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
                <label className="block text-xs font-bold text-[var(--color-text)]">
                  {t("employees.company", "Company")}
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
                  {isCreating
                    ? t("employees.creating", "Creating…")
                    : t("employees.create_user", "Create user")}
                </Button>
              </div>
            </div>
          </form>

          <form
            className="mb-4 w-full max-w-[min(48rem,calc(100vw-2rem))] border border-[var(--color-border)] bg-[var(--color-cell)] p-3"
            onSubmit={handleInviteUser}
          >
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
              {t("employees.invite_section", "Invite by email")}
            </p>
            <p className="mb-3 text-sm text-[var(--color-text-muted)]">
              {t(
                "employees.invite_help",
                "Sends an invitation link. The person sets their own password to activate the account. In local development without SMTP, an invite link is shown below after you submit.",
              )}
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="block text-xs font-bold text-[var(--color-text)]">
                {t("employees.email", "Email")}
                <input
                  autoComplete="email"
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  name="invite_email"
                  onChange={(event) => setInviteEmail(event.target.value)}
                  required
                  type="email"
                  value={inviteEmail}
                />
              </label>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                {t("employees.first_name_optional", "First name (optional)")}
                <input
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  name="invite_fn"
                  onChange={(event) => setInviteFirstName(event.target.value)}
                  type="text"
                  value={inviteFirstName}
                />
              </label>
              <label className="block text-xs font-bold text-[var(--color-text)]">
                {t("employees.last_name_optional", "Last name (optional)")}
                <input
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  name="invite_ln"
                  onChange={(event) => setInviteLastName(event.target.value)}
                  type="text"
                  value={inviteLastName}
                />
              </label>
              <label className="block text-xs font-bold text-[var(--color-text)] md:col-span-2">
                {t("employees.invite_message_long", "Personal message (optional, included in invite email)")}
                <input
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  name="invite_pm"
                  onChange={(event) => setInvitePersonalMessage(event.target.value)}
                  type="text"
                  value={invitePersonalMessage}
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              {t("employees.invite_same_selection", "Uses the same role and company selection as \"Create user\" above.")}
            </p>
            <div className="mt-3">
              <Button disabled={isInviting} type="submit">
                {isInviting
                  ? t("employees.sending_invite", "Sending invite…")
                  : t("employees.send_invitation", "Send invitation")}
              </Button>
            </div>
            {inviteError ? (
              <div className="mt-3 border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
                {inviteError}
              </div>
            ) : null}
            {inviteSuccess ? (
              <div className="mt-3 border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-sm">
                {inviteSuccess}
              </div>
            ) : null}
            {inviteDevLink ? (
              <div className="mt-3 border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2 text-xs">
                <p className="font-bold text-[var(--color-text)]">
                  {t("employees.dev_invite_link", "Development invite link")}
                </p>
                <p className="mt-1 break-all text-[var(--color-text-muted)]">{inviteDevLink}</p>
              </div>
            ) : null}
          </form>

          <label className="mb-3 block text-xs font-bold text-[var(--color-text)]">
            {t("employees.search", "Search employees")}
            <input
              className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm md:max-w-md"
              onChange={(event) => setEmployeeSearch(event.target.value)}
              placeholder={t("employees.search_filter_placeholder", "Filter by name or email")}
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

          <div className="min-w-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("employees.col_name", "Name")}</TableHead>
                <TableHead className="w-[min(11rem,28vw)] max-w-[11rem]">
                  {t("employees.col_email", "Email")}
                </TableHead>
                <TableHead className="w-[min(9rem,24vw)]">{t("employees.col_job_title", "Job title")}</TableHead>
                <TableHead>{t("employees.col_role", "Role")}</TableHead>
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

                    return (
                      <TableRow key={userItem.id}>
                        <TableCell>{formatEmployeeDisplayName(userItem)}</TableCell>
                        <TableCell className="max-w-[11rem] break-all text-[13px] leading-snug">
                          {userItem.email}
                        </TableCell>
                        <TableCell className="max-w-[10rem] truncate text-sm text-[var(--color-text)]">
                          {(userItem.profile_job_title ?? "").trim() || "—"}
                        </TableCell>
                        <TableCell>{employeeRoleLabel(t, userItem.system_role)}</TableCell>
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
        </RoleGuard>
      </SheetBody>
    </Sheet>
  );
}
