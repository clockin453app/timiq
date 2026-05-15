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
  isAdministrator,
  listManagedUsers,
  RoleGuard,
  type AuthUser,
  useCurrentUser,
} from "../../features/auth";
import { CompanySelector } from "../../features/companies/company-selector";
import { listCompanies, type Company } from "../../features/companies/api";
import { useAdministratorCompanyScope } from "../../features/companies/selected-company";
import { listLocations, type Location } from "../../features/locations/api";
import {
  createSiteAccessRecord,
  deleteSiteAccessRecord,
  listSiteAccessRecords,
  type SiteAccessRecord,
} from "../../features/site-access/api";
import { employeeRoleLabel, useT } from "../../lib/i18n";

function userLabel(user: AuthUser | undefined, t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string) {
  if (!user) {
    return t("site_access.unknown_user");
  }

  return `${user.email} (${employeeRoleLabel(t, user.system_role)})`;
}

export function SiteAccessClient() {
  const t = useT();
  const currentUser = useCurrentUser();

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [records, setRecords] = useState<SiteAccessRecord[]>([]);
  const [userId, setUserId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const showCompanySelector = isAdministrator(currentUser);
  const companyScope = useAdministratorCompanyScope(currentUser, companies);

  const selectedCompanyId = showCompanySelector
    ? companyScope.companyId ?? ""
    : currentUser.company_id ?? "";

  const assignableUsers = useMemo(() => {
    return users.filter(
      (user) =>
        user.is_active &&
        user.system_role !== "administrator" &&
        user.company_id === selectedCompanyId,
    );
  }, [users, selectedCompanyId]);

  const assignableLocations = useMemo(() => {
    return locations.filter(
      (location) =>
        location.is_active && location.company_id === selectedCompanyId,
    );
  }, [locations, selectedCompanyId]);

  const visibleRecords = records;

  async function loadScopedCompanyData(companyId: string) {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const [loadedUsers, loadedLocations, loadedRecords] = await Promise.all([
        listManagedUsers(companyId),
        listLocations(companyId),
        listSiteAccessRecords(companyId),
      ]);
      setUsers(loadedUsers);
      setLocations(loadedLocations);
      setRecords(loadedRecords);
    } catch {
      setErrorMessage(t("site_access.load_error"));
      setUsers([]);
      setLocations([]);
      setRecords([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!showCompanySelector) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const loaded = await listCompanies();
        if (!cancelled) {
          setCompanies(loaded.filter((c) => c.is_active));
        }
      } catch {
        if (!cancelled) {
          setCompanies([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showCompanySelector]);

  useEffect(() => {
    if (!selectedCompanyId) {
      setUsers([]);
      setLocations([]);
      setRecords([]);
      setUserId("");
      setLocationId("");
      if (showCompanySelector) {
        setIsLoading(false);
      }
      return;
    }
    void loadScopedCompanyData(selectedCompanyId);
  }, [selectedCompanyId, showCompanySelector]);

  useEffect(() => {
    const firstUser = assignableUsers[0];
    const firstLocation = assignableLocations[0];

    setUserId(firstUser?.id ?? "");
    setLocationId(firstLocation?.id ?? "");
  }, [selectedCompanyId, assignableUsers, assignableLocations]);

  async function handleCreateSiteAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setErrorMessage("");
    setSuccessMessage("");
    setIsCreating(true);

    if (!selectedCompanyId) {
      setErrorMessage(t("site_access.select_company"));
      setIsCreating(false);
      return;
    }

    if (!userId) {
      setErrorMessage(t("site_access.empty_users"));
      setIsCreating(false);
      return;
    }

    if (!locationId) {
      setErrorMessage(t("site_access.empty_locations"));
      setIsCreating(false);
      return;
    }

    try {
      await createSiteAccessRecord({
        user_id: userId,
        location_id: locationId,
      });

      setSuccessMessage(t("site_access.success"));
      await loadScopedCompanyData(selectedCompanyId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t("site_access.assign_failed"),
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRemoveSiteAccess(record: SiteAccessRecord) {
    setErrorMessage("");
    setSuccessMessage("");
    setDeletingKey(record.id);

    try {
      await deleteSiteAccessRecord({
        user_id: record.user_id,
        location_id: record.location_id,
      });

      setSuccessMessage(t("site_access.removed"));
      await loadScopedCompanyData(selectedCompanyId);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : t("site_access.remove_failed"),
      );
    } finally {
      setDeletingKey(null);
    }
  }

  return (
    <Sheet>
      <PageHeader title={t("site_access.page_title")} description={t("site_access.page_description")} />

      <SheetBody>
        <RoleGuard
          allowedRoles={["administrator", "admin"]}
          fallback={
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              {t("site_access.permission_denied")}
            </div>
          }
        >
          <div className="mb-3 border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2 text-sm">
            {showCompanySelector ? t("site_access.select_company_hint") : t("site_access.scope_hint")}
          </div>

          {showCompanySelector ? (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <CompanySelector
                companies={companyScope.companies}
                label={t("common.company")}
                onChange={companyScope.setCompanyId}
                value={companyScope.companyId}
              />
              {companyScope.scopeLabel ? (
                <p className="text-xs text-[var(--color-text-muted)]">{companyScope.scopeLabel}</p>
              ) : null}
            </div>
          ) : null}

          {showCompanySelector && companyScope.needsCompanySelection ? (
            <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
              Select a company to continue. Choose the company whose site access you want to manage.
            </div>
          ) : null}

          {(!showCompanySelector || !companyScope.needsCompanySelection) ? (
          <form
            className="mb-4 w-full max-w-[min(48rem,calc(100vw-2rem))] border border-[var(--color-border)] bg-[var(--color-cell)] p-3"
            onSubmit={handleCreateSiteAccess}
          >
            <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_auto]">
              <label className="block text-xs font-bold text-[var(--color-text)]">
                {t("site_access.select_user")}
                <select
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  disabled={assignableUsers.length === 0}
                  onChange={(event) => setUserId(event.target.value)}
                  required
                  value={userId}
                >
                  {assignableUsers.length === 0 ? (
                    <option value="">{t("site_access.no_users_option")}</option>
                  ) : null}

                  {assignableUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.email} — {employeeRoleLabel(t, user.system_role)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-bold text-[var(--color-text)]">
                {t("site_access.select_location")}
                <select
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  disabled={assignableLocations.length === 0}
                  onChange={(event) => setLocationId(event.target.value)}
                  required
                  value={locationId}
                >
                  {assignableLocations.length === 0 ? (
                    <option value="">{t("site_access.no_locations_option")}</option>
                  ) : null}

                  {assignableLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-col">
                <span className="mb-1 text-xs font-bold opacity-0">{t("site_access.action_column")}</span>
                <Button className="h-10" disabled={isCreating} type="submit">
                  {isCreating ? t("site_access.assigning") : t("site_access.assign")}
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

          {(!showCompanySelector || !companyScope.needsCompanySelection) ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("site_access.col_user")}</TableHead>
                <TableHead>{t("site_access.col_location")}</TableHead>
                <TableHead>{t("site_access.col_company")}</TableHead>
                <TableHead>{t("site_access.col_assigned")}</TableHead>
                <TableHead>{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5}>{t("site_access.loading")}</TableCell>
                </TableRow>
              ) : null}

              {!isLoading && visibleRecords.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>{t("site_access.empty_table")}</TableCell>
                </TableRow>
              ) : null}

              {!isLoading
                ? visibleRecords.map((record) => {
                    const user = users.find((item) => item.id === record.user_id);
                    const location = locations.find(
                      (item) => item.id === record.location_id,
                    );
                    const company = companies.find(
                      (item) => item.id === location?.company_id,
                    );

                    return (
                      <TableRow key={record.id}>
                        <TableCell>{userLabel(user, t)}</TableCell>
                        <TableCell>
                          {location?.name ?? t("site_access.unknown_location")}
                        </TableCell>
                        <TableCell>
                          {company?.name ?? t("site_access.assigned_company_fallback")}
                        </TableCell>
                        <TableCell>
                          {new Date(record.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Button
                            disabled={deletingKey === record.id}
                            onClick={() => handleRemoveSiteAccess(record)}
                            type="button"
                          >
                            {deletingKey === record.id ? t("site_access.removing") : t("site_access.remove")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                : null}
            </TableBody>
          </Table>
          ) : null}
        </RoleGuard>
      </SheetBody>
    </Sheet>
  );
}