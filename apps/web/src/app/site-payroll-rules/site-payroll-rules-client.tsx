"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  Button,
  Input,
  PageHeader,
  Sheet,
  SheetBody,
  SheetHeader,
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
import {
  deleteSitePayrollPolicy,
  getSitePayrollPolicyEffective,
  listSitePayrollPolicies,
  putSitePayrollPolicy,
  type CompanyTimePolicyFields,
  type SitePayrollPolicyEffectiveResponse,
  type SitePayrollPolicyListItem,
} from "../../features/payroll-policies/api";

function formatFallbackBlock(label: string, f: CompanyTimePolicyFields) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-800">
      <div className="font-medium text-neutral-900">{label}</div>
      <dl className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
        <div>
          <dt className="text-neutral-500">Standard start</dt>
          <dd>{f.standard_start_time}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Break after (minutes)</dt>
          <dd>{f.break_deduction_after_minutes ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Break deduction (minutes)</dt>
          <dd>{f.break_deduction_minutes}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Rounding</dt>
          <dd>
            {f.rounding_increment_minutes} min ({f.rounding_mode})
          </dd>
        </div>
      </dl>
    </div>
  );
}

function overrideLabel(row: SitePayrollPolicyListItem): string {
  if (!row.has_policy_row) {
    return "Company default";
  }
  if (row.is_enabled) {
    return "Site override on";
  }
  return "Override row (disabled)";
}

