"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { PageHeader, Sheet, SheetBody, Button } from "../../components/ui";
import {
  downloadMyTaxYearPaySummary,
  downloadPayrollItemPayslipPdf,
  fetchMyPayHistory,
  type PayHistoryEntry,
} from "../../features/payroll/api";
import {
  effectiveDisplayedTaxAmount,
  formatHoursFromSeconds,
  formatMoneyGBP,
  formatPayrollWeekRangeLabel,
} from "../../features/payroll/format";
import { payrollStatusLabel } from "../../lib/i18n/display-labels";
import { useT } from "../../lib/i18n";

function periodLabel(row: PayHistoryEntry): string {
  const tz = row.timezone_name?.trim() || "UTC";
  return formatPayrollWeekRangeLabel(row.week_start, tz);
}

function cisForRow(row: PayHistoryEntry): string | null | undefined {
  if (
    row.effective_cis_tax_amount !== undefined &&
    row.effective_cis_tax_amount !== null &&
    row.effective_cis_tax_amount !== ""
  ) {
    return row.effective_cis_tax_amount;
  }
  return effectiveDisplayedTaxAmount(row.display_tax_amount, row.tax_amount, row.payment_mode);
}

function netForRow(row: PayHistoryEntry): string | null | undefined {
  if (
    row.effective_net_amount !== undefined &&
    row.effective_net_amount !== null &&
    row.effective_net_amount !== ""
  ) {
    return row.effective_net_amount;
  }
  return row.display_net_amount ?? row.net_amount;
}

function hoursSummary(row: PayHistoryEntry): string {
  const reg = formatHoursFromSeconds(row.regular_seconds);
  const ot = formatHoursFromSeconds(row.overtime_seconds);
  const tot = formatHoursFromSeconds(row.rounded_total_seconds);
  return `${reg} / ${ot} h (rounded ${tot} h)`;
}

function numericValue(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function hasVisiblePayValue(row: PayHistoryEntry): boolean {
  return (
    numericValue(row.gross_amount) > 0 ||
    numericValue(netForRow(row)) > 0 ||
    numericValue(cisForRow(row)) > 0 ||
    numericValue(row.other_deductions_amount) > 0 ||
    row.rounded_total_seconds > 0
  );
}

function currentUkTaxYearValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const taxYearStart = new Date(year, 3, 6);
  const start = now >= taxYearStart ? year : year - 1;
  return `${start}-${start + 1}`;
}

function taxYearOptions(): string[] {
  const current = currentUkTaxYearValue();
  const start = Number(current.slice(0, 4));
  return [start, start - 1, start - 2, start - 3].map((year) => `${year}-${year + 1}`);
}

function taxYearLabel(value: string): string {
  return value.replace("-", "/");
}


function payslipAllowed(row: PayHistoryEntry): boolean {
  return row.can_open_payslip !== false;
}

