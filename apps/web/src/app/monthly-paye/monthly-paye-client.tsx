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
import {
  approveMonthlyPayePeriod,
  fetchMonthlyPayeReportShell,
  markMonthlyPayePeriodPaid,
  recalculateMonthlyPaye,
  type MonthlyPayeItem,
  type MonthlyPayeReport,
} from "../../features/paye-payroll/api";

const TAX_YEAR = "2026-2027";

function currentTaxMonth(): number {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  if (month > 4 || (month === 4 && day >= 6)) {
    return Math.min(12, month - 3);
  }
  return month + 9;
}

function employeeName(user: AuthUser): string {
  const name = [user.profile_first_name, user.profile_last_name].filter(Boolean).join(" ").trim();
  return name || user.email;
}

function money(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "Not calculated";
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return "Not calculated";
  }
  return new Intl.NumberFormat("en-GB", { currency: "GBP", style: "currency" }).format(n);
}

function statusBadgeClass(status: string): string {
  if (status === "pending") return "border-amber-800/25 bg-amber-50 text-amber-950";
  if (status === "approved") return "border-emerald-800/25 bg-emerald-50 text-emerald-900";
  if (status === "paid") return "border-slate-500/25 bg-slate-100 text-slate-900";
  return "border-slate-300 bg-slate-50 text-slate-700";
}

function SummaryCard(props: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-cell)] p-3 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[#4b5563]">{props.label}</p>
      <p className="mt-1 text-sm font-bold text-[var(--color-text)]">{props.value}</p>
      {props.hint ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">{props.hint}</p> : null}
    </div>
  );
}

function rowMoney(row: MonthlyPayeItem, field: keyof MonthlyPayeItem): string {
  if (row.unsupported_reason) {
    return "Not supported";
  }
  return money(row[field] as string | null);
}

