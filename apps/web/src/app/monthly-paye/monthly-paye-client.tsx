"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  AlertBanner,
  Button,
  Card,
  PageHeader,
  SectionCard,
  Sheet,
  SheetBody,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui";
import { cn } from "../../lib/cn";
import { uiClasses } from "../../lib/ui-classes";
import { isAdministrator, listManagedUsers, useCurrentUser, type AuthUser } from "../../features/auth";
import { listCompanies, type Company } from "../../features/companies/api";
import { useAdministratorCompanyScope } from "../../features/companies/selected-company";
import {
  approveMonthlyPayePeriod,
  deletePayePayComponent,
  downloadMonthlyPayePayslipPdf,
  fetchPayeCapabilities,
  fetchMonthlyPayeReportShell,
  fetchPayePayComponents,
  markMonthlyPayePeriodPaid,
  openMonthlyPayePayslip,
  recalculateMonthlyPaye,
  unlockApprovedMonthlyPayePeriod,
  undoPaidMonthlyPayePeriod,
  type PayePayComponent,
  type PayeCapabilitiesResponse,
  type MonthlyPayeItem,
  type MonthlyPayeReport,
} from "../../features/paye-payroll/api";
import { PayePayComponentModal } from "./paye-pay-component-modal";

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

function PayeStatCard(props: { label: string; value: string; hint?: string; emphasize?: boolean }) {
  return (
    <Card padded>
      <p className={uiClasses.payeStatLabel}>{props.label}</p>
      <p className={props.emphasize ? uiClasses.payeStatValueLg : uiClasses.payeStatValue}>{props.value}</p>
      {props.hint ? <p className="timiq-caption mt-1">{props.hint}</p> : null}
    </Card>
  );
}

