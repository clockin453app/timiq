"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  Badge,
  Button,
  Input,
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
import { isAdministrator, RoleGuard, useCurrentUser } from "../../features/auth";
import { CompanySelector } from "../../features/companies/company-selector";
import { listCompanies, type Company } from "../../features/companies/api";
import { useAdministratorCompanyScope } from "../../features/companies/selected-company";
import {
  fetchLiveAttendance,
  postManualClockIn,
  postManualClockOut,
  type LiveAttendanceEmployeeRow,
  type LiveAttendanceResponse,
} from "../../features/live-attendance/api";
import { listLocations, type Location } from "../../features/locations/api";
import { listSiteAccessRecords, type SiteAccessRecord } from "../../features/site-access/api";
import { FaceCheckBadge } from "../../features/face-check/face-check-badge";
import { formatDurationSeconds } from "../../features/time-records/format-duration";
import { useT } from "../../lib/i18n";

function isFormLikeFocused(): boolean {
  const el = document.activeElement;
  if (!el || !(el instanceof HTMLElement)) {
    return false;
  }
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  return el.isContentEditable;
}

function statusBadge(status: string) {
  if (status === "open_shift") {
    return <Badge tone="success">Present (open)</Badge>;
  }
  if (status === "completed_today") {
    return <Badge tone="warning">Completed today</Badge>;
  }
  return <Badge tone="default">Absent</Badge>;
}

function formatTime(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "—";
  }
  return d.toLocaleString();
}

function formatTimeShort(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "—";
  }
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function outOrDurationLabel(row: LiveAttendanceEmployeeRow): string {
  if (row.status === "open_shift") {
    return durationLabelForRow(row);
  }
  if (row.clock_out_at) {
    return formatTimeShort(row.clock_out_at);
  }
  return durationLabelForRow(row);
}

function durationLabelForRow(row: LiveAttendanceEmployeeRow): string {
  if (row.status === "open_shift" && row.clock_in_at) {
    const start = new Date(row.clock_in_at).getTime();
    if (!Number.isNaN(start)) {
      return formatDurationSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    }
  }
  if (row.status === "completed_today" && row.today_completed_worked_seconds != null) {
    return formatDurationSeconds(row.today_completed_worked_seconds);
  }
  return "—";
}