export function MonthlyPayeClient() {
  const currentUser = useCurrentUser();
  const administratorView = isAdministrator(currentUser);
  const [companies, setCompanies] = useState<Company[]>([]);
  const companyScope = useAdministratorCompanyScope(currentUser, companies);
  const [taxMonth, setTaxMonth] = useState(currentTaxMonth);
  const [employeeUserId, setEmployeeUserId] = useState("");
  const [employees, setEmployees] = useState<AuthUser[]>([]);
  const [report, setReport] = useState<MonthlyPayeReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [error, setError] = useState("");

  const activeCompanyId = administratorView ? companyScope.companyId : currentUser.company_id;

  useEffect(() => {
    if (!administratorView) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listCompanies();
        if (!cancelled) setCompanies(rows);
      } catch {
        if (!cancelled) setCompanies([]);
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
        if (!cancelled) setEmployees(rows.filter((u) => u.system_role === "employee"));
      } catch {
        if (!cancelled) setEmployees([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId]);

  async function load() {
    if (!activeCompanyId || !taxMonth) {
      setReport(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await fetchMonthlyPayeReportShell({
        companyId: administratorView ? activeCompanyId : undefined,
        taxYear: TAX_YEAR,
        taxMonth,
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
  }, [activeCompanyId, taxMonth, employeeUserId]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load();
  }

  async function runAction(action: "recalculate" | "approve" | "paid") {
    if (!activeCompanyId) return;
    if ((action === "approve" || action === "paid") && !report?.period) return;
    setActionLoading(action);
    setError("");
    try {
      const data =
        action === "recalculate"
          ? await recalculateMonthlyPaye({
              companyId: administratorView ? activeCompanyId : undefined,
              taxYear: TAX_YEAR,
              taxMonth,
            })
          : action === "approve"
            ? await approveMonthlyPayePeriod(report!.period!.id)
            : await markMonthlyPayePeriodPaid(report!.period!.id);
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Monthly PAYE action failed.");
    } finally {
      setActionLoading("");
    }
  }

  const selectedCompanyName = useMemo(() => {
    if (!activeCompanyId) return null;
    return companies.find((company) => company.id === activeCompanyId)?.name ?? null;
  }, [activeCompanyId, companies]);

  const periodLabel = report?.period
    ? `${report.period.period_start} to ${report.period.period_end}`
    : `Tax month ${taxMonth}`;
  const canApprove = report?.period?.status === "pending" && (report?.summary.unsupported_count ?? 0) === 0;
  const canMarkPaid = report?.period?.status === "approved";
  const canRecalculate = !report?.period || report.period.status === "pending";

  return (
    <Sheet>
      <PageHeader
        title="Monthly PAYE Report"
        description="Limited PAYE monthly payroll for fixed salary employees. PAYE payslips and RTI are not enabled."
        action={
          <Button
            disabled={loading || actionLoading !== "" || !activeCompanyId || !canRecalculate}
            onClick={() => void runAction("recalculate")}
            size="sm"
          >
            {actionLoading === "recalculate" ? "Recalculating..." : "Recalculate month"}
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
          className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-3 md:grid-cols-4"
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
            Tax year
            <select className="mt-1 h-10 w-full rounded border border-[var(--color-border-dark)] bg-white px-2 text-sm" value={TAX_YEAR} disabled>
              <option value={TAX_YEAR}>2026-2027</option>
            </select>
          </label>

          <label className="block text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            Tax month
            <select
              className="mt-1 h-10 w-full rounded border border-[var(--color-border-dark)] bg-white px-2 text-sm"
              onChange={(event) => setTaxMonth(Number(event.target.value))}
              value={taxMonth}
            >
              {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                <option key={month} value={month}>
                  Tax month {month}
                </option>
              ))}
            </select>
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

          <div className="flex flex-wrap gap-2 md:col-span-4">
            <Button disabled={loading || !activeCompanyId} size="sm" type="submit">
              Apply filters
            </Button>
            <Button
              disabled={actionLoading !== "" || !report?.period || !canApprove}
              onClick={() => void runAction("approve")}
              size="sm"
              type="button"
              variant="secondary"
            >
              {actionLoading === "approve" ? "Approving..." : "Approve pending"}
            </Button>
            <Button
              disabled={actionLoading !== "" || !report?.period || !canMarkPaid}
              onClick={() => void runAction("paid")}
              size="sm"
              type="button"
              variant="secondary"
            >
              {actionLoading === "paid" ? "Marking paid..." : "Mark paid"}
            </Button>
          </div>
        </form>

        <div className="rounded-[var(--radius-md)] border border-amber-800/25 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Supported in this phase: fixed monthly salary, numeric L tax codes only, NI category A only.
          Payslips and RTI/HMRC submission are not enabled.
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryCard label="Employees" value={String(report?.summary.employees ?? 0)} hint={`${report?.summary.unsupported_count ?? 0} unsupported`} />
          <SummaryCard label="Total gross" value={money(report?.summary.total_gross)} />
          <SummaryCard label="Taxable pay" value={money(report?.summary.taxable_pay)} />
          <SummaryCard label="PAYE tax" value={money(report?.summary.paye_tax)} />
          <SummaryCard label="Employee NI" value={money(report?.summary.employee_ni)} />
          <SummaryCard label="Employer NI" value={money(report?.summary.employer_ni)} />
          <SummaryCard label="Employee pension" value={money(report?.summary.employee_pension)} />
          <SummaryCard label="Employer pension" value={money(report?.summary.employer_pension)} />
          <SummaryCard
            label="Student/Postgraduate"
            value={money((Number(report?.summary.student_loans ?? 0) + Number(report?.summary.postgraduate_loans ?? 0)).toFixed(2))}
          />
          <SummaryCard label="Net pay" value={money(report?.summary.net_pay)} />
        </div>

        {report?.message ? <p className="text-sm text-[var(--color-text-muted)]">{report.message}</p> : null}
        {loading ? <p className="text-sm text-[var(--color-text-muted)]">Loading...</p> : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Pay period</TableHead>
              <TableHead>Pay date</TableHead>
              <TableHead>Tax code</TableHead>
              <TableHead>NI category</TableHead>
              <TableHead>Gross pay</TableHead>
              <TableHead>Taxable pay</TableHead>
              <TableHead>PAYE tax</TableHead>
              <TableHead>Employee NI</TableHead>
              <TableHead>Employer NI</TableHead>
              <TableHead>Pension</TableHead>
              <TableHead>Student/Postgraduate loan</TableHead>
              <TableHead>Net pay</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Unsupported reason / Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report?.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="font-semibold">{row.employee_name || row.employee_email}</div>
                  <div className="text-xs text-[var(--color-text-muted)]">{row.employee_email}</div>
                </TableCell>
                <TableCell>{periodLabel}</TableCell>
                <TableCell>{report.period?.pay_date ?? "Not calculated"}</TableCell>
                <TableCell>{row.tax_code || "Not set"}</TableCell>
                <TableCell>{row.ni_category || "Not set"}</TableCell>
                <TableCell>{rowMoney(row, "gross_pay")}</TableCell>
                <TableCell>{rowMoney(row, "taxable_pay")}</TableCell>
                <TableCell>{rowMoney(row, "paye_tax")}</TableCell>
                <TableCell>{rowMoney(row, "employee_ni")}</TableCell>
                <TableCell>{rowMoney(row, "employer_ni")}</TableCell>
                <TableCell>
                  {row.unsupported_reason
                    ? "Not supported"
                    : `${money(row.employee_pension)} / ${money(row.employer_pension)}`}
                </TableCell>
                <TableCell>
                  {row.unsupported_reason
                    ? "Not supported"
                    : `${money(row.student_loan)} / ${money(row.postgraduate_loan_deduction)}`}
                </TableCell>
                <TableCell>{rowMoney(row, "net_pay")}</TableCell>
                <TableCell>
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(row.status)}`}>
                    {row.unsupported_reason ? "Not supported" : row.status}
                  </span>
                </TableCell>
                <TableCell>
                  {row.unsupported_reason ? (
                    <span className="text-xs text-amber-950">{row.unsupported_reason}</span>
                  ) : (
                    <span className="text-xs text-[var(--color-text-muted)]">Managed by period actions</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!loading && (!report || report.rows.length === 0) ? (
              <TableRow>
                <TableCell className="text-center text-[var(--color-text-muted)]" colSpan={15}>
                  No real PAYE rows yet. Select a company and tax month, then recalculate the month.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </SheetBody>
    </Sheet>
  );
}