function PayeCapabilityPanel(props: {
  title: string;
  items: string[];
  tone: "ok" | "warn" | "soon";
}) {
  const alertTone = props.tone === "ok" ? "success" : props.tone === "soon" ? "info" : "warning";
  return (
    <AlertBanner className="h-full" title={props.title} tone={alertTone}>
      <ul className="space-y-1 text-xs leading-snug">
        {props.items.slice(0, 8).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </AlertBanner>
  );
}

function rowMoney(row: MonthlyPayeItem, field: keyof MonthlyPayeItem): string {
  if (row.unsupported_reason) {
    return "Not supported";
  }
  return money(row[field] as string | null);
}

function canOpenPayePayslip(row: MonthlyPayeItem): boolean {
  return !row.unsupported_reason && (row.status === "approved" || row.status === "paid");
}

function hasHourlyBreakdown(row: MonthlyPayeItem): boolean {
  return row.salary_type === "hourly" && Boolean(row.gross_hourly_pay);
}

function componentLockLabel(row: MonthlyPayeItem): string | null {
  if (row.status === "approved") return "Locked — approved";
  if (row.status === "paid") return "Locked — paid";
  return null;
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
  const [components, setComponents] = useState<PayePayComponent[]>([]);
  const [capabilities, setCapabilities] = useState<PayeCapabilitiesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [error, setError] = useState("");
  const [componentEmployee, setComponentEmployee] = useState<MonthlyPayeItem | null>(null);
  const [editingComponent, setEditingComponent] = useState<PayePayComponent | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchPayeCapabilities();
        if (!cancelled) {
          setCapabilities(data);
        }
      } catch {
        if (!cancelled) {
          setCapabilities(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      const componentRows = await fetchPayePayComponents({
        companyId: administratorView ? activeCompanyId : undefined,
        taxYear: TAX_YEAR,
        taxMonth,
        userId: employeeUserId || undefined,
      });
      setComponents(componentRows);
    } catch (e) {
      setReport(null);
      setComponents([]);
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

  async function runAction(action: "recalculate" | "approve" | "unlockApproved" | "paid" | "undoPaid") {
    if (!activeCompanyId) return;
    if ((action === "approve" || action === "unlockApproved" || action === "paid" || action === "undoPaid") && !report?.period) return;
    if (
      action === "unlockApproved" &&
      !window.confirm(
        "Unlock this approved PAYE period? This will move it back to pending so payroll can be edited and recalculated. It will not change money values until you recalculate.",
      )
    ) {
      return;
    }
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
            : action === "unlockApproved"
              ? await unlockApprovedMonthlyPayePeriod(report!.period!.id)
              : action === "paid"
                ? await markMonthlyPayePeriodPaid(report!.period!.id)
                : await undoPaidMonthlyPayePeriod(report!.period!.id);
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
  const canUnlockApproved = report?.period?.status === "approved";
  const canMarkPaid = report?.period?.status === "approved";
  const canUndoPaid = report?.period?.status === "paid";
  const canRecalculate = !report?.period || report.period.status === "pending";
  const componentsLocked = report?.period?.status === "approved" || report?.period?.status === "paid";
  const capabilityRows = capabilities?.categories.flatMap((category) => category.capabilities) ?? [];
  const supportedCapabilityNames = capabilityRows
    .filter((capability) => capability.status === "enabled")
    .map((capability) => capability.name);
  const comingSoonCapabilityNames = capabilityRows
    .filter((capability) => capability.status === "coming_soon")
    .map((capability) => capability.name);
  const unsupportedCapabilityNames = capabilityRows
    .filter((capability) => capability.status === "not_supported")
    .map((capability) => capability.name);

  return (
    <Sheet>
      <PageHeader
        title="Monthly PAYE Report"
        description="Monthly PAYE supports fixed monthly salary, hourly PAYE from completed time shifts, monthly-threshold overtime, bonus and commission components, PAYE payslips, and employee PAYE Pay History. RTI/HMRC submission, P45/P60, statutory pay, auto-enrolment assessment, and pension opt-out refunds are not enabled yet."
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
        {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}

        <SectionCard description={periodLabel} title="Period & filters">
          <form className="space-y-3" onSubmit={submit}>
            {report?.period?.status ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="timiq-caption text-[var(--color-text-muted)]">Period status</span>
                <StatusBadge status={report.period.status}>{report.period.status}</StatusBadge>
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-4">
              {administratorView ? (
                <label className={uiClasses.payeFilterLabel}>
                  Company
                  <select
                    className={uiClasses.payeFilterSelect}
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
                <Card className="flex items-center px-3 py-2 text-sm text-[var(--color-text)]" padded>
                  Company: {selectedCompanyName ?? "Your company"}
                </Card>
              )}

              <label className={uiClasses.payeFilterLabel}>
                Tax year
                <select className={uiClasses.payeFilterSelect} value={TAX_YEAR} disabled>
                  <option value={TAX_YEAR}>2026-2027</option>
                </select>
              </label>

              <label className={uiClasses.payeFilterLabel}>
                Tax month
                <select
                  className={uiClasses.payeFilterSelect}
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

              <label className={uiClasses.payeFilterLabel}>
                Employee
                <select
                  className={uiClasses.payeFilterSelect}
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
            </div>

            <div className={cn(uiClasses.payeActionToolbar, "md:col-span-4")}>
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
              <Button
                disabled={actionLoading !== "" || !report?.period || !canUnlockApproved}
                onClick={() => void runAction("unlockApproved")}
                size="sm"
                type="button"
                variant="secondary"
              >
                {actionLoading === "unlockApproved" ? "Unlocking..." : "Unlock approved"}
              </Button>
              <Button
                disabled={actionLoading !== "" || !report?.period || !canUndoPaid}
                onClick={() => void runAction("undoPaid")}
                size="sm"
                type="button"
                variant="secondary"
              >
                {actionLoading === "undoPaid" ? "Undoing paid..." : "Undo paid"}
              </Button>
            </div>
          </form>
        </SectionCard>

        <AlertBanner tone="warning">
          RTI/HMRC submission, P45/P60, statutory pay, auto-enrolment assessment, and pension opt-out refunds are not
          enabled yet. Use the coverage matrix below for full detail.
        </AlertBanner>

        <SectionCard
          description="Informational matrix only. Unsupported features are not calculated and will continue to show as not supported."
          title="PAYE calculation coverage"
        >
          <div className="grid gap-2 lg:grid-cols-3">
            <PayeCapabilityPanel
              title="Currently supported"
              items={
                supportedCapabilityNames.length
                  ? supportedCapabilityNames
                  : [
                      "Fixed monthly salary",
                      "Hourly PAYE",
                      "PAYE overtime (monthly threshold)",
                      "Bonus pay",
                      "Commission pay",
                      "Numeric L tax codes",
                      "NI category A",
                      "Student/postgraduate loans",
                      "Basic pensions",
                      "PAYE payslips",
                      "Employee PAYE Pay History",
                    ]
              }
              tone="ok"
            />
            <PayeCapabilityPanel
              title="Not supported yet"
              items={
                unsupportedCapabilityNames.length
                  ? unsupportedCapabilityNames
                  : [
                      "Scottish/Welsh tax codes",
                      "Other NI categories",
                      "Salary sacrifice",
                      "Statutory pay",
                      "Benefits in kind",
                      "Attachment of earnings",
                      "RTI/FPS/EPS/HMRC submission",
                      "P45/P60",
                    ]
              }
              tone="warn"
            />
            <PayeCapabilityPanel
              title="Coming next"
              items={
                comingSoonCapabilityNames.length
                  ? comingSoonCapabilityNames
                  : ["Auto-enrolment assessment", "Pension opt-out refunds", "Daily/weekly overtime rules"]
              }
              tone="soon"
            />
          </div>
        </SectionCard>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <PayeStatCard
            hint={`${report?.summary.unsupported_count ?? 0} unsupported`}
            label="Employees"
            value={String(report?.summary.employees ?? 0)}
          />
          <PayeStatCard label="Total gross" value={money(report?.summary.total_gross)} />
          <PayeStatCard label="Bonus pay" value={money(report?.summary.bonus_pay)} />
          <PayeStatCard label="Commission pay" value={money(report?.summary.commission_pay)} />
          <PayeStatCard label="Additional pay" value={money(report?.summary.component_pay)} />
          <PayeStatCard label="Taxable pay" value={money(report?.summary.taxable_pay)} />
          <PayeStatCard label="PAYE tax" value={money(report?.summary.paye_tax)} />
          <PayeStatCard label="Employee NI" value={money(report?.summary.employee_ni)} />
          <PayeStatCard label="Employer NI" value={money(report?.summary.employer_ni)} />
          <PayeStatCard label="Employee pension" value={money(report?.summary.employee_pension)} />
          <PayeStatCard label="Employer pension" value={money(report?.summary.employer_pension)} />
          <PayeStatCard
            label="Student/Postgraduate"
            value={money((Number(report?.summary.student_loans ?? 0) + Number(report?.summary.postgraduate_loans ?? 0)).toFixed(2))}
          />
          <PayeStatCard emphasize label="Net pay" value={money(report?.summary.net_pay)} />
        </div>

        {report?.message ? <p className="timiq-caption">{report.message}</p> : null}
        {loading ? <p className="timiq-caption">Loading...</p> : null}

        <div className={uiClasses.tableWrap}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Pay period</TableHead>
                <TableHead>Pay date</TableHead>
                <TableHead>Tax code</TableHead>
                <TableHead>NI category</TableHead>
                <TableHead>Gross pay</TableHead>
                <TableHead>Additional pay</TableHead>
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
                    <div className="timiq-caption">{row.employee_email}</div>
                  </TableCell>
                  <TableCell>{periodLabel}</TableCell>
                  <TableCell>{report.period?.pay_date ?? "Not calculated"}</TableCell>
                  <TableCell>{row.tax_code || "Not set"}</TableCell>
                  <TableCell>{row.ni_category || "Not set"}</TableCell>
                  <TableCell>
                    <div>{rowMoney(row, "gross_pay")}</div>
                    {hasHourlyBreakdown(row) ? (
                      <div className={uiClasses.payeTableMeta}>
                        <div>Rate: {money(row.hourly_rate)}</div>
                        <div>
                          Regular: {row.regular_hours ?? "0"}h / {money(row.regular_pay)}
                        </div>
                        <div>
                          Overtime: {row.overtime_hours ?? "0"}h / {money(row.overtime_pay)}
                        </div>
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div>{rowMoney(row, "component_pay")}</div>
                    {componentLockLabel(row) ? (
                      <div className={cn("mt-1", uiClasses.payeTableMeta, "font-semibold")}>{componentLockLabel(row)}</div>
                    ) : (
                      <button
                        className={cn(uiClasses.payeLinkButton, "mt-1")}
                        onClick={() => {
                          setComponentEmployee(row);
                          setEditingComponent(null);
                        }}
                        type="button"
                      >
                        Add bonus/commission
                      </button>
                    )}
                    {components.filter((component) => component.user_id === row.user_id).length ? (
                      <div className={uiClasses.payeTableMeta}>
                        {components
                          .filter((component) => component.user_id === row.user_id)
                          .map((component) => (
                            <div className="flex flex-wrap items-center gap-1" key={component.id}>
                              <span>
                                {component.component_type}: {money(component.amount)}
                              </span>
                              {!componentLockLabel(row) ? (
                                <>
                                  <button
                                    className={uiClasses.payeLinkButton}
                                    onClick={() => {
                                      setComponentEmployee(row);
                                      setEditingComponent(component);
                                    }}
                                    type="button"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    className={cn(uiClasses.payeLinkButton, "text-[var(--color-danger-700)]")}
                                    onClick={() =>
                                      void deletePayePayComponent(component.id)
                                        .then(load)
                                        .catch((e) => setError(e instanceof Error ? e.message : "Could not delete PAYE component."))
                                    }
                                    type="button"
                                  >
                                    Delete
                                  </button>
                                </>
                              ) : null}
                            </div>
                          ))}
                      </div>
                    ) : null}
                  </TableCell>
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
                    {row.unsupported_reason ? (
                      <StatusBadge status="muted">Not supported</StatusBadge>
                    ) : (
                      <StatusBadge status={row.status}>{row.status}</StatusBadge>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.unsupported_reason ? (
                      <span className="text-xs text-[var(--color-warning-700)]">{row.unsupported_reason}</span>
                    ) : canOpenPayePayslip(row) ? (
                      <div className="flex flex-col gap-1">
                        <button
                          className={cn(uiClasses.payeLinkButton, "text-left")}
                          onClick={() => openMonthlyPayePayslip(row.id)}
                          type="button"
                        >
                          View payslip
                        </button>
                        <button
                          className={cn(uiClasses.payeLinkButton, "text-left")}
                          onClick={() =>
                            void downloadMonthlyPayePayslipPdf(row.id).catch((e) =>
                              setError(e instanceof Error ? e.message : "Could not download PAYE payslip PDF."),
                            )
                          }
                          type="button"
                        >
                          Download PDF
                        </button>
                      </div>
                    ) : (
                      <span className="timiq-caption">Managed by period actions</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && (!report || report.rows.length === 0) ? (
                <TableRow>
                  <TableCell className="text-center text-[var(--color-text-muted)]" colSpan={16}>
                    No real PAYE rows yet. Select a company and tax month, then recalculate the month.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </SheetBody>
      {componentEmployee ? (
        <PayePayComponentModal
          companyId={activeCompanyId}
          component={editingComponent}
          employeeName={componentEmployee.employee_name || componentEmployee.employee_email || "Employee"}
          employeeUserId={componentEmployee.user_id}
          locked={Boolean(componentsLocked)}
          onClose={() => {
            setComponentEmployee(null);
            setEditingComponent(null);
          }}
          onSaved={load}
          taxMonth={taxMonth}
          taxYear={TAX_YEAR}
        />
      ) : null}
    </Sheet>
  );
}
