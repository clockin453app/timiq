"use client";

import { useEffect, useMemo, useState } from "react";

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
import {
  downloadMyMonthlyPayePayslipPdf,
  fetchMyPayePayHistory,
  openMyMonthlyPayePayslip,
  type EmployeePayePayHistoryEntry,
} from "../../features/paye-payroll/api";

function money(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return "-";
  }
  return new Intl.NumberFormat("en-GB", { currency: "GBP", style: "currency" }).format(n);
}

function periodLabel(row: EmployeePayePayHistoryEntry): string {
  return `${row.period_start} to ${row.period_end}`;
}

function loanLabel(row: EmployeePayePayHistoryEntry): string {
  const total = Number(row.student_loan || 0) + Number(row.postgraduate_loan_deduction || 0);
  return money(total.toFixed(2));
}

function statusBadgeClass(status: string): string {
  if (status === "approved") return "border-emerald-800/25 bg-emerald-50 text-emerald-900";
  if (status === "paid") return "border-slate-500/25 bg-slate-100 text-slate-900";
  return "border-slate-300 bg-slate-50 text-slate-700";
}

export function PayePayHistoryClient() {
  const [rows, setRows] = useState<EmployeePayePayHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadBusyId, setDownloadBusyId] = useState<string | null>(null);
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => b.pay_date.localeCompare(a.pay_date) || b.tax_month - a.tax_month),
    [rows],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await fetchMyPayePayHistory();
        if (!cancelled) {
          setRows(data);
        }
      } catch (err) {
        if (!cancelled) {
          setRows([]);
          setError(err instanceof Error ? err.message : "Could not load PAYE Pay History.");
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
  }, []);

  async function downloadPayslip(row: EmployeePayePayHistoryEntry) {
    setDownloadBusyId(row.id);
    setError("");
    try {
      await downloadMyMonthlyPayePayslipPdf(row.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download PAYE payslip PDF.");
    } finally {
      setDownloadBusyId(null);
    }
  }

  return (
    <Sheet>
      <PageHeader
        title="PAYE Pay History"
        description="Monthly PAYE payslips for your approved or paid payroll."
      />
      <SheetBody className="space-y-4">
        {error ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        {loading ? <p className="text-sm text-[var(--color-text-muted)]">Loading...</p> : null}

        {!loading && sortedRows.length === 0 ? (
          <div
            className="rounded-[var(--radius-md)] border border-[var(--color-border-dark)] bg-[var(--color-header)] px-4 py-6 text-center text-sm text-[var(--color-text-muted)]"
            role="status"
          >
            <p className="font-medium text-[var(--color-text)]">No PAYE payslips yet.</p>
            <p className="mt-2 leading-relaxed">
              When your monthly PAYE payroll is approved or paid, your payslips will appear here.
            </p>
          </div>
        ) : null}

        <div className="space-y-3 md:hidden">
          {sortedRows.map((row) => (
            <article
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-cell)] p-3 shadow-sm"
              key={row.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-[var(--color-text)]">
                    Tax month {row.tax_month} / {row.tax_year}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{periodLabel(row)}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">Pay date: {row.pay_date}</p>
                </div>
                <p className="text-right text-base font-bold tabular-nums text-[var(--color-text)]">
                  {money(row.net_pay)}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => openMyMonthlyPayePayslip(row.id)} size="sm" type="button">
                  View
                </Button>
                <Button
                  disabled={downloadBusyId === row.id}
                  onClick={() => void downloadPayslip(row)}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  {downloadBusyId === row.id ? "Downloading..." : "Download"}
                </Button>
              </div>
            </article>
          ))}
        </div>

        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pay period</TableHead>
                <TableHead>Tax year / month</TableHead>
                <TableHead>Pay date</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Gross pay</TableHead>
                <TableHead>PAYE tax</TableHead>
                <TableHead>Employee NI</TableHead>
                <TableHead>Pension</TableHead>
                <TableHead>Student/postgraduate loan</TableHead>
                <TableHead>Net pay</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>View</TableHead>
                <TableHead>Download</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{periodLabel(row)}</TableCell>
                  <TableCell>
                    {row.tax_year} / {row.tax_month}
                  </TableCell>
                  <TableCell>{row.pay_date}</TableCell>
                  <TableCell>{row.company_name}</TableCell>
                  <TableCell>{money(row.gross_pay)}</TableCell>
                  <TableCell>{money(row.paye_tax)}</TableCell>
                  <TableCell>{money(row.employee_ni)}</TableCell>
                  <TableCell>{money(row.employee_pension)}</TableCell>
                  <TableCell>{loanLabel(row)}</TableCell>
                  <TableCell>{money(row.net_pay)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(row.status)}`}>
                      {row.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    <button
                      className="text-xs font-semibold text-[var(--color-accent)] underline"
                      onClick={() => openMyMonthlyPayePayslip(row.id)}
                      type="button"
                    >
                      View payslip
                    </button>
                  </TableCell>
                  <TableCell>
                    <button
                      className="text-xs font-semibold text-[var(--color-accent)] underline disabled:opacity-60"
                      disabled={downloadBusyId === row.id}
                      onClick={() => void downloadPayslip(row)}
                      type="button"
                    >
                      {downloadBusyId === row.id ? "Downloading..." : "Download PDF"}
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SheetBody>
    </Sheet>
  );
}
