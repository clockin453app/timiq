"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

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
import { isAdministrator, useCurrentUser, type AuthUser } from "../../features/auth";
import { listCompanies, type Company } from "../../features/companies/api";
import {
  approveAllPending,
  approvePayrollItem,
  downloadPayrollCsv,
  fetchPayrollReport,
  markPayrollPaid,
  openPayrollPrintView,
  patchPayrollItem,
  recalculatePayroll,
  unlockPayrollItem,
  type PayrollItemRow,
  type PayrollReportResponse,
} from "../../features/payroll/api";
import { formatHoursFromSeconds, formatMoney } from "../../features/payroll/format";
import {
  browserDefaultTimeZone,
  mondayWeekStartIso,
} from "../../features/timesheets/week-utils";
function resolveCompanyId(user: AuthUser, override: string | null): string | null {
  if (isAdministrator(user)) {
    return override;
  }
  return user.company_id ?? null;
}

export function PayrollReportClient() {
  const user = useCurrentUser();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyOverride, setCompanyOverride] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(() =>
    mondayWeekStartIso(new Date(), browserDefaultTimeZone()),
  );
  const [report, setReport] = useState<PayrollReportResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<PayrollItemRow | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editOtherDed, setEditOtherDed] = useState("");
  const [editDispTax, setEditDispTax] = useState("");
  const [editDispNet, setEditDispNet] = useState("");
  const [editPaymentMode, setEditPaymentMode] = useState("");

  const activeCompanyId = useMemo(
    () => resolveCompanyId(user, companyOverride),
    [user, companyOverride],
  );

  useEffect(() => {
    if (!isAdministrator(user)) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await listCompanies();
        if (!cancelled) {
          setCompanies(list);
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

  async function loadReport() {
    if (!activeCompanyId) {
      setError("Select a company.");
      setReport(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await fetchPayrollReport(activeCompanyId, weekStart);
      setReport(data);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : "Could not load payroll.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId, weekStart]);

  function openEdit(row: PayrollItemRow) {
    setEditRow(row);
    setEditNotes(row.notes ?? "");
    setEditOtherDed(row.other_deductions_amount ?? "0");
    setEditDispTax(row.display_tax_amount ?? row.tax_amount ?? "");
    setEditDispNet(row.display_net_amount ?? row.net_amount ?? "");
    setEditPaymentMode(row.payment_mode ?? "");
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editRow) {
      return;
    }
    setBusyId(editRow.id);
    setError("");
    try {
      await patchPayrollItem(editRow.id, {
        notes: editNotes || null,
        other_deductions_amount: editOtherDed || null,
        display_tax_amount: editDispTax || null,
        display_net_amount: editDispNet || null,
        payment_mode: editPaymentMode || null,
      });
      setEditRow(null);
      await loadReport();
    } catch {
      setError("Could not save payroll row.");
    } finally {
      setBusyId(null);
    }
  }

  async function runRecalculate() {
    if (!activeCompanyId || !confirm("Recalculate all unpaid rows from time data?")) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await recalculatePayroll(activeCompanyId, weekStart);
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recalculate failed.");
    } finally {
      setLoading(false);
    }
  }

  async function runApproveAll() {
    if (!activeCompanyId || !confirm("Approve all pending rows for this period?")) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await approveAllPending(activeCompanyId, weekStart);
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve all failed.");
    } finally {
      setLoading(false);
    }
  }

  async function rowAction(id: string, action: "approve" | "unlock" | "paid") {
    setBusyId(id);
    setError("");
    try {
      if (action === "approve") {
        await approvePayrollItem(id);
      } else if (action === "unlock") {
        await unlockPayrollItem(id);
      } else {
        await markPayrollPaid(id);
      }
      await loadReport();
    } catch {
      setError("Action failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCsv() {
    if (!activeCompanyId) {
      return;
    }
    try {
      await downloadPayrollCsv(activeCompanyId, weekStart);
    } catch {
      setError("CSV export failed.");
    }
  }

  function handlePrint() {
    if (!activeCompanyId) {
      return;
    }
    openPayrollPrintView(activeCompanyId, weekStart);
  }

  const period = report?.period;

  return (
    <Sheet>
      <PageHeader
        title="Payroll report"
        description="Weekly payroll from rounded time, CIS-style tax, approvals, and paid status."
      />
      <SheetBody className="space-y-3">
        {isAdministrator(user) ? (
          <label className="block max-w-md text-xs font-bold text-[var(--color-text)]">
            Company
            <select
              className="mt-1 h-10 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
              onChange={(event) => setCompanyOverride(event.target.value || null)}
              value={companyOverride ?? ""}
            >
              <option value="">Select company…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">
            Company scope: your assigned company only.
          </p>
        )}

        <WeekPickerBar
          disabled={loading}
          onWeekChange={setWeekStart}
          timezoneLabel={period?.timezone_name}
          weekStartIso={weekStart}
        />

        <div className="flex flex-wrap gap-2">
          <Button disabled={loading || !activeCompanyId} onClick={loadReport} type="button">
            Refresh
          </Button>
          <Button disabled={loading || !activeCompanyId} onClick={runRecalculate} type="button">
            Recalculate
          </Button>
          <Button disabled={loading || !activeCompanyId} onClick={runApproveAll} type="button">
            Approve all pending
          </Button>
          <Button disabled={loading || !activeCompanyId} onClick={handleCsv} type="button">
            Export CSV
          </Button>
          <Button disabled={loading || !activeCompanyId} onClick={handlePrint} type="button">
            Print / PDF
          </Button>
        </div>

        {error ? (
          <div className="border border-[var(--color-danger-700)] bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">
            {error}
          </div>
        ) : null}

        {period && period.total_items > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm">
              <p className="text-xs font-bold uppercase text-[var(--color-text-soft)]">Totals</p>
              <p className="mt-1">
                Reg h: {formatHoursFromSeconds(period.total_regular_seconds)} · OT h:{" "}
                {formatHoursFromSeconds(period.total_overtime_seconds)}
              </p>
            </div>
            <div className="border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm">
              <p className="text-xs font-bold uppercase text-[var(--color-text-soft)]">Money</p>
              <p className="mt-1">
                Gross {formatMoney(period.total_gross)} · CIS {formatMoney(period.total_tax)} · Net{" "}
                {formatMoney(period.total_net)}
              </p>
            </div>
            <div className="border border-[var(--color-border)] bg-[var(--color-cell)] p-3 text-sm">
              <p className="text-xs font-bold uppercase text-[var(--color-text-soft)]">Workflow</p>
              <p className="mt-1">
                Pending {period.pending_count} · Approved {period.approved_count} · Paid{" "}
                {period.paid_count}
              </p>
            </div>
          </div>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Reg h</TableHead>
              <TableHead>OT h</TableHead>
              <TableHead>Gross</TableHead>
              <TableHead>CIS tax</TableHead>
              <TableHead>Other ded.</TableHead>
              <TableHead>Net</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9}>Loading…</TableCell>
              </TableRow>
            ) : null}
            {!loading && report && report.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9}>No payroll rows. Run recalculate.</TableCell>
              </TableRow>
            ) : null}
            {!loading && report
              ? report.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-[10rem] truncate text-xs">
                      {row.employee_name ?? row.employee_email ?? row.user_id}
                    </TableCell>
                    <TableCell className="text-xs">{formatHoursFromSeconds(row.regular_seconds)}</TableCell>
                    <TableCell className="text-xs">{formatHoursFromSeconds(row.overtime_seconds)}</TableCell>
                    <TableCell className="text-xs">
                      {row.rate_missing ? "Rate not set" : formatMoney(row.gross_amount)}
                    </TableCell>
                    <TableCell className="text-xs">{formatMoney(row.display_tax_amount ?? row.tax_amount)}</TableCell>
                    <TableCell className="text-xs">{formatMoney(row.other_deductions_amount)}</TableCell>
                    <TableCell className="text-xs">{formatMoney(row.display_net_amount ?? row.net_amount)}</TableCell>
                    <TableCell className="text-xs">{row.status}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          className="min-h-8 px-2 py-1 text-xs"
                          disabled={busyId === row.id}
                          onClick={() => openEdit(row)}
                          type="button"
                        >
                          Edit
                        </Button>
                        {row.status === "pending" ? (
                          <Button
                            className="min-h-8 px-2 py-1 text-xs"
                            disabled={busyId === row.id}
                            onClick={() => rowAction(row.id, "approve")}
                            type="button"
                          >
                            Approve
                          </Button>
                        ) : null}
                        {row.status === "approved" ? (
                          <>
                            <Button
                              className="min-h-8 px-2 py-1 text-xs"
                              disabled={busyId === row.id}
                              onClick={() => rowAction(row.id, "unlock")}
                              type="button"
                            >
                              Unlock
                            </Button>
                            <Button
                              className="min-h-8 px-2 py-1 text-xs"
                              disabled={busyId === row.id}
                              onClick={() => rowAction(row.id, "paid")}
                              type="button"
                            >
                              Mark paid
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              : null}
          </TableBody>
        </Table>

        {editRow ? (
          <div
            aria-modal="true"
            className="fixed inset-0 z-[2100] flex items-start justify-center overflow-y-auto bg-black/45 p-3 md:p-6"
            role="dialog"
          >
            <div className="timiq-sheet my-4 w-full max-w-lg border border-[var(--color-border-dark)] bg-[var(--color-sheet)] p-4 shadow-md">
              <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border-dark)] pb-3">
                <p className="text-sm font-bold text-[var(--color-text)]">Edit payroll row</p>
                <Button onClick={() => setEditRow(null)} type="button">
                  Close
                </Button>
              </div>
              <form className="mt-4 space-y-2 text-sm" onSubmit={saveEdit}>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {editRow.employee_email} · Total rounded h:{" "}
                  {formatHoursFromSeconds(editRow.rounded_total_seconds)}
                </p>
                <label className="block text-xs font-bold">
                  Notes
                  <textarea
                    className="mt-1 min-h-[3rem] w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 py-1 text-sm"
                    onChange={(event) => setEditNotes(event.target.value)}
                    value={editNotes}
                  />
                </label>
                <label className="block text-xs font-bold">
                  Other deductions
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setEditOtherDed(event.target.value)}
                    type="text"
                    value={editOtherDed}
                  />
                </label>
                <label className="block text-xs font-bold">
                  Display CIS tax
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setEditDispTax(event.target.value)}
                    type="text"
                    value={editDispTax}
                  />
                </label>
                <label className="block text-xs font-bold">
                  Display net
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setEditDispNet(event.target.value)}
                    type="text"
                    value={editDispNet}
                  />
                </label>
                <label className="block text-xs font-bold">
                  Payment mode
                  <input
                    className="mt-1 h-9 w-full border border-[var(--color-border-dark)] bg-[var(--color-input)] px-2 text-sm"
                    onChange={(event) => setEditPaymentMode(event.target.value)}
                    type="text"
                    value={editPaymentMode}
                  />
                </label>
                <Button disabled={busyId === editRow.id} type="submit">
                  {busyId === editRow.id ? "Saving…" : "Save edits"}
                </Button>
              </form>
            </div>
          </div>
        ) : null}
      </SheetBody>
    </Sheet>
  );
}