export function PayHistoryClient() {
  const t = useT();
  const [rows, setRows] = useState<PayHistoryEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedTaxYear, setSelectedTaxYear] = useState(currentUkTaxYearValue);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [downloadBusyId, setDownloadBusyId] = useState<string | null>(null);
  const taxYears = useMemo(() => taxYearOptions(), []);
  const visibleRows = useMemo(() => rows.filter(hasVisiblePayValue), [rows]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await fetchMyPayHistory();
      setRows(data);
    } catch {
      setRows([]);
      setError(t("pay_history.load_error", "Could not load pay history."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function downloadPayslip(row: PayHistoryEntry) {
    if (!payslipAllowed(row)) {
      return;
    }
    setDownloadBusyId(row.id);
    try {
      await downloadPayrollItemPayslipPdf(row.id, `timiq-payslip-week-${row.week_start}.pdf`);
    } finally {
      setDownloadBusyId(null);
    }
  }

  async function handleDownloadSummary() {
    setSummaryError("");
    setSummaryBusy(true);
    try {
      await downloadMyTaxYearPaySummary(selectedTaxYear);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : t("pay_history.summary_download_failed", "Could not download pay summary."));
    } finally {
      setSummaryBusy(false);
    }
  }

  return (
    <Sheet>
      <PageHeader
        title={t("pay_history.title", "Pay history")}
        description={t(
          "pay_history.page_description",
          "Approved and paid payroll only. Figures come from the server. Payslips open in a new tab using your signed-in session.",
        )}
      />
      <SheetBody className="space-y-4">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] p-3 text-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <label className="block max-w-xs text-xs font-bold uppercase tracking-wide text-[var(--color-text-soft)]">
              <span className="text-[var(--color-text)]">{t("pay_history.select_tax_year", "Select Tax Year")}</span>
              <select
                className="timiq-select mt-1.5 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2.5 text-sm text-[var(--color-text)]"
                onChange={(event) => setSelectedTaxYear(event.target.value)}
                value={selectedTaxYear}
              >
                {taxYears.map((year) => (
                  <option key={year} value={year}>
                    {taxYearLabel(year)}
                  </option>
                ))}
              </select>
            </label>
            <Button disabled={summaryBusy} onClick={() => void handleDownloadSummary()} type="button">
              {summaryBusy
                ? t("pay_history.summary_downloading", "Downloading…")
                : t("pay_history.download_summary", "Download Pay Summary")}
            </Button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
            {t(
              "pay_history.summary_hint",
              "Downloads a paid-payroll XLSX summary for the selected UK tax year.",
            )}
          </p>
          {summaryError ? (
            <p className="mt-2 text-sm text-[var(--color-danger-700)]">{summaryError}</p>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">{t("common.loading", "Loading…")}</p>
        ) : null}

        {!loading && visibleRows.length === 0 ? (
          <div
            className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-6 text-center text-sm text-[var(--color-text-muted)]"
            role="status"
          >
            <p className="font-medium text-[var(--color-text)]">
              {t("pay_history.empty_title", "No pay history yet")}
            </p>
            <p className="mt-2 leading-relaxed">
              {t(
                "pay_history.empty_body",
                "When payroll for you is approved or marked paid, it will show here. You can open a week for details and print a payslip.",
              )}
            </p>
          </div>
        ) : null}

        <div className="space-y-2 md:hidden">
          {!loading && visibleRows.length > 0 ? (
            <>
              <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-1 text-[11px] font-medium text-[var(--color-text-muted)]">
                <span>Period</span>
                <span className="text-right">Gross Earnings</span>
                <span className="text-right">Download</span>
              </div>
              {visibleRows.map((row) => (
                <div
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-3 text-sm shadow-sm"
                  key={row.id}
                >
                  <Link
                    className="min-w-0 font-semibold text-[var(--color-text)] hover:underline"
                    href={`/pay-history/${encodeURIComponent(row.id)}`}
                  >
                    {periodLabel(row)}
                  </Link>
                  <span className="whitespace-nowrap text-right text-xs font-semibold tabular-nums text-[var(--color-text)]">
                    {row.rate_missing ? "—" : formatMoneyGBP(row.gross_amount)}
                  </span>
                  <button
                    aria-label={`Download payslip for ${periodLabel(row)}`}
                    className="inline-flex h-9 min-w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-2 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-cell)] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!payslipAllowed(row) || downloadBusyId === row.id}
                    onClick={() => void downloadPayslip(row)}
                    type="button"
                  >
                    {downloadBusyId === row.id ? "..." : "PDF"}
                  </button>
                </div>
              ))}
            </>
          ) : null}
        </div>

        <div className="hidden min-w-0 overflow-x-auto md:block">
          <table className="w-full min-w-[56rem] border-collapse border border-[var(--color-border-dark)] text-sm">
            <thead>
              <tr className="bg-[var(--color-header)]">
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">
                  {t("pay_history.col_period", "Period")}
                </th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">
                  {t("pay_history.col_company", "Company")}
                </th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">
                  {t("pay_history.col_hours", "Hours")}
                </th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">
                  {t("pay_history.col_gross", "Gross pay")}
                </th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">
                  {t("payroll.cis_tax", "CIS tax")}
                </th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">
                  {t("pay_history.col_net", "Net pay")}
                </th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">
                  {t("pay_history.col_status", "Status")}
                </th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">
                  {t("pay_history.col_view", "View")}
                </th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">
                  {t("common.download", "Download")}
                </th>
              </tr>
            </thead>
            <tbody>
              {!loading
                ? visibleRows.map((row) => (
                    <tr key={row.id}>
                      <td className="border border-[var(--color-border)] px-2 py-2 text-xs leading-snug">
                        {periodLabel(row)}
                      </td>
                      <td className="border border-[var(--color-border)] px-2 py-2 text-xs">
                        {row.company_name?.trim() ? row.company_name : "—"}
                      </td>
                      <td className="border border-[var(--color-border)] px-2 py-2 text-xs">{hoursSummary(row)}</td>
                      <td className="border border-[var(--color-border)] px-2 py-2 tabular-nums">
                        {row.rate_missing ? "—" : formatMoneyGBP(row.gross_amount)}
                      </td>
                      <td className="border border-[var(--color-border)] px-2 py-2 tabular-nums">
                        {formatMoneyGBP(cisForRow(row))}
                      </td>
                      <td className="border border-[var(--color-border)] px-2 py-2 tabular-nums">
                        {formatMoneyGBP(netForRow(row))}
                      </td>
                      <td className="border border-[var(--color-border)] px-2 py-2 text-xs">
                        {payrollStatusLabel(t, row.status)}
                      </td>
                      <td className="border border-[var(--color-border)] px-2 py-2">
                        <Link
                          className="text-xs font-semibold text-[var(--color-text)] underline decoration-[var(--color-border-dark)] underline-offset-2 hover:text-[var(--color-text-muted)]"
                          href={`/pay-history/${encodeURIComponent(row.id)}`}
                        >
                          {t("pay_history.view_payslip", "View payslip")}
                        </Link>
                      </td>
                      <td className="border border-[var(--color-border)] px-2 py-2">
                        <button
                          aria-label={`Download payslip for ${periodLabel(row)}`}
                          className="text-xs font-semibold text-[var(--color-text)] underline decoration-[var(--color-border-dark)] underline-offset-2 hover:text-[var(--color-text-muted)] disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
                          disabled={!payslipAllowed(row) || downloadBusyId === row.id}
                          onClick={() => void downloadPayslip(row)}
                          type="button"
                        >
                          {downloadBusyId === row.id ? t("common.downloading", "Downloading…") : t("common.download", "Download")}
                        </button>
                      </td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        </div>
      </SheetBody>
    </Sheet>
  );
}
