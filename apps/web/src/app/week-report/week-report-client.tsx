"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { WeekPickerBar } from "../../components/week-picker-bar";
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
import { canAccessManagement, isAdministrator, useCurrentUser } from "../../features/auth";
import { CompanySelector } from "../../features/companies/company-selector";
import { listCompanies, type Company } from "../../features/companies/api";
import { useAdministratorCompanyScope } from "../../features/companies/selected-company";
import { BreakDeductionCell } from "../../features/time-records/break-deduction-cell";
import { formatDurationSeconds } from "../../features/time-records/format-duration";
import { PayrollRoundingHint } from "../../features/time-records/payroll-rounding-hint";
import {
  downloadAdminCompanyWeekReportCsv,
  downloadAdminEmployeeWeekReportCsv,
  fetchAdminCompanyWeekReport,
  type AdminWeekReportAllEmployeesResponse,
  type AdminWeekReportEmployeeSummary,
} from "../../features/timesheets/api";
import {
  browserDefaultTimeZone,
  mondayWeekStartIso,
} from "../../features/timesheets/week-utils";
import { useT } from "../../lib/i18n";
import { formatPayrollWeekUkLabel } from "../../lib/week-label";

function employeeCell(name: string | null | undefined, email: string) {
  const n = name?.trim();
  if (n) {
    return `${n} (${email})`;
  }
  return email;
}

