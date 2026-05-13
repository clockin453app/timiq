"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { Button, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui";
import { isAdministrator, listManagedUsers, useCurrentUser, type AuthUser } from "../../features/auth";
import { fetchLabourCostBudget, type LabourCostBudgetResponse } from "../../features/budgets/api";
import { listCompanies, type Company } from "../../features/companies/api";
import { formatHoursFromSeconds } from "../../features/payroll/format";
import { listLocations, type Location } from "../../features/locations/api";
import { listWorkplaces, type Workplace } from "../../features/workplaces/api";
import { BudgetStatCard, moneyDisplay, percentDisplay } from "./budget-ui";

function isoYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 13);
  return { from: isoYmd(from), to: isoYmd(to) };
}

function resolveCompanyId(user: AuthUser, override: string | null): string | null {
  if (isAdministrator(user)) {
    return override;
  }
  return user.company_id;
}

export function BudgetQuickCalculatorTab() {
  const user = useCurrentUser();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyOverride, setCompanyOverride] = useState<string | null>(null);
  const range = useMemo(() => defaultDateRange(), []);
  const [dateFrom, setDateFrom] = useState(range.from);
  const [dateTo, setDateTo] = useState(range.to);
  const [workplaceId, setWorkplaceId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [plannedBudget, setPlannedBudget] = useState("");
  const [locations, setLocations] = useState<Location[]>([]);
  const [workplaces, setWorkplaces] = useState<Workplace[]>([]);
  const [employees, setEmployees] = useState<AuthUser[]>([]);
  const [result, setResult] = useState<LabourCostBudgetResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasRun, setHasRun] = useState(false);

  const activeCompanyId = useMemo(() => resolveCompanyId(user, companyOverride), [user, companyOverride]);

  useEffect(() => {
    if (!isAdministrator(user)) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await listCompanies();
        if (!cancelled) {
          setCompanies(list.filter((c) => c.is_active));
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
  }, [user]);

  useEffect(() => {
    if (!isAdministrator(user) || companies.length === 0 || companyOverride !== null) {
      return;
    }
    setCompanyOverride(companies[0].id);
  }, [user, companies, companyOverride]);

  const loadFilters = useCallback(async () => {
    if (!activeCompanyId) {
      setLocations([]);
      setWorkplaces([]);
      setEmployees([]);
      return;
    }
    try {
      const [locs, wps, users] = await Promise.all([listLocations(), listWorkplaces(), listManagedUsers()]);
      setLocations(locs.filter((l) => l.company_id === activeCompanyId && l.is_active));
      setWorkplaces(wps.filter((w) => w.company_id === activeCompanyId && w.is_active));
      setEmployees(
        users
          .filter((u) => u.system_role === "employee" && u.company_id === activeCompanyId)
          .slice()
          .sort((a, b) => (a.email || "").localeCompare(b.email || "")),
      );
    } catch {
      setLocations([]);
      setWorkplaces([]);
      setEmployees([]);
    }
  }, [activeCompanyId]);

  useEffect(() => {
    void loadFilters();
  }, [loadFilters]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (isAdministrator(user) && !activeCompanyId) {
      setError("Select a company.");
      return;
    }
    setLoading(true);
    setHasRun(true);
    try {
      const data = await fetchLabourCostBudget({
        companyId: isAdministrator(user) ? activeCompanyId : undefined,
        dateFrom,
        dateTo,
        workplaceId: workplaceId.trim() || null,
        locationId: locationId.trim() || null,
        userId: employeeId.trim() || null,
        plannedBudgetAmount: plannedBudget.trim() || null,
      });
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = Boolean(activeCompanyId) && !loading;

  return (
    <div className="min-w-0 space-y-4">
      <p className="text-sm text-[var(--color-text-muted)]">
        Compare a planned figure to labour cost from completed shifts using server-side payroll rules. This tab does not
        save a project budget; use Saved budgets for live job tracking.
      </p>
      <form
        className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-3"
        onSubmit={(e) => void handleSubmit(e)}
      >
        {isAdministrator(user) ? (
          <label className="block max-w-md text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">Company</span>
            <select
              className="mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]"
              onChange={(e) => setCompanyOverride(e.target.value || null)}
              value={companyOverride ?? ""}
            >
              <option value="">Choose company…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">Date from</span>
            <Input className="mt-1" onChange={(e) => setDateFrom(e.target.value)} type="date" value={dateFrom} />
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">Date to</span>
            <Input className="mt-1" onChange={(e) => setDateTo(e.target.value)} type="date" value={dateTo} />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">Workplace (optional)</span>
            <select
              className="mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]"
              disabled={!activeCompanyId}
              onChange={(e) => setWorkplaceId(e.target.value)}
              value={workplaceId}
            >
              <option value="">Any</option>
              {workplaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">Location (optional)</span>
            <select
              className="mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]"
              disabled={!activeCompanyId}
              onChange={(e) => setLocationId(e.target.value)}
              value={locationId}
            >
              <option value="">Any</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block max-w-md text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
          <span className="text-[var(--color-text)]">Employee (optional)</span>
          <select
            className="mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]"
            disabled={!activeCompanyId}
            onChange={(e) => setEmployeeId(e.target.value)}
            value={employeeId}
          >
            <option value="">All employees</option>
            {employees.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
              </option>
            ))}
          </select>
        </label>

        <label className="block max-w-md text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
          <span className="text-[var(--color-text)]">Planned budget (£, optional)</span>
          <Input
            className="mt-1"
            inputMode="decimal"
            onChange={(e) => setPlannedBudget(e.target.value)}
            placeholder="e.g. 5000"
            value={plannedBudget}
          />
        </label>

        <Button disabled={!canSubmit} type="submit">
          {loading ? "Calculating…" : "Run calculation"}
        </Button>
      </form>

      {error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2.5 text-sm text-[var(--color-danger-700)]">
          {error}
        </div>
      ) : null}

      {!hasRun ? (
        <p className="text-sm text-[var(--color-text-muted)]">Choose dates and filters, then run the calculation.</p>
      ) : null}

      {result ? (
        <div className="space-y-4">
          <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
            {result.estimate_note}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <BudgetStatCard label="Planned budget" value={moneyDisplay(result.planned_budget_amount)} />
            <BudgetStatCard label="Estimated labour cost" value={moneyDisplay(result.actual_labour_cost)} />
            <BudgetStatCard label="Remaining budget" value={moneyDisplay(result.remaining_budget)} />
            <BudgetStatCard label="Over budget" value={moneyDisplay(result.over_budget_amount)} />
            <BudgetStatCard label="Budget used" value={percentDisplay(result.budget_used_percent)} />
            <BudgetStatCard
              hint="Payroll-rounded hours from completed shifts"
              label="Payroll hours"
              value={`${formatHoursFromSeconds(result.total_payroll_seconds)} h`}
            />
            <BudgetStatCard
              label="Avg. hourly cost"
              value={result.average_hourly_cost != null ? moneyDisplay(result.average_hourly_cost) : "—"}
            />
            <BudgetStatCard
              label="Open shifts (in range)"
              value={String(result.open_shift_count)}
              hint="Not included in cost"
            />
            <BudgetStatCard
              label="Employees missing rate"
              value={String(result.rate_missing_count)}
              hint="Those hours are costed at £0.00"
            />
          </div>

          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
            <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">By employee</p>
            </div>
            <div className="overflow-x-auto p-2">
              {result.breakdown_by_employee.length === 0 ? (
                <p className="p-2 text-sm text-[var(--color-text-muted)]">No completed shifts in range.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Job title</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Labour cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.breakdown_by_employee.map((row) => (
                      <TableRow key={row.user_id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium">{row.employee_name ?? row.employee_email}</span>
                            <span className="text-xs text-[var(--color-text-muted)]">{row.employee_email}</span>
                            {row.rate_missing ? (
                              <span className="text-xs font-semibold text-amber-800">Missing rate</span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>{row.job_title ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatHoursFromSeconds(row.total_payroll_seconds)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.hourly_rate != null ? moneyDisplay(row.hourly_rate) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{moneyDisplay(row.labour_cost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)]">
            <div className="border-b border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-soft)]">By location</p>
            </div>
            <div className="overflow-x-auto p-2">
              {result.breakdown_by_location.length === 0 ? (
                <p className="p-2 text-sm text-[var(--color-text-muted)]">No completed shifts in range.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Location</TableHead>
                      <TableHead>Workplace</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Labour cost</TableHead>
                      <TableHead className="text-right">Shifts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.breakdown_by_location.map((row) => (
                      <TableRow key={row.location_id}>
                        <TableCell className="font-medium">{row.location_name}</TableCell>
                        <TableCell>{row.workplace_name ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatHoursFromSeconds(row.total_payroll_seconds)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{moneyDisplay(row.labour_cost)}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.shift_count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
