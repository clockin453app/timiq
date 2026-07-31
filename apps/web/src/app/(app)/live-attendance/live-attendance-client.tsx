"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Badge,
  Button,
  FormActions,
  FormField,
  Input,
  Modal,
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
import { UserAvatar } from "@/components/user-avatar";
import { isAdministrator, RoleGuard, useCurrentUser } from "@/features/auth";
import { listCompanies, type Company } from "@/features/companies/api";
import { useAdministratorCompanyScope } from "@/features/companies/selected-company";
import {
  fetchLiveAttendance,
  postManualClockIn,
  postManualClockOut,
  type LiveAttendanceEmployeeRow,
  type LiveAttendanceResponse,
} from "@/features/live-attendance/api";
import { listLocations, type Location } from "@/features/locations/api";
import { listSiteAccessRecords, type SiteAccessRecord } from "@/features/site-access/api";
import { FaceCheckBadge } from "@/features/face-check/face-check-badge";
import { formatDurationSeconds } from "@/features/time-records/format-duration";
import { browserDefaultTimeZone } from "@/features/timesheets/week-utils";
import {
  fromDatetimeLocalToIso,
  isValidDatetimeLocalValue,
  nowDatetimeLocalValue,
} from "@/lib/datetime-local";
import { useT } from "@/lib/i18n";
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
  const [clockInAtLocal, setClockInAtLocal] = useState("");
  const [clockOutAtLocal, setClockOutAtLocal] = useState("");
  const [locationPick, setLocationPick] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [flashMessage, setFlashMessage] = useState("");
  const [supportError, setSupportError] = useState("");
  const localTimeZoneLabel = useMemo(() => browserDefaultTimeZone(), []);
  const clockInAtRef = useRef<HTMLInputElement | null>(null);
  const clockOutAtRef = useRef<HTMLInputElement | null>(null);
  const reasonInRef = useRef<HTMLTextAreaElement | null>(null);
  const reasonOutRef = useRef<HTMLTextAreaElement | null>(null);
  const locationPickRef = useRef<HTMLSelectElement | null>(null);
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
    if (adminAllCompanies && !locationCompanyId) {
      setLocations([]);
      setSiteAccess([]);
      setSupportError("");
      return;
    }

    const locationPromise = listLocations(locationCompanyId)
      .then((locData) => {
        setLocations(locData);
        return true;
      })
      .catch(() => {
        setLocations([]);
        return false;
      });

    // Administrators must scope site-access by company_id (same as Site Access page).
    const accessPromise = listSiteAccessRecords(locationCompanyId)
      .then((accessData) => {
        setSiteAccess(accessData);
        return true;
      })
      .catch(() => {
        setSiteAccess([]);
        return false;
      });

    const [locationsOk, accessOk] = await Promise.all([locationPromise, accessPromise]);
    if (!locationsOk) {
      setSupportError("Could not load locations for manual clock actions.");
    } else if (!accessOk) {
      setSupportError("Could not load site access for manual clock actions.");
    } else {
      setSupportError("");
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

  useEffect(() => {
    if (!flashMessage) return;
    const id = window.setTimeout(() => setFlashMessage(""), 5000);
    return () => window.clearTimeout(id);
  }, [flashMessage]);

  useEffect(() => {
    if (!modalInUser) return;
    if (locationPick) return;
    const preferred = modalInUser.location_id;
    if (preferred && assignableLocationsForUser.some((loc) => loc.id === preferred)) {
      setLocationPick(preferred);
      return;
    }
    if (assignableLocationsForUser.length === 1) {
      setLocationPick(assignableLocationsForUser[0].id);
    }
  }, [modalInUser, assignableLocationsForUser, locationPick]);

  function openClockIn(row: LiveAttendanceEmployeeRow) {
    setActionError("");
    setReasonIn("");
    setLocationPick("");
    setClockInAtLocal(nowDatetimeLocalValue());
    setModalInUser(row);
  }

  function openClockOut(row: LiveAttendanceEmployeeRow) {
    setActionError("");
    setReasonOut("");
    setClockOutAtLocal(nowDatetimeLocalValue());
    setModalOutUser(row);
  }

  async function handleManualClockIn(event: FormEvent) {
    event.preventDefault();
    if (actionBusy || !modalInUser) {
      return;
    }
    if (!locationPick.trim()) {
      setActionError("Choose a location.");
      locationPickRef.current?.focus();
      return;
    }
    const reason = reasonIn.trim();
    if (!reason) {
      setActionError("Reason is required.");
      reasonInRef.current?.focus();
      return;
    }
    if (!isValidDatetimeLocalValue(clockInAtLocal)) {
      setActionError("Enter a valid clock-in date and time.");
      clockInAtRef.current?.focus();
      return;
    }
    const effectiveAt = fromDatetimeLocalToIso(clockInAtLocal);
    if (!effectiveAt) {
      setActionError("Enter a valid clock-in date and time.");
      clockInAtRef.current?.focus();
      return;
    }
    setActionBusy(true);
    setActionError("");
    try {
      await postManualClockIn({
        user_id: modalInUser.user_id,
        location_id: locationPick,
        reason,
        effective_at: effectiveAt,
      });
      setModalInUser(null);
      setFlashMessage(`Manual clock-in saved for ${modalInUser.display_name || "employee"}.`);
      await loadSnapshot({ silent: true });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Clock-in failed.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleManualClockOut(event: FormEvent) {
    event.preventDefault();
    if (actionBusy || !modalOutUser) {
      return;
    }
    const reason = reasonOut.trim();
    if (!reason) {
      setActionError("Reason is required.");
      reasonOutRef.current?.focus();
      return;
    }
    if (!isValidDatetimeLocalValue(clockOutAtLocal)) {
      setActionError("Enter a valid clock-out date and time.");
      clockOutAtRef.current?.focus();
      return;
    }
    const effectiveAt = fromDatetimeLocalToIso(clockOutAtLocal);
    if (!effectiveAt) {
      setActionError("Enter a valid clock-out date and time.");
      clockOutAtRef.current?.focus();
      return;
    }
    if (modalOutUser.clock_in_at && new Date(effectiveAt) <= new Date(modalOutUser.clock_in_at)) {
      setActionError("Clock-out time must be after the clock-in time.");
      clockOutAtRef.current?.focus();
      return;
    }
    setActionBusy(true);
    setActionError("");
    try {
      await postManualClockOut({
        user_id: modalOutUser.user_id,
        reason,
        effective_at: effectiveAt,
      });
      setModalOutUser(null);
      setFlashMessage(`Manual clock-out saved for ${modalOutUser.display_name || "employee"}.`);
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
        action={
          <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 w-full sm:min-h-9 sm:w-auto"
              disabled={refreshDisabled}
              onClick={() => void loadSnapshot({ silent: Boolean(snapshot) })}
            >
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </Button>
            {snapshot ? (
              <span className="text-center text-xs text-[var(--color-text-muted)] sm:text-left">
                Updated {new Date(snapshot.generated_at).toLocaleTimeString()}
              </span>
            ) : null}
          </div>
        }
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
          {flashMessage ? (
            <div
              className="timiq-live-flash mb-3 flex max-w-full items-start gap-2 break-words rounded-[var(--radius-md)] border border-[var(--color-brand)]/30 bg-[var(--color-brand-tint)] px-3 py-2 text-sm text-[var(--color-brand-hover)]"
              role="status"
              aria-live="polite"
            >
              <p className="min-w-0 flex-1">{flashMessage}</p>
              <button
                aria-label="Dismiss confirmation"
                className="shrink-0 rounded px-2 py-1 text-xs font-semibold underline"
                type="button"
                onClick={() => setFlashMessage("")}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {supportError ? (
            <div
              className="mb-3 flex max-w-full items-start gap-2 break-words rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]"
              role="alert"
            >
              <p className="min-w-0 flex-1">{supportError}</p>
              <button
                aria-label="Dismiss error"
                className="shrink-0 rounded px-2 py-1 text-xs font-semibold underline"
                type="button"
                onClick={() => setSupportError("")}
              >
                Dismiss
              </button>
            </div>
          ) : null}

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

          <div className="mb-4 grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0 border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-2.5 sm:p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] sm:text-xs">
                Present today
              </div>
              <div className="text-lg font-semibold tabular-nums sm:text-2xl">{summary?.present_today ?? "—"}</div>
            </div>
            <div className="min-w-0 border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-2.5 sm:p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] sm:text-xs">
                Open shifts
              </div>
              <div className="text-lg font-semibold tabular-nums sm:text-2xl">{summary?.open_shifts ?? "—"}</div>
            </div>
            <div className="min-w-0 border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-2.5 sm:p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] sm:text-xs">
                Absent
              </div>
              <div className="text-lg font-semibold tabular-nums sm:text-2xl">{summary?.absent_count ?? "—"}</div>
            </div>
            <div className="min-w-0 border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-2.5 sm:p-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] sm:text-xs">
                Attendance rate
              </div>
              <div className="text-lg font-semibold tabular-nums sm:text-2xl">
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
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-3">
              <label className="block min-w-0 text-[11px] font-bold text-[var(--color-text)] sm:text-xs">
                Search
                <Input
                  className="mt-0.5 h-11 w-full min-w-0 text-base sm:mt-1 sm:h-10 sm:text-sm"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Name or email"
                  autoComplete="off"
                />
              </label>

              <label className="block min-w-0 text-xs font-bold text-[var(--color-text)]">
                Location filter
                <select
                  className="mt-0.5 h-11 w-full min-w-0 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-base sm:mt-1 sm:h-10 sm:text-sm"
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
                <label className="block min-w-0 text-xs font-bold text-[var(--color-text)]">
                  Company
                  <select
                    className="mt-0.5 h-11 w-full min-w-0 border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-base sm:mt-1 sm:h-10 sm:text-sm"
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
              ) : null}
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
            <div
              className="mb-3 flex max-w-full items-start gap-2 break-words border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]"
              role="alert"
            >
              <p className="min-w-0 flex-1">{loadError}</p>
              <button
                aria-label="Dismiss load error"
                className="shrink-0 rounded px-2 py-1 text-xs font-semibold underline"
                type="button"
                onClick={() => setLoadError("")}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {/* Mobile attendance cards — avoid forcing the wide table into the viewport */}
          <div className="space-y-2 md:hidden">
            {isInitialLoad && !snapshot ? (
              <p className="border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-4 text-sm text-[var(--color-text-muted)]">
                Loading attendance…
              </p>
            ) : null}
            {!isInitialLoad && snapshot && snapshot.employees.length === 0 ? (
              <p className="border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-4 text-sm text-[var(--color-text-muted)]">
                No employees match the current filters.
              </p>
            ) : null}
            {snapshot
              ? snapshot.employees.map((row) => {
                  void tick;
                  const canClockIn = row.status !== "open_shift" && Boolean(row.company_id);
                  const canClockOut = row.status === "open_shift";
                  return (
                    <article
                      key={row.user_id}
                      className="min-w-0 border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3"
                    >
                      <div className="flex min-w-0 items-start gap-2.5">
                        <UserAvatar
                          email={row.email}
                          name={row.display_name}
                          sizeClassName="h-9 w-9"
                          userId={row.user_id}
                        />
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">
                            {row.display_name || "Employee"}
                          </h3>
                          {row.email ? (
                            <p className="truncate text-xs text-[var(--color-text-muted)]">{row.email}</p>
                          ) : null}
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {statusBadge(row.status)}
                            {row.status === "open_shift" && row.face_check_status ? (
                              <FaceCheckBadge status={row.face_check_status} />
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                        <div className="min-w-0">
                          <dt className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                            Site
                          </dt>
                          <dd className="truncate text-[var(--color-text)]">{row.location_name ?? "—"}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                            Duration
                          </dt>
                          <dd className="tabular-nums text-[var(--color-text)]">{outOrDurationLabel(row)}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                            Clock in
                          </dt>
                          <dd className="tabular-nums text-[var(--color-text)]">{formatTimeShort(row.clock_in_at)}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                            Clock out
                          </dt>
                          <dd className="tabular-nums text-[var(--color-text)]">{formatTimeShort(row.clock_out_at)}</dd>
                        </div>
                      </dl>
                      <div className="mt-3 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                        <Button
                          type="button"
                          size="md"
                          variant="secondary"
                          className="min-h-11 w-full"
                          disabled={!canClockIn}
                          aria-label={`Manual clock in ${row.display_name || "employee"}`}
                          onClick={() => openClockIn(row)}
                        >
                          Manual clock in
                        </Button>
                        <Button
                          type="button"
                          size="md"
                          className="min-h-11 w-full"
                          disabled={!canClockOut}
                          aria-label={`Manual clock out ${row.display_name || "employee"}`}
                          onClick={() => openClockOut(row)}
                        >
                          Manual clock out
                        </Button>
                      </div>
                    </article>
                  );
                })
              : null}
          </div>

          <div className="hidden min-w-0 max-w-full md:block">
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
                    <TableCell colSpan={11}>Loading attendance…</TableCell>
                  </TableRow>
                ) : null}
                {!isInitialLoad && snapshot && snapshot.employees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11}>No employees match the current filters.</TableCell>
                  </TableRow>
                ) : null}
                {snapshot
                  ? snapshot.employees.map((row) => {
                      void tick;
                      return (
                        <TableRow key={row.user_id}>
                          <TableCell className="max-w-[8rem] text-sm font-medium sm:max-w-none">
                            <div className="flex min-w-0 items-center gap-2">
                              <UserAvatar
                                email={row.email}
                                name={row.display_name}
                                sizeClassName="h-8 w-8"
                                userId={row.user_id}
                              />
                              <span className="line-clamp-2 min-w-0">{row.display_name || "Employee"}</span>
                            </div>
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
            <Modal
              title="Force clock in"
              subtitle={
                modalInUser.email
                  ? `${modalInUser.display_name} · ${modalInUser.email}`
                  : modalInUser.display_name
              }
              closeEnabled={!actionBusy}
              onClose={() => {
                if (!actionBusy) setModalInUser(null);
              }}
              footer={
                <FormActions>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={actionBusy}
                    onClick={() => setModalInUser(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    form="force-clock-in-form"
                    disabled={actionBusy || assignableLocationsForUser.length === 0}
                    aria-busy={actionBusy}
                  >
                    {actionBusy ? "Saving…" : "Confirm clock in"}
                  </Button>
                </FormActions>
              }
            >
              <form
                className="space-y-[var(--space-form-gap)]"
                id="force-clock-in-form"
                onSubmit={handleManualClockIn}
              >
                <FormField label="Location" htmlFor="force-clock-in-location" required>
                  <select
                    className="timiq-input timiq-select"
                    id="force-clock-in-location"
                    required
                    ref={locationPickRef}
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
                </FormField>
                {assignableLocationsForUser.length === 0 ? (
                  <p className="break-words text-[length:var(--text-secondary)] text-[var(--color-danger-700)]">
                    No site access locations for this employee. Assign locations under Site Access
                    first.
                  </p>
                ) : null}
                <FormField
                  label="Clock-in date and time"
                  htmlFor="force-clock-in-at"
                  hint={`Entered in your local time (${localTimeZoneLabel}) and stored in UTC.`}
                  required
                >
                  <input
                    className="timiq-input"
                    id="force-clock-in-at"
                    required
                    ref={clockInAtRef}
                    type="datetime-local"
                    value={clockInAtLocal}
                    onChange={(event) => setClockInAtLocal(event.target.value)}
                  />
                </FormField>
                <FormField label="Reason" htmlFor="force-clock-in-reason" required>
                  <textarea
                    className="timiq-input min-h-[72px] py-2"
                    id="force-clock-in-reason"
                    required
                    ref={reasonInRef}
                    value={reasonIn}
                    onChange={(event) => setReasonIn(event.target.value)}
                  />
                </FormField>
                {actionError ? (
                  <div
                    className="break-words rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-2 py-2 text-[length:var(--text-secondary)] text-[var(--color-danger-700)]"
                    role="alert"
                  >
                    {actionError}
                  </div>
                ) : null}
              </form>
            </Modal>
          ) : null}

          {modalOutUser ? (
            <Modal
              title="Force clock out"
              subtitle={
                modalOutUser.email
                  ? `${modalOutUser.display_name} · ${modalOutUser.email}`
                  : modalOutUser.display_name
              }
              closeEnabled={!actionBusy}
              onClose={() => {
                if (!actionBusy) setModalOutUser(null);
              }}
              footer={
                <FormActions>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={actionBusy}
                    onClick={() => setModalOutUser(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    form="force-clock-out-form"
                    disabled={actionBusy}
                    aria-busy={actionBusy}
                  >
                    {actionBusy ? "Saving…" : "Confirm clock out"}
                  </Button>
                </FormActions>
              }
            >
              <form
                className="space-y-[var(--space-form-gap)]"
                id="force-clock-out-form"
                onSubmit={handleManualClockOut}
              >
                {modalOutUser.clock_in_at ? (
                  <p className="timiq-caption break-words">
                    Open since {new Date(modalOutUser.clock_in_at).toLocaleString()}
                    {modalOutUser.location_name ? ` · ${modalOutUser.location_name}` : ""}
                  </p>
                ) : null}
                <FormField
                  label="Clock-out date and time"
                  htmlFor="force-clock-out-at"
                  hint={`Entered in your local time (${localTimeZoneLabel}) and stored in UTC. Must be after the clock-in time.`}
                  required
                >
                  <input
                    className="timiq-input"
                    id="force-clock-out-at"
                    required
                    ref={clockOutAtRef}
                    type="datetime-local"
                    value={clockOutAtLocal}
                    onChange={(event) => setClockOutAtLocal(event.target.value)}
                  />
                </FormField>
                <FormField label="Reason" htmlFor="force-clock-out-reason" required>
                  <textarea
                    className="timiq-input min-h-[72px] py-2"
                    id="force-clock-out-reason"
                    required
                    ref={reasonOutRef}
                    value={reasonOut}
                    onChange={(event) => setReasonOut(event.target.value)}
                  />
                </FormField>
                {actionError ? (
                  <div
                    className="break-words rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-2 py-2 text-[length:var(--text-secondary)] text-[var(--color-danger-700)]"
                    role="alert"
                  >
                    {actionError}
                  </div>
                ) : null}
              </form>
            </Modal>
          ) : null}        </RoleGuard>
      </SheetBody>
    </Sheet>
  );
}