export function SitePayrollRulesClient() {
  const currentUser = useCurrentUser();
  const showCompanySelector = isAdministrator(currentUser);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [listItems, setListItems] = useState<SitePayrollPolicyListItem[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editLocationId, setEditLocationId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SitePayrollPolicyEffectiveResponse | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isEnabled, setIsEnabled] = useState(true);
  const [standardStart, setStandardStart] = useState("");
  const [allowEarly, setAllowEarly] = useState<string>("inherit");
  const [breakAfter, setBreakAfter] = useState("");
  const [breakMinutes, setBreakMinutes] = useState("");
  const [roundingInc, setRoundingInc] = useState("");
  const [roundingMode, setRoundingMode] = useState("");
  const [notes, setNotes] = useState("");

  const activeCompanies = useMemo(
    () => companies.filter((c) => c.is_active),
    [companies],
  );
  const selectedCompanyId = companyId || activeCompanies[0]?.id || "";

  const companyQueryArg = showCompanySelector ? selectedCompanyId : undefined;

  const loadList = useCallback(async () => {
    if (!selectedCompanyId) {
      setListItems([]);
      return;
    }
    const data = await listSitePayrollPolicies(companyQueryArg);
    setListItems(
      [...data.items].sort((a, b) => a.location_name.localeCompare(b.location_name)),
    );
  }, [companyQueryArg, selectedCompanyId]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      setIsLoading(true);
      setErrorMessage("");
      try {
        if (showCompanySelector) {
          const loaded = await listCompanies();
          if (cancelled) {
            return;
          }
          setCompanies(loaded);
          const first = loaded.find((c) => c.is_active);
          if (first) {
            setCompanyId((v) => v || first.id);
          }
        } else if (currentUser?.company_id) {
          setCompanyId(currentUser.company_id);
        } else {
          const users = await listManagedUsers();
          if (cancelled) {
            return;
          }
          const self = users.find((u: AuthUser) => u.id === currentUser?.id);
          const cid = self?.company_id;
          if (cid) {
            setCompanyId(cid);
          }
        }
      } catch {
        if (!cancelled) {
          setErrorMessage("Could not load companies.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.company_id, currentUser?.id, showCompanySelector]);

  useEffect(() => {
    if (!selectedCompanyId) {
      return;
    }
    let cancelled = false;
    async function run() {
      setErrorMessage("");
      try {
        await loadList();
      } catch (e) {
        if (!cancelled) {
          setErrorMessage(e instanceof Error ? e.message : "Could not load site payroll rules.");
        }
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [loadList, selectedCompanyId]);

  function populateFormFromDetail(d: SitePayrollPolicyEffectiveResponse) {
    const o = d.override;
    setIsEnabled(o?.is_enabled ?? true);
    setStandardStart(o?.standard_start_time ?? "");
    if (o?.allow_early_clock_in === true) {
      setAllowEarly("true");
    } else if (o?.allow_early_clock_in === false) {
      setAllowEarly("false");
    } else {
      setAllowEarly("inherit");
    }
    setBreakAfter(
      o?.break_deduction_after_minutes !== undefined && o?.break_deduction_after_minutes !== null
        ? String(o.break_deduction_after_minutes)
        : "",
    );
    setBreakMinutes(
      o?.break_deduction_minutes !== undefined && o?.break_deduction_minutes !== null
        ? String(o.break_deduction_minutes)
        : "",
    );
    setRoundingInc(
      o?.rounding_increment_minutes !== undefined && o?.rounding_increment_minutes !== null
        ? String(o.rounding_increment_minutes)
        : "",
    );
    setRoundingMode(o?.rounding_mode ?? "");
    setNotes(o?.notes ?? "");
  }

  async function openEdit(locationId: string) {
    setEditLocationId(locationId);
    setSheetOpen(true);
    setErrorMessage("");
    setDetail(null);
    try {
      const d = await getSitePayrollPolicyEffective(locationId, companyQueryArg);
      setDetail(d);
      populateFormFromDetail(d);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Could not load site.");
      setSheetOpen(false);
    }
  }

  function parseOptionalInt(raw: string): number | null {
    const t = raw.trim();
    if (!t) {
      return null;
    }
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error("Break fields must be blank or non‑negative numbers.");
    }
    return Math.floor(n);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editLocationId) {
      return;
    }
    setIsSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const std = standardStart.trim();
      let allowEarlyVal: boolean | null = null;
      if (allowEarly === "true") {
        allowEarlyVal = true;
      }
      if (allowEarly === "false") {
        allowEarlyVal = false;
      }
      const body = {
        is_enabled: isEnabled,
        standard_start_time: std ? std : null,
        allow_early_clock_in: allowEarlyVal,
        break_deduction_after_minutes: parseOptionalInt(breakAfter),
        break_deduction_minutes: parseOptionalInt(breakMinutes),
        rounding_increment_minutes: roundingInc.trim()
          ? Number(roundingInc.trim())
          : null,
        rounding_mode: roundingMode.trim() ? roundingMode.trim().toLowerCase() : null,
        notes: notes.trim() ? notes.trim() : null,
      };
      const updated = await putSitePayrollPolicy(editLocationId, body, companyQueryArg);
      setDetail(updated);
      setSuccessMessage("Site payroll rules saved.");
      await loadList();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setIsSaving(false);
    }
  }

  async function onDelete() {
    if (!editLocationId) {
      return;
    }
    if (!window.confirm("Remove stored site payroll rules for this location? Company policy will apply.")) {
      return;
    }
    setIsDeleting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await deleteSitePayrollPolicy(editLocationId, companyQueryArg);
      setSuccessMessage("Site payroll rules removed.");
      setSheetOpen(false);
      setEditLocationId(null);
      setDetail(null);
      await loadList();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <RoleGuard
      allowedRoles={["administrator", "admin"]}
      fallback={
        <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-neutral-700">
          You do not have permission to manage site payroll rules.
        </div>
      }
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        <PageHeader
          title="Site payroll rules"
          description="Per-location time rounding, breaks, standard start, and early clock-in behaviour. Company policy is the default when fields are left blank."
        />

        {showCompanySelector ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-neutral-600">Company</span>
              <select
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-neutral-900"
                value={selectedCompanyId}
                onChange={(ev) => setCompanyId(ev.target.value)}
              >
                {activeCompanies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Blank fields use company policy. Changes affect future pending recalculations; approved or paid payroll is
          not changed automatically.
        </div>

        {errorMessage ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            {errorMessage}
          </div>
        ) : null}
        {successMessage ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {successMessage}
          </div>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-neutral-600">Loading…</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Site</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Override</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listItems.map((row) => (
                  <TableRow key={row.location_id}>
                    <TableCell className="font-medium">{row.location_name}</TableCell>
                    <TableCell>{row.is_active ? "Yes" : "No"}</TableCell>
                    <TableCell>{overrideLabel(row)}</TableCell>
                    <TableCell className="text-right">
                      <Button type="button" variant="secondary" onClick={() => void openEdit(row.location_id)}>
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {sheetOpen ? (
        <Sheet className="mt-4 border border-neutral-200 bg-white">
          <SheetHeader>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold text-neutral-900">
                {detail ? `Edit: ${detail.location_name}` : "Site payroll rules"}
              </h2>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSheetOpen(false)}>
                Close panel
              </Button>
            </div>
          </SheetHeader>
          <SheetBody>
            {detail ? (
              <form className="flex flex-col gap-4" onSubmit={onSubmit}>
                {formatFallbackBlock("Company policy (fallback)", detail.company_fallback)}
                {formatFallbackBlock("Effective values now (company + site)", detail.merged_effective)}

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={(ev) => setIsEnabled(ev.target.checked)}
                  />
                  Enable site override (when off, company policy applies for this site)
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-600">Standard start time (HH:MM, blank = company)</span>
                  <Input value={standardStart} onChange={(ev) => setStandardStart(ev.target.value)} placeholder="08:00" />
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-600">Allow early clock-in counting</span>
                  <select
                    className="rounded-md border border-neutral-300 bg-white px-3 py-2"
                    value={allowEarly}
                    onChange={(ev) => setAllowEarly(ev.target.value)}
                  >
                    <option value="inherit">Use employee profile</option>
                    <option value="true">Allow at this site</option>
                    <option value="false">Disallow at this site</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-600">Break threshold (minutes worked before auto break, blank = company)</span>
                  <Input value={breakAfter} onChange={(ev) => setBreakAfter(ev.target.value)} inputMode="numeric" />
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-600">Break deduction (minutes, blank = company)</span>
                  <Input value={breakMinutes} onChange={(ev) => setBreakMinutes(ev.target.value)} inputMode="numeric" />
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-600">Rounding increment (minutes, blank = company)</span>
                  <select
                    className="rounded-md border border-neutral-300 bg-white px-3 py-2"
                    value={roundingInc}
                    onChange={(ev) => setRoundingInc(ev.target.value)}
                  >
                    <option value="">Company default</option>
                    <option value="1">1</option>
                    <option value="5">5</option>
                    <option value="10">10</option>
                    <option value="15">15</option>
                    <option value="30">30</option>
                    <option value="60">60</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-600">Rounding mode (blank = company)</span>
                  <select
                    className="rounded-md border border-neutral-300 bg-white px-3 py-2"
                    value={roundingMode}
                    onChange={(ev) => setRoundingMode(ev.target.value)}
                  >
                    <option value="">Company default</option>
                    <option value="nearest">nearest</option>
                    <option value="up">up</option>
                    <option value="down">down</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-600">Notes</span>
                  <textarea
                    className="min-h-[88px] rounded-md border border-neutral-300 bg-white px-3 py-2 text-neutral-900"
                    value={notes}
                    onChange={(ev) => setNotes(ev.target.value)}
                    maxLength={4000}
                  />
                </label>

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                  <Button type="button" variant="ghost" onClick={() => setSheetOpen(false)}>
                    Close
                  </Button>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={isDeleting || !detail.override}
                      onClick={() => void onDelete()}
                    >
                      {isDeleting ? "Removing…" : "Remove site rules"}
                    </Button>
                    <Button type="submit" disabled={isSaving}>
                      {isSaving ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              </form>
            ) : (
              <p className="text-sm text-neutral-600">Loading…</p>
            )}
          </SheetBody>
        </Sheet>
        ) : null}
      </div>
    </RoleGuard>
  );
}
