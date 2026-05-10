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
import { listCompanies, type Company } from "../../features/companies/api";
import { listLocations, type Location } from "../../features/locations/api";
import {
  createSiteAccessRecord,
  deleteSiteAccessRecord,
  listSiteAccessRecords,
  type SiteAccessRecord,
} from "../../features/site-access/api";

function userLabel(user: AuthUser | undefined) {
  if (!user) {
    return "Unknown user";
  }

  return `${user.email} (${user.system_role})`;
}

export function SiteAccessClient() {
  const currentUser = useCurrentUser();

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [records, setRecords] = useState<SiteAccessRecord[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [userId, setUserId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const showCompanySelector = isAdministrator(currentUser);

  const activeCompanies = useMemo(() => {
    return companies.filter((company) => company.is_active);
  }, [companies]);

  const selectedCompanyId = companyId || activeCompanies[0]?.id || "";

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

  const visibleRecords = useMemo(() => {
    if (!selectedCompanyId) {
      return [];
    }

    return records.filter((record) => {
      const location = locations.find((item) => item.id === record.location_id);
      return location?.company_id === selectedCompanyId;
    });
  }, [records, locations, selectedCompanyId]);

  async function loadPageData() {
    setIsLoading(true);

    try {
      const [loadedUsers, loadedCompanies, loadedLocations, loadedRecords] =
        await Promise.all([
          listManagedUsers(),
          listCompanies(),
          listLocations(),
          listSiteAccessRecords(),
        ]);

      setUsers(loadedUsers);
      setCompanies(loadedCompanies);
      setLocations(loadedLocations);
      setRecords(loadedRecords);

      const firstActiveCompany = loadedCompanies.find(
        (company) => company.is_active,
      );

      if (firstActiveCompany) {
        setCompanyId((currentValue) => currentValue || firstActiveCompany.id);
      }
    } catch {
      setErrorMessage("Could not load site access data.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadPageData();
  }, []);

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
      setErrorMessage("Select a company first.");
      setIsCreating(false);
      return;
    }

    if (!userId) {
      setErrorMessage("This company has no active employees/admins to assign.");
      setIsCreating(false);
      return;
    }

    if (!locationId) {
      setErrorMessage("This company has no active locations. Activate or create a location first.");
      setIsCreating(false);
      return;
    }

    try {
      await createSiteAccessRecord({
        user_id: userId,
        location_id: locationId,
      });

      setSuccessMessage("Location access assigned.");
      await loadPageData();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not assign location.",
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

      setSuccessMessage("Location access removed.");
      await loadPageData();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not remove location access.",
      );
    } finally {
      setDeletingKey(null);
    }
  }

  return (
    <Sheet>
      <PageHeader
        title="Site Access"
        description="Assign employees to geofenced work locations."
      />

      <SheetBody>
        <RoleGuard
          allowedRoles={["administrator", "admin"]}
          fallback={
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              You do not have permission to manage site access.
            </div>
          }
        >
          <div className="mb-3 border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2 text-sm">
            {showCompanySelector
              ? "Select a company, then assign its users to its active geofenced locations."
              : "Assign your company users to your company active geofenced locations."}
          </div>

          <form
            className="mb-4 border border-[var(--color-border)] bg-[var(--color-cell)] p-3"
            onSubmit={handleCreateSiteAccess}
          >
            <div
              className={
                showCompanySelector
                  ? "grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_auto]"
                  : "grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_auto]"
              }
            >
              {showCompanySelector ? (
                <label className="block text-xs font-bold text-[var(--color-text)]">
                  Company
                  <select
                    className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setCompanyId(event.target.value)}
                    required
                    value={selectedCompanyId}
                  >
                    {activeCompanies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className="block text-xs font-bold text-[var(--color-text)]">
                User
                <select
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  disabled={assignableUsers.length === 0}
                  onChange={(event) => setUserId(event.target.value)}
                  required
                  value={userId}
                >
                  {assignableUsers.length === 0 ? (
                    <option value="">No active users for this company</option>
                  ) : null}

                  {assignableUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.email} — {user.system_role}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-bold text-[var(--color-text)]">
                Location
                <select
                  className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                  disabled={assignableLocations.length === 0}
                  onChange={(event) => setLocationId(event.target.value)}
                  required
                  value={locationId}
                >
                  {assignableLocations.length === 0 ? (
                    <option value="">No active locations for this company</option>
                  ) : null}

                  {assignableLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-col">
                <span className="mb-1 text-xs font-bold opacity-0">Action</span>
                <Button className="h-10" disabled={isCreating} type="submit">
                  {isCreating ? "Assigning..." : "Assign location"}
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
                <TableHead>User</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5}>Loading site access...</TableCell>
                </TableRow>
              ) : null}

              {!isLoading && visibleRecords.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>No site access assigned.</TableCell>
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
                        <TableCell>{userLabel(user)}</TableCell>
                        <TableCell>
                          {location?.name ?? "Unknown location"}
                        </TableCell>
                        <TableCell>
                          {company?.name ?? "Assigned company"}
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
                            {deletingKey === record.id ? "Removing..." : "Remove"}
                          </Button>
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