export function LiveAttendanceClient() {
  const t = useT();
  const currentUser = useCurrentUser();
  const adminAllCompanies = isAdministrator(currentUser);

  const [snapshot, setSnapshot] = useState<LiveAttendanceResponse | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const companyScope = useAdministratorCompanyScope(currentUser, companies);
  const [locations, setLocations] = useState<Location[]>([]);
  const [siteAccess, setSiteAccess] = useState<SiteAccessRecord[]>([]);

  const [locationFilter, setLocationFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");

  const [loadError, setLoadError] = useState("");
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [tick, setTick] = useState(0);

  const [modalInUser, setModalInUser] = useState<LiveAttendanceEmployeeRow | null>(null);
  const [modalOutUser, setModalOutUser] = useState<LiveAttendanceEmployeeRow | null>(null);
  const [reasonIn, setReasonIn] = useState("");
  const [reasonOut, setReasonOut] = useState("");
  const [locationPick, setLocationPick] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearchDebounced(searchInput.trim());
    }, 400);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const loadCommonData = useCallback(async () => {
    const locationCompanyId = adminAllCompanies ? companyScope.companyId : currentUser?.company_id ?? null;
    try {
      const [locData, accessData] = await Promise.all([
        listLocations(locationCompanyId),
        listSiteAccessRecords(),
      ]);
      setLocations(locData);
      setSiteAccess(accessData);
    } catch {
      setLocations([]);
      setSiteAccess([]);
    }

    if (adminAllCompanies) {
      try {
        const co = await listCompanies();
        setCompanies(co.filter((c) => c.is_active));
      } catch {
        setCompanies([]);
      }
    }
  }, [adminAllCompanies, companyScope.companyId, currentUser?.company_id]);

  useEffect(() => {
    void loadCommonData();
  }, [loadCommonData]);

  useEffect(() => {
    if (adminAllCompanies) {
      setLocationFilter("");
    }
  }, [adminAllCompanies, companyScope.companyId]);

  const loadSnapshot = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = Boolean(opts?.silent);
      if (adminAllCompanies && !companyScope.companyId) {
        setSnapshot(null);
        setLoadError("");
        setIsInitialLoad(false);
        setIsRefreshing(false);
        return;
      }
      if (!silent) {
        setIsInitialLoad(true);
      } else {
        setIsRefreshing(true);
      }
      setLoadError("");
      try {
        const data = await fetchLiveAttendance({
          companyId: adminAllCompanies ? companyScope.companyId ?? undefined : undefined,
          locationId: locationFilter || undefined,
          search: searchDebounced || undefined,
        });
        setSnapshot(data);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Could not load live attendance.");
        if (!silent) {
          setSnapshot(null);
        }
      } finally {
        setIsInitialLoad(false);
        setIsRefreshing(false);
      }
    },
    [adminAllCompanies, companyScope.companyId, locationFilter, searchDebounced],
  );

  useEffect(() => {
    void loadSnapshot({ silent: false });
  }, [loadSnapshot]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden) {
        return;
      }
      if (modalInUser || modalOutUser) {
        return;
      }
      if (isFormLikeFocused()) {
        return;
      }
      if (actionBusy || isRefreshing || isInitialLoad) {
        return;
      }
      void loadSnapshot({ silent: true });
    }, 13000);
    return () => window.clearInterval(id);
  }, [loadSnapshot, modalInUser, modalOutUser, actionBusy, isRefreshing, isInitialLoad]);

  const filteredLocationOptions = useMemo(() => {
    return locations.filter((loc) => loc.is_active);
  }, [locations]);

  const locationFilterOptions = useMemo(() => {
    if (adminAllCompanies && companyScope.companyId) {
      return filteredLocationOptions.filter((loc) => loc.company_id === companyScope.companyId);
    }
    if (!adminAllCompanies && currentUser?.company_id) {
      return filteredLocationOptions.filter((loc) => loc.company_id === currentUser.company_id);
    }
    return filteredLocationOptions;
  }, [adminAllCompanies, companyScope.companyId, currentUser?.company_id, filteredLocationOptions]);

  const assignableLocationsForUser = useMemo(() => {
    if (!modalInUser?.company_id) {
      return [];
    }
    const assigned = new Set(
      siteAccess.filter((r) => r.user_id === modalInUser.user_id).map((r) => r.location_id),
    );
    return filteredLocationOptions.filter(
      (loc) => loc.company_id === modalInUser.company_id && assigned.has(loc.id),
    );
  }, [modalInUser, siteAccess, filteredLocationOptions]);

  void tick;

  function openClockIn(row: LiveAttendanceEmployeeRow) {
    setActionError("");
    setReasonIn("");
    setLocationPick("");
    setModalInUser(row);
  }

  function openClockOut(row: LiveAttendanceEmployeeRow) {
    setActionError("");
    setReasonOut("");
    setModalOutUser(row);
  }

  async function handleManualClockIn(event: FormEvent) {
    event.preventDefault();
    if (!modalInUser || !locationPick.trim()) {
      setActionError("Choose a location.");
      return;
    }
    const reason = reasonIn.trim();
    if (!reason) {
      setActionError("Reason is required.");
      return;
    }
    setActionBusy(true);
    setActionError("");
    try {
      await postManualClockIn({
        user_id: modalInUser.user_id,
        location_id: locationPick,
        reason,
      });
      setModalInUser(null);
      await loadSnapshot({ silent: true });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Clock-in failed.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleManualClockOut(event: FormEvent) {
    event.preventDefault();
    if (!modalOutUser) {
      return;
    }
    const reason = reasonOut.trim();
    if (!reason) {
      setActionError("Reason is required.");
      return;
    }
    setActionBusy(true);
    setActionError("");
    try {
      await postManualClockOut({
        user_id: modalOutUser.user_id,
        reason,
      });
      setModalOutUser(null);
      await loadSnapshot({ silent: true });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Clock-out failed.");
    } finally {
      setActionBusy(false);
    }
  }

  const summary = snapshot?.summary;
  const refreshDisabled = isRefreshing || (isInitialLoad && !snapshot);

  return (
    <Sheet>
      <PageHeader
        title="Live Attendance"
        description="Snapshot of today’s roster, open shifts, and manual clock controls for administrators."
      />
      <SheetBody className="min-w-0">
        <RoleGuard
          allowedRoles={["administrator", "admin"]}
          fallback={
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              You do not have permission to view live attendance.
            </div>
          }
        >
          <div className="mb-4 flex flex-wrap items-center gap-2 border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2 text-sm">
            <Button
              type="button"
              variant="secondary"
              disabled={refreshDisabled}
              onClick={() => void loadSnapshot({ silent: Boolean(snapshot) })}
            >
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </Button>
            {isRefreshing ? <span className="text-xs text-[var(--color-text-muted)]">Updating…</span> : null}
            {snapshot ? (
              <span className="text-xs text-[var(--color-text-muted)]">
                Updated {new Date(snapshot.generated_at).toLocaleTimeString()}
              </span>
            ) : null}
          </div>

          <p className="mb-3 text-sm text-[var(--color-text)] md:hidden">
            <span className="font-semibold tabular-nums">{snapshot?.employees.length ?? 0}</span> employees
            {summary ? (
              <>
                {" "}
                · <span className="tabular-nums">{summary.present_today ?? 0}</span> present ·{" "}
                <span className="tabular-nums">{summary.open_shifts ?? 0}</span> open
              </>
            ) : null}
          </p>

          <div className="mb-4 hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-4">
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3">
              <div className="text-xs font-bold text-[var(--color-text-muted)]">Present today</div>
              <div className="text-2xl font-semibold tabular-nums">{summary?.present_today ?? "—"}</div>
            </div>
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3">
              <div className="text-xs font-bold text-[var(--color-text-muted)]">Open shifts</div>
              <div className="text-2xl font-semibold tabular-nums">{summary?.open_shifts ?? "—"}</div>
            </div>
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3">
              <div className="text-xs font-bold text-[var(--color-text-muted)]">Absent</div>
              <div className="text-2xl font-semibold tabular-nums">{summary?.absent_count ?? "—"}</div>
            </div>
            <div className="border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3">
              <div className="text-xs font-bold text-[var(--color-text-muted)]">Attendance rate</div>
              <div className="text-2xl font-semibold tabular-nums">
                {summary && summary.attendance_rate !== null && summary.attendance_rate !== undefined
                  ? `${Math.round(summary.attendance_rate * 100)}%`
                  : "—"}
              </div>
            </div>
          </div>

          {summary && summary.late_arrivals !== null && summary.late_arrivals !== undefined ? (
            <div className="mb-3 border border-[var(--color-border)] bg-[var(--color-header)] px-3 py-2 text-sm">
              Late arrivals (per company start time):{" "}
              <span className="font-semibold tabular-nums">{summary.late_arrivals}</span>
            </div>
          ) : null}

          <div className="mb-3 min-w-0 border border-[var(--color-border)] bg-[var(--color-cell)] p-2 sm:mb-4 sm:p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-3">
              <label className="block text-[11px] font-bold text-[var(--color-text)] sm:text-xs">
                Search
                <Input
                  className="mt-0.5 h-9 text-sm sm:mt-1 sm:h-10"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Name or email"
                  autoComplete="off"
                />
              </label>

              <label className="block text-xs font-bold text-[var(--color-text)]">
                Location filter
                <select
                  className="mt-0.5 h-9 w-full border border-[var(--color-border-dark)] text-sm sm:mt-1 sm:h-10 bg-[var(--color-input)] px-2 text-sm"
                  value={locationFilter}
                  onChange={(event) => setLocationFilter(event.target.value)}
                >
                  <option value="">All locations</option>
                  {locationFilterOptions.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </label>

              {adminAllCompanies && companyScope.companies.length > 0 ? (
                <label className="block text-xs font-bold text-[var(--color-text)]">
                  Company
                  <select
                    className="mt-0.5 h-9 w-full border border-[var(--color-border-dark)] text-sm sm:mt-1 sm:h-10 bg-[var(--color-input)] px-2 text-sm"
                    value={companyScope.companyId ?? ""}
                    onChange={(event) => {
                      companyScope.setCompanyId(event.target.value);
                      setLocationFilter("");
                    }}
                  >
                    <option value="">Select a company…</option>
                    {companyScope.companies.map((co) => (
                      <option key={co.id} value={co.id}>
                        {co.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div />
              )}
            </div>
          </div>

          {companyScope.scopeLabel ? (
            <p className="mb-3 text-xs text-[var(--color-text-muted)]">{companyScope.scopeLabel}</p>
          ) : null}

          {adminAllCompanies && companyScope.needsCompanySelection && !isInitialLoad ? (
            <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
              Select a company to view live attendance.
            </div>
          ) : null}

          {loadError ? (
            <div className="mb-3 border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
              {loadError}
            </div>
          ) : null}

          <div className="min-w-0 max-w-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Job title</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Site / location</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Clock in</TableHead>
                  <TableHead>Clock out</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="hidden xl:table-cell">
                    {t("face_check.table_header", "Face check")}
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isInitialLoad && !snapshot ? (
                  <TableRow>
                    <TableCell colSpan={10}>Loading attendance…</TableCell>
                  </TableRow>
                ) : null}
                {!isInitialLoad && snapshot && snapshot.employees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10}>No employees match the current filters.</TableCell>
                  </TableRow>
                ) : null}
                {snapshot
                  ? snapshot.employees.map((row) => {
                      void tick;
                      return (
                        <TableRow key={row.user_id}>
                          <TableCell className="max-w-[8rem] text-sm font-medium sm:max-w-none">
                            <span className="line-clamp-2">{row.display_name || "Employee"}</span>
                          </TableCell>
                          <TableCell className="hidden max-w-[12rem] truncate text-sm md:table-cell">{row.email ?? "—"}</TableCell>
                          <TableCell className="hidden text-sm lg:table-cell">{row.job_title ?? "—"}</TableCell>
                          <TableCell className="hidden text-sm lg:table-cell">{row.company_name ?? "—"}</TableCell>
                          <TableCell className="hidden max-w-[8rem] truncate text-sm md:table-cell">{row.location_name ?? "—"}</TableCell>
                          <TableCell className="text-xs">{statusBadge(row.status)}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs tabular-nums sm:text-sm">{formatTimeShort(row.clock_in_at)}</TableCell>
                          <TableCell className="hidden whitespace-nowrap text-xs tabular-nums sm:table-cell sm:text-sm">{formatTimeShort(row.clock_out_at)}</TableCell>
                          <TableCell className="text-xs tabular-nums sm:text-sm">{outOrDurationLabel(row)}</TableCell>
                          <TableCell className="hidden text-xs xl:table-cell">
                            {row.status === "open_shift" && row.face_check_status ? (
                              <FaceCheckBadge status={row.face_check_status} />
                            ) : (
                              <span className="text-[var(--color-text-muted)]">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={row.status === "open_shift" || !row.company_id}
                                onClick={() => openClockIn(row)}
                              >
                                Manual clock in
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                disabled={row.status !== "open_shift"}
                                onClick={() => openClockOut(row)}
                              >
                                Manual clock out
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  : null}
              </TableBody>
            </Table>
          </div>

          {modalInUser ? (
            <div className="fixed inset-0 z-40 flex items-start justify-center overflow-x-hidden overflow-y-auto bg-black/45 p-3 md:p-6">
              <div
                role="dialog"
                aria-modal="true"
                className="mx-auto mt-8 w-full min-w-0 max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 shadow-lg sm:max-w-[min(40rem,calc(100vw-3rem))]"
              >
                <h2 className="mb-1 text-lg font-semibold">Manual clock in</h2>
                <p className="mb-3 text-sm text-[var(--color-text-muted)]">
                  {modalInUser.display_name}
                  {modalInUser.email ? ` · ${modalInUser.email}` : null}
                </p>
                <form className="space-y-3" onSubmit={handleManualClockIn}>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Location
                    <select
                      className="mt-0.5 h-9 w-full border border-[var(--color-border-dark)] text-sm sm:mt-1 sm:h-10 bg-[var(--color-input)] px-2 text-sm"
                      required
                      value={locationPick}
                      onChange={(event) => setLocationPick(event.target.value)}
                    >
                      <option value="">Select location…</option>
                      {assignableLocationsForUser.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {assignableLocationsForUser.length === 0 ? (
                    <p className="text-xs text-[var(--color-danger-700)]">
                      No site access locations for this employee. Assign locations under Site Access first.
                    </p>
                  ) : null}
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Reason (required)
                    <textarea
                      className="mt-1 min-h-[96px] w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-2 text-sm"
                      required
                      value={reasonIn}
                      onChange={(event) => setReasonIn(event.target.value)}
                    />
                  </label>
                  {actionError ? (
                    <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-2 py-2 text-xs text-[var(--color-danger-700)]">
                      {actionError}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={actionBusy}
                      onClick={() => setModalInUser(null)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={actionBusy || assignableLocationsForUser.length === 0}>
                      {actionBusy ? "Saving…" : "Confirm clock in"}
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}

          {modalOutUser ? (
            <div className="fixed inset-0 z-40 flex items-start justify-center overflow-x-hidden overflow-y-auto bg-black/45 p-3 md:p-6">
              <div
                role="dialog"
                aria-modal="true"
                className="mx-auto mt-8 w-full min-w-0 max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-4 shadow-lg sm:max-w-[min(40rem,calc(100vw-3rem))]"
              >
                <h2 className="mb-1 text-lg font-semibold">Manual clock out</h2>
                <p className="mb-3 text-sm text-[var(--color-text-muted)]">
                  {modalOutUser.display_name}
                  {modalOutUser.email ? ` · ${modalOutUser.email}` : null}
                </p>
                <form className="space-y-3" onSubmit={handleManualClockOut}>
                  <label className="block text-xs font-bold text-[var(--color-text)]">
                    Reason (required)
                    <textarea
                      className="mt-1 min-h-[96px] w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-2 text-sm"
                      required
                      value={reasonOut}
                      onChange={(event) => setReasonOut(event.target.value)}
                    />
                  </label>
                  {actionError ? (
                    <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-2 py-2 text-xs text-[var(--color-danger-700)]">
                      {actionError}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={actionBusy}
                      onClick={() => setModalOutUser(null)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={actionBusy}>
                      {actionBusy ? "Saving…" : "Confirm clock out"}
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}
        </RoleGuard>
      </SheetBody>
    </Sheet>
  );
}
