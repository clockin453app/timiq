"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { PageHeader, Sheet, SheetBody, Button } from "../../components/ui";
import {
  downloadMyTaxYearPaySummary,
  downloadPayrollItemPayslipPdf,
  fetchMyPayHistory,
  payrollItemPayslipUrl,
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

function formatWhen(iso: string | null) {
  if (!iso) {
    return "—";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

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

  function openPayslip(row: PayHistoryEntry) {
    if (!payslipAllowed(row)) {
      return;
    }
    window.open(payrollItemPayslipUrl(row.id), "_blank", "noopener,noreferrer");
  }

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

        {!loading && rows.length === 0 ? (
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
          {!loading
            ? rows.map((row) => (
                <div
                  className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm shadow-sm"
                  key={row.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--color-text)]">{periodLabel(row)}</p>
                      <p className="mt-1 truncate text-xs text-[var(--color-text-muted)]">
                        {row.company_name?.trim() ? row.company_name : "—"}
                      </p>
                    </div>
                    <span className="shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-header)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--color-text-soft)]">
                      {payrollStatusLabel(t, row.status)}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-header)] p-2">
                    <div>
                      <dt className="text-[10px] font-bold uppercase text-[var(--color-text-soft)]">Gross</dt>
                      <dd className="tabular-nums font-semibold text-[var(--color-text)]">
                        {row.rate_missing ? "—" : formatMoneyGBP(row.gross_amount)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold uppercase text-[var(--color-text-soft)]">Net pay</dt>
                      <dd className="tabular-nums font-semibold text-[var(--color-text)]">{formatMoneyGBP(netForRow(row))}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold uppercase text-[var(--color-text-soft)]">CIS</dt>
                      <dd className="tabular-nums text-[var(--color-text)]">{formatMoneyGBP(cisForRow(row))}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] font-bold uppercase text-[var(--color-text-soft)]">Hours</dt>
                      <dd className="tabular-nums text-[var(--color-text)]">
                        {formatHoursFromSeconds(row.rounded_total_seconds)} h
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                    {row.paid_at
                      ? `${t("pay_history.paid_at", "Paid")} ${formatWhen(row.paid_at)}`
                      : row.approved_at
                        ? `${t("pay_history.approved_at", "Approved")} ${formatWhen(row.approved_at)}`
                        : hoursSummary(row)}
                  </p>
                  {row.rate_missing ? (
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {t("pay_history.rate_missing", "Rate was not set on calculation.")}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      className="inline-flex items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-cell)]"
                      href={`/pay-history/${encodeURIComponent(row.id)}`}
                    >
                      {t("pay_history.view_payslip", "View payslip")}
                    </Link>
                    <Button
                      className="min-h-9"
                      disabled={!payslipAllowed(row)}
                      onClick={() => openPayslip(row)}
                      type="button"
                      variant="secondary"
                    >
                      {t("pay_history.open_payslip", "View payslip")}
                    </Button>
                    <Button
                      className="min-h-9"
                      disabled={!payslipAllowed(row) || downloadBusyId === row.id}
                      onClick={() => void downloadPayslip(row)}
                      type="button"
                      variant="secondary"
                    >
                      {downloadBusyId === row.id ? t("common.downloading", "Downloading…") : t("common.download", "Download")}
                    </Button>
                  </div>
                </div>
              ))
            : null}
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
                  {t("payroll.payslip", "Payslip")}
                </th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">
                  {t("common.download", "Download")}
                </th>
              </tr>
            </thead>
            <tbody>
              {!loading
                ? rows.map((row) => (
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
                          className="text-xs font-semibold text-[var(--color-text)] underline decoration-[var(--color-border-dark)] underline-offset-2 hover:text-[var(--color-text-muted)] disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
                          disabled={!payslipAllowed(row)}
                          onClick={() => openPayslip(row)}
                          type="button"
                        >
                          {t("pay_history.view_payslip", "View payslip")}
                        </button>
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
