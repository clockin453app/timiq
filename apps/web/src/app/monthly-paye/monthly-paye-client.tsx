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
import { isAdministrator, listManagedUsers, useCurrentUser, type AuthUser } from "../../features/auth";
import { listCompanies, type Company } from "../../features/companies/api";
import { useAdministratorCompanyScope } from "../../features/companies/selected-company";
import { fetchMonthlyPayeReportShell, type MonthlyPayeReportShell } from "../../features/paye-payroll/api";

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function splitMonth(value: string): { year: number; month: number } {
  const [yearRaw, monthRaw] = value.split("-");
  return {
    year: Number(yearRaw),
    month: Number(monthRaw),
  };
}

function employeeName(user: AuthUser): string {
  const name = [user.profile_first_name, user.profile_last_name].filter(Boolean).join(" ").trim();
  return name || user.email;
}

function ReadinessCard(props: { label: string; value: string; hint: string; tone?: "ok" | "warn" }) {
  const valueClass = props.tone === "ok" ? "text-emerald-900" : "text-amber-900";
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[#4b5563]">{props.label}</p>
      <p className={`mt-1 text-sm font-bold ${valueClass}`}>{props.value}</p>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">{props.hint}</p>
    </div>
  );
}

export function MonthlyPayeClient() {
  const currentUser = useCurrentUser();
  const administratorView = isAdministrator(currentUser);
  const [companies, setCompanies] = useState<Company[]>([]);
  const companyScope = useAdministratorCompanyScope(currentUser, companies);
  const [monthValue, setMonthValue] = useState(currentMonthValue);
  const [employeeUserId, setEmployeeUserId] = useState("");
  const [employees, setEmployees] = useState<AuthUser[]>([]);
  const [report, setReport] = useState<MonthlyPayeReportShell | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const activeCompanyId = administratorView ? companyScope.companyId : currentUser.company_id;

  useEffect(() => {
    if (!administratorView) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await listCompanies();
        if (!cancelled) {
          setCompanies(rows);
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
  }, [administratorView]);

  useEffect(() => {
    if (!activeCompanyId) {
      setEmployees([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await listManagedUsers(activeCompanyId);
        if (!cancelled) {
          setEmployees(rows.filter((u) => u.system_role === "employee"));
        }
      } catch {
        if (!cancelled) {
          setEmployees([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId]);

  async function load() {
    const { year, month } = splitMonth(monthValue);
    if (!activeCompanyId || !year || !month) {
      setReport(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await fetchMonthlyPayeReportShell({
        companyId: administratorView ? activeCompanyId : undefined,
        year,
        month,
        employeeUserId: employeeUserId || undefined,
      });
      setReport(data);
    } catch (e) {
      setReport(null);
      setError(e instanceof Error ? e.message : "Could not load Monthly PAYE Report.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [activeCompanyId, monthValue, employeeUserId]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load();
  }

  const selectedCompanyName = useMemo(() => {
    if (!activeCompanyId) return null;
    return companies.find((company) => company.id === activeCompanyId)?.name ?? null;
  }, [activeCompanyId, companies]);
  const configuredPayeEmployees = useMemo(
    () =>
      report?.rows.filter(
        (row) => row.payroll_type === "paye_employee" || Boolean(row.tax_code?.trim()) || Boolean(row.ni_category?.trim()),
      ).length ?? 0,
    [report],
  );

  return (
    <Sheet>
      <PageHeader
        title="Monthly PAYE Report"
        description="Monthly employee PAYE payroll. Configure PAYE settings before calculation."
        action={
          <Button disabled={loading || !activeCompanyId} onClick={() => void load()} size="sm" variant="secondary">
            Refresh
          </Button>
        }
      />
      <SheetBody className="space-y-4">
        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        <form
          className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-3 md:grid-cols-3"
          onSubmit={submit}
        >
          {administratorView ? (
            <label className="block text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
              Company
              <select
                className="mt-1 h-10 w-full rounded border border-[var(--color-border-dark)] bg-white px-2 text-sm"
                onChange={(event) => companyScope.setCompanyId(event.target.value)}
                value={companyScope.companyId ?? ""}
              >
                <option value="">Select company</option>
                {companyScope.companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2 text-sm">
              Company: {selectedCompanyName ?? "Your company"}
            </div>
          )}

          <label className="block text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            Month
            <input
              className="mt-1 h-10 w-full rounded border border-[var(--color-border-dark)] bg-white px-2 text-sm"
              onChange={(event) => setMonthValue(event.target.value)}
              type="month"
              value={monthValue}
            />
          </label>

          <label className="block text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            Employee
            <select
              className="mt-1 h-10 w-full rounded border border-[var(--color-border-dark)] bg-white px-2 text-sm"
              onChange={(event) => setEmployeeUserId(event.target.value)}
              value={employeeUserId}
            >
              <option value="">All employees</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employeeName(employee)}
                </option>
              ))}
            </select>
          </label>

          <div className="md:col-span-3">
            <Button disabled={loading || !activeCompanyId} size="sm" type="submit">
              Apply filters
            </Button>
          </div>
        </form>

        <div className="rounded-[var(--radius-md)] border border-amber-800/25 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          PAYE calculation engine is not enabled yet. Configure employee and company PAYE settings first.
          PAYE payslips will be available after PAYE calculation is enabled.
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <ReadinessCard
            label="Company PAYE settings"
            value={report?.company_settings_configured ? "Configured" : "Missing"}
            hint="Employer PAYE details and pension defaults"
            tone={report?.company_settings_configured ? "ok" : "warn"}
          />
          <ReadinessCard
            label="PAYE employees"
            value={`${configuredPayeEmployees} configured`}
            hint="Employees marked as PAYE or with PAYE identifiers"
            tone={configuredPayeEmployees > 0 ? "ok" : "warn"}
          />
          <ReadinessCard
            label="Calculation engine"
            value="Not enabled yet"
            hint="No PAYE tax, NI, pension, or loan calculations"
            tone="warn"
          />
          <ReadinessCard
            label="Payslips"
            value="Not enabled yet"
            hint="PAYE payslips will be separate from CIS statements"
            tone="warn"
          />
        </div>

        {loading ? <p className="text-sm text-[var(--color-text-muted)]">Loading…</p> : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Pay period</TableHead>
              <TableHead>Tax code</TableHead>
              <TableHead>NI category</TableHead>
              <TableHead>Gross pay</TableHead>
              <TableHead>PAYE tax</TableHead>
              <TableHead>Employee NI</TableHead>
              <TableHead>Pension</TableHead>
              <TableHead>Net pay</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report?.rows.map((row) => (
              <TableRow key={row.user_id}>
                <TableCell>
                  <div className="font-semibold">{row.employee_name || row.employee_email}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">{row.employee_email}</div>
                </TableCell>
                <TableCell>{monthValue}</TableCell>
                <TableCell>{row.tax_code || "Not set"}</TableCell>
                <TableCell>{row.ni_category || "Not set"}</TableCell>
                <TableCell>Not calculated</TableCell>
                <TableCell>Not calculated</TableCell>
                <TableCell>Not calculated</TableCell>
                <TableCell>Not calculated</TableCell>
                <TableCell>Not calculated</TableCell>
                <TableCell>{row.status === "not_calculated" ? "Not calculated" : row.status}</TableCell>
                <TableCell>
                  <span className="text-xs text-[var(--color-text-muted)]">Coming next</span>
                </TableCell>
              </TableRow>
            ))}
            {!loading && (!report || report.rows.length === 0) ? (
              <TableRow>
                <TableCell className="text-center text-[var(--color-text-muted)]" colSpan={11}>
                  No employee PAYE rows to show. This page is a Phase 1 settings/report shell.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </SheetBody>
    </Sheet>
  );
}
