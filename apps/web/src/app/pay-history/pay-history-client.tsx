"use client";

import { useEffect, useState } from "react";

import { PageHeader, Sheet, SheetBody } from "../../components/ui";
import { fetchMyPayHistory, type PayHistoryEntry } from "../../features/payroll/api";
import {
  effectiveDisplayedTaxAmount,
  formatHoursFromSeconds,
  formatMoney,
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

  return (
    <Sheet>
      <PageHeader
        title="Pay history"
        description="Approved and paid payroll periods only."
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
          <p className="text-sm text-[var(--color-text-muted)]">No approved or paid payroll yet.</p>
        ) : null}

        <div className="space-y-2 md:hidden">
          {!loading
            ? rows.map((row) => (
                <div
                  className="border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm"
                  key={row.id}
                >
                  <p className="font-semibold text-[var(--color-text)]">
                    Week {row.week_start}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    Reg {formatHoursFromSeconds(row.regular_seconds)} h · OT{" "}
                    {formatHoursFromSeconds(row.overtime_seconds)} h
                  </p>
                  <p className="mt-2">
                    Gross {formatMoney(row.gross_amount)} · CIS{" "}
                    {formatMoney(effectiveDisplayedTaxAmount(row.display_tax_amount, row.tax_amount))} · Net{" "}
                    {formatMoney(row.display_net_amount ?? row.net_amount)}
                  </p>
                  <p className="mt-1 text-xs">
                    {row.status}
                    {row.approved_at ? ` · Approved ${formatWhen(row.approved_at)}` : ""}
                    {row.paid_at ? ` · Paid ${formatWhen(row.paid_at)}` : ""}
                  </p>
                  {row.rate_missing ? (
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">Rate was not set on calculation.</p>
                  ) : null}
                </div>
              ))
            : null}
        </div>

        <div className="hidden md:block">
          <table className="w-full border-collapse border border-[var(--color-border-dark)] text-sm">
            <thead>
              <tr className="bg-[var(--color-header)]">
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">Week</th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">Status</th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">Hours</th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">Gross</th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">CIS</th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">Net</th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">Approved</th>
                <th className="border border-[var(--color-border)] px-2 py-2 text-left">Paid</th>
              </tr>
            </thead>
            <tbody>
              {!loading
                ? rows.map((row) => (
                    <tr key={row.id}>
                      <td className="border border-[var(--color-border)] px-2 py-2">{row.week_start}</td>
                      <td className="border border-[var(--color-border)] px-2 py-2">{row.status}</td>
                      <td className="border border-[var(--color-border)] px-2 py-2">
                        {formatHoursFromSeconds(row.regular_seconds)} /{" "}
                        {formatHoursFromSeconds(row.overtime_seconds)}
                      </td>
                      <td className="border border-[var(--color-border)] px-2 py-2">
                        {row.rate_missing ? "—" : formatMoney(row.gross_amount)}
                      </td>
                      <td className="border border-[var(--color-border)] px-2 py-2">
                        {formatMoney(
                          effectiveDisplayedTaxAmount(row.display_tax_amount, row.tax_amount),
                        )}
                      </td>
                      <td className="border border-[var(--color-border)] px-2 py-2">
                        {formatMoney(row.display_net_amount ?? row.net_amount)}
                      </td>
                      <td className="border border-[var(--color-border)] px-2 py-2">
                        {formatWhen(row.approved_at)}
                      </td>
                      <td className="border border-[var(--color-border)] px-2 py-2">
                        {formatWhen(row.paid_at)}
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