function statusNotes(
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string,
  row: AdminWeekReportEmployeeSummary,
): string {
  const parts: string[] = [];
  if (row.open_shift_in_week) {
    parts.push(t("week_report.open_shift", "Open shift"));
  }
  const leaveCount = row.week_leave?.length ?? 0;
  if (leaveCount > 0) {
    parts.push(t("week_report.leave_count", "{{count}} leave", { count: leaveCount }));
  }
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function EmployeeWeekReportGate() {
  const t = useT();
  return (
    <Sheet>
      <PageHeader
        description={t(
          "week_report.employee_gate_description",
          "Company week summaries are available to managers only.",
        )}
        title={t("week_report.title", "Week report")}
      />
      <SheetBody className="min-w-0 space-y-3 md:p-5">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-5 text-sm text-[var(--color-text)]">
          <p className="font-semibold">{t("week_report.employee_gate_title", "This page is for managers")}</p>
          <p className="mt-2 text-[var(--color-text-muted)]">
            {t(
              "week_report.employee_gate_body",
              "Your own hours and breaks are on Timesheets. Pay summaries are on Pay History.",
            )}
          </p>
          <Link
            className="mt-4 inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-btn-secondary-bg)] px-4 text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-cell)]"
            href="/timesheets"
          >
            {t("week_report.go_timesheets", "Go to timesheets")}
          </Link>
        </div>
      </SheetBody>
    </Sheet>
  );
}

function AdminWeekReportTable() {
  const t = useT();
  const user = useCurrentUser();

  const [weekStart, setWeekStart] = useState(() =>
    mondayWeekStartIso(new Date(), browserDefaultTimeZone()),
  );
  const [companyReport, setCompanyReport] = useState<AdminWeekReportAllEmployeesResponse | null>(
    null,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<Company[]>([]);
  const companyScope = useAdministratorCompanyScope(user, companies);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [rowExportUserId, setRowExportUserId] = useState<string | null>(null);

  const activeCompanyId = useMemo(() => {
    if (isAdministrator(user)) {
      return companyScope.companyId;
    }
    return user.company_id;
  }, [user, companyScope.companyId]);

  const timezoneLabel = companyReport?.company_timezone;
  const weekLabel =
    companyReport?.company_timezone != null
      ? formatPayrollWeekUkLabel(weekStart, companyReport.company_timezone)
      : null;

  const needsCompany = companyScope.needsCompanySelection;

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
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        if (isAdministrator(user) && !activeCompanyId) {
          setCompanyReport(null);
          setError("Select a company.");
          return;
        }
        if (!isAdministrator(user) && !user.company_id) {
          setCompanyReport(null);
          setError("Your account is not linked to a company.");
          return;
        }
        const data = await fetchAdminCompanyWeekReport(
          weekStart,
          isAdministrator(user) ? activeCompanyId : null,
        );
        if (!cancelled) {
          setCompanyReport(data);
        }
      } catch {
        if (!cancelled) {
          setCompanyReport(null);
          setError("Could not load week report.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [weekStart, activeCompanyId, user]);

  const openBanner = Boolean(
    companyReport && companyReport.totals.employees_with_open_shift > 0,
  );

  const hasExportableData = Boolean(
    !loading && !error && companyReport && companyReport.totals.completed_shifts_count > 0,
  );

  async function handleExportCompanyCsv() {
    setExportError("");
    setExportBusy(true);
    try {
      if (isAdministrator(user) && !activeCompanyId) {
        setExportError("Select a company.");
        return;
      }
      await downloadAdminCompanyWeekReportCsv(
        weekStart,
        isAdministrator(user) ? activeCompanyId : null,
      );
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExportBusy(false);
    }
  }

  async function handleRowDownload(userId: string) {
    setExportError("");
    setRowExportUserId(userId);
    try {
      if (isAdministrator(user) && !activeCompanyId) {
        setExportError("Select a company.");
        return;
      }
      await downloadAdminEmployeeWeekReportCsv(
        userId,
        weekStart,
        isAdministrator(user) ? activeCompanyId : null,
      );
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setRowExportUserId(null);
    }
  }

  return (
    <Sheet>
      <PageHeader
        description={t(
          "week_report.admin_description",
          "Company payroll week summary per employee. Download one row as CSV for payroll or records.",
        )}
        title={t("week_report.title", "Week report")}
      />
      <SheetBody className="min-w-0 space-y-3 md:p-5">
        {isAdministrator(user) ? (
          <label className="block max-w-md text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
            <span className="text-[var(--color-text)]">{t("week_report.company", "Company")}</span>
            <select
              className="mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]"
              onChange={(event) => companyScope.setCompanyId(event.target.value)}
              value={companyScope.companyId ?? ""}
            >
              <option value="">{t("week_report.choose_company", "Choose company…")}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">
            <WeekPickerBar
              disabled={loading || needsCompany}
              onWeekChange={setWeekStart}
              payrollTimeZone={companyReport?.company_timezone}
              timezoneLabel={timezoneLabel}
              weekStartIso={weekStart}
            />
            {weekLabel ? (
              <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">{weekLabel}</p>
            ) : null}
          </div>
          <Button
            className="h-10 w-full shrink-0 sm:w-auto"
            disabled={exportBusy || !hasExportableData || needsCompany}
            onClick={() => void handleExportCompanyCsv()}
            type="button"
            variant="secondary"
          >
            {exportBusy
              ? t("week_report.exporting", "Exporting…")
              : t("week_report.export_all", "Export all (CSV)")}
          </Button>
        </div>

        {exportError ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2.5 text-sm text-[var(--color-danger-700)]">
            {exportError}
          </div>
        ) : null}

        {openBanner ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] border-l-4 border-l-[var(--color-warning-700)] bg-[var(--color-header)] px-3 py-2.5 text-sm text-[var(--color-text)]">
            {t(
              "week_report.open_shift_banner",
              "One or more employees have an open shift this week — completed totals exclude open shifts.",
            )}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2.5 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            {t("week_report.loading_week", "Loading week…")}
          </p>
        ) : null}

        {!loading && companyReport && !needsCompany ? (
          <div className="space-y-2 overflow-x-auto">
            <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
              <span className="font-semibold text-[var(--color-text)]">
                {t("week_report.legend_clocked", "Clocked")}
              </span>
              {t("week_report.legend_raw", " = raw time.")}{" "}
              <span className="font-semibold text-[var(--color-text)]">
                {t("week_report.legend_payable", "Payable")}
              </span>
              {t("week_report.legend_after_policy", " = after policy.")}{" "}
              <span className="font-semibold text-[var(--color-text)]">
                {t("week_report.legend_payroll", "Payroll")}
              </span>
              {t("week_report.legend_rounded", " = rounded for payroll.")}
            </p>
            <PayrollRoundingHint
              clockedSeconds={companyReport.totals.clocked_seconds}
              payableSeconds={companyReport.totals.payable_seconds}
              payrollSeconds={companyReport.totals.payroll_seconds}
            />
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("week_report.col_employee", "Employee")}</TableHead>
                  <TableHead>{t("week_report.col_location", "Site")}</TableHead>
                  <TableHead>{t("week_report.col_completed_shifts", "Shifts")}</TableHead>
                  <TableHead>{t("week_report.col_clocked", "Clocked")}</TableHead>
                  <TableHead>{t("week_report.col_payable", "Payable")}</TableHead>
                  <TableHead>{t("week_report.col_payroll", "Payroll")}</TableHead>
                  <TableHead>{t("week_report.col_break", "Break")}</TableHead>
                  <TableHead>{t("week_report.col_notes", "Status")}</TableHead>
                  <TableHead className="text-right">{t("week_report.download_row", "Download")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companyReport.employees.map((row) => (
                  <TableRow key={row.user_id}>
                    <TableCell className="max-w-[200px] text-xs">
                      {employeeCell(row.employee_name, row.employee_email)}
                    </TableCell>
                    <TableCell className="max-w-[180px] text-xs text-[var(--color-text-muted)]">
                      {row.locations_worked.length > 0 ? row.locations_worked.join(", ") : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-xs">{row.completed_shifts_count}</TableCell>
                    <TableCell className="tabular-nums text-xs">
                      {formatDurationSeconds(row.clocked_seconds)}
                    </TableCell>
                    <TableCell className="tabular-nums text-xs">
                      {formatDurationSeconds(row.payable_seconds)}
                    </TableCell>
                    <TableCell className="tabular-nums text-xs">
                      {formatDurationSeconds(row.payroll_seconds)}
                    </TableCell>
                    <TableCell className="text-xs">
                      <BreakDeductionCell seconds={row.break_seconds} />
                    </TableCell>
                    <TableCell className="text-xs text-[var(--color-text-muted)]">{statusNotes(t, row)}</TableCell>
                    <TableCell className="text-right text-xs">
                      <Button
                        className="h-8 px-2.5 text-xs"
                        disabled={rowExportUserId === row.user_id}
                        onClick={() => void handleRowDownload(row.user_id)}
                        type="button"
                        variant="secondary"
                      >
                        {rowExportUserId === row.user_id ? "…" : "CSV"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="timiq-table-total-row">
                  <TableCell className="font-semibold" colSpan={2}>
                    Company total
                  </TableCell>
                  <TableCell className="tabular-nums text-xs font-semibold">
                    {companyReport.totals.completed_shifts_count}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs font-semibold">
                    {formatDurationSeconds(companyReport.totals.clocked_seconds)}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs font-semibold">
                    {formatDurationSeconds(companyReport.totals.payable_seconds)}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs font-semibold">
                    {formatDurationSeconds(companyReport.totals.payroll_seconds)}
                  </TableCell>
                  <TableCell className="text-xs font-semibold">
                    <BreakDeductionCell seconds={companyReport.totals.break_seconds} />
                  </TableCell>
                  <TableCell className="text-xs font-semibold">
                    {companyReport.totals.employees_with_open_shift > 0
                      ? `${companyReport.totals.employees_with_open_shift} open`
                      : "—"}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
            {companyReport.totals.completed_shifts_count === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">
                No completed shifts this week. Active employees with zero time are listed above.
              </p>
            ) : null}
          </div>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}

export function WeekReportClient() {
  const user = useCurrentUser();
  const management = canAccessManagement(user);

  if (!management) {
    return <EmployeeWeekReportGate />;
  }

  return <AdminWeekReportTable />;
}
