"use client";

import { useEffect, useState } from "react";

import { PageHeader, Sheet, SheetBody } from "../../components/ui";
import { fetchMyPayHistory, payrollItemPayslipUrl, type PayHistoryEntry } from "../../features/payroll/api";
import {
  effectiveDisplayedTaxAmount,
  formatHoursFromSeconds,
  formatMoney,
  formatPayrollWeekRangeLabel,
} from "../../features/payroll/format";

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
  return effectiveDisplayedTaxAmount(row.display_tax_amount, row.tax_amount);
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

export function PayHistoryClient() {
  const [rows, setRows] = useState<PayHistoryEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await fetchMyPayHistory();
      setRows(data);
    } catch {
      setRows([]);
      setError("Could not load pay history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openPayslip(row: PayHistoryEntry) {
    if (row.can_open_payslip === false) {
      return;
    }
    window.open(payrollItemPayslipUrl(row.id), "_blank", "noopener,noreferrer");
  }

  return (
    <Sheet>
      <PageHeader
        title="Pay history"
        description="Approved and paid payroll only. Open payslip uses your signed-in session; nothing is publicly linked."
      />
      <SheetBody className="space-y-3">
        {error ? (
          <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
        ) : null}

        {!loading && rows.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            No approved or paid payroll yet. When payroll is approved for you, it will appear here.
          </p>
        ) : null}

        <div className="space-y-2 md:hidden">
          {!loading
            ? rows.map((row) => (
                <div
                  className="border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm"
                  key={row.id}
                >
                  <p className="font-semibold text-[var(--color-text)]">{periodLabel(row)}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{hoursSummary(row)}</p>
                  <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                    {row.company_name?.trim() ? row.company_name : "—"}
                  </p>
                  <p className="mt-2">
                    Gross {row.rate_missing ? "—" : formatMoney(row.gross_amount)} · CIS {formatMoney(cisForRow(row))}{" "}
                    · Net {formatMoney(netForRow(row))}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {row.status}
                    {row.approved_at ? ` · Approved ${formatWhen(row.approved_at)}` : ""}
                    {row.paid_at ? ` · Paid ${formatWhen(row.paid_at)}` : ""}
                  </p>
                  {row.rate_missing ? (
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">Rate was not set on calculation.</p>
                  ) : null}
                  <div className="mt-2">
                    <button
                      className="rounded-[var(--radius-sm)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-cell)]"
                      onClick={() => openPayslip(row)}
                      type="button"
                    >
                      Open payslip
                    </button>
                  </div>
                </div>
              ))
            : null}
        </div>

        <div className="hidden md:block">
          <table className="w-full border-collapse border border-[var(--color-border-dark)] text-sm">
            <thead>
              <tr className="bg-[var(--color-header)]">
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">Period</th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">Hours</th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">Gross</th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">CIS tax</th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">Take home</th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">Company</th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">Payslip</th>
              </tr>
            </thead>
            <tbody>
              {!loading
                ? rows.map((row) => (
                    <tr key={row.id}>
                      <td className="border border-[var(--color-border)] px-2 py-2 text-xs leading-snug">
                        {periodLabel(row)}
                      </td>
                      <td className="border border-[var(--color-border)] px-2 py-2 text-xs">{hoursSummary(row)}</td>
                      <td className="border border-[var(--color-border)] px-2 py-2 tabular-nums">
                        {row.rate_missing ? "—" : formatMoney(row.gross_amount)}
                      </td>
                      <td className="border border-[var(--color-border)] px-2 py-2 tabular-nums">
                        {formatMoney(cisForRow(row))}
                      </td>
                      <td className="border border-[var(--color-border)] px-2 py-2 tabular-nums">
                        {formatMoney(netForRow(row))}
                      </td>
                      <td className="border border-[var(--color-border)] px-2 py-2 text-xs">
                        {row.company_name?.trim() ? row.company_name : "—"}
                      </td>
                      <td className="border border-[var(--color-border)] px-2 py-2">
                        <button
                          className="text-xs font-semibold text-[var(--color-text)] underline decoration-[var(--color-border-dark)] underline-offset-2 hover:text-[var(--color-text-muted)]"
                          onClick={() => openPayslip(row)}
                          type="button"
                        >
                          Open
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
