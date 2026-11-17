"use client";

import { Fragment, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { columnsForWidth, formatGbp, registerNotice, type CustomerView, type SupplierView } from "./presentation";

export function EditorDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-sheet)] p-4 shadow-lg">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>Close</Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SummaryStrip({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded border border-[var(--color-border)] bg-[var(--color-cell)] px-3 py-2">
          <dt className="text-xs text-[var(--color-text-muted)]">{item.label}</dt>
          <dd className="text-sm font-semibold tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RegisterMessage({ loading, error, count }: { loading: boolean; error: string; count: number }) {
  const notice = registerNotice({ loading, error, count });
  if (!notice) return null;
  if (error) return <p className="border border-red-700 bg-red-50 px-2 py-1 text-sm text-red-900">{notice}</p>;
  return <p className="text-sm text-[var(--color-text-muted)]">{notice}</p>;
}

function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return <ul className="mt-1 list-disc pl-4 text-xs text-amber-900">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>;
}

export function SupplierRegister({ rows, width, loading, error }: { rows: SupplierView[]; width: number; loading: boolean; error: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const columns = columnsForWidth("supplier", width);
  return (
    <div>
      <RegisterMessage loading={loading} error={error} count={rows.length} />
      {rows.length > 0 ? (
        <div className="overflow-hidden rounded border border-[var(--color-border)]">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <thead className="bg-[var(--color-cell)]">
              <tr>{columns.map((column) => <th key={column} className="border-b px-2 py-1 font-medium">{column}</th>)}<th className="w-16 border-b px-2 py-1 font-medium"> </th></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <Fragment key={`${row.reference}-${row.status}-${index}`}>
                  <tr className="odd:bg-white even:bg-[var(--color-cell)]">
                    {columns.map((column) => <td key={column} className="truncate px-2 py-1 tabular-nums" title={cell(row, column)}>{cell(row, column)}</td>)}
                    <td className="px-2 py-1"><button className="underline" type="button" onClick={() => setOpen(open === index ? null : index)}>{open === index ? "Hide" : "Details"}</button></td>
                  </tr>
                  {open === index ? (
                    <tr>
                      <td className="px-2 py-2 text-sm" colSpan={columns.length + 1}>
                        <p>Posted gross {row.gross} minus posted bank allocations {row.paid} leaves outstanding {row.outstanding}. {row.paymentReferences ? `Source payment ${row.paymentReferences}.` : "No posted payment reference is linked."} Draft rows stay out of these totals.</p>
                        <WarningList warnings={row.warnings} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function cell(row: SupplierView | CustomerView, column: string): string {
  if ("supplier" in row) {
    if (column === "Supplier") return row.supplier;
    if (column === "Invoice reference" || column === "Reference") return row.reference;
    if (column === "Date") return row.date;
    if (column === "Gross") return row.gross;
    if (column === "Paid") return row.paid;
    if (column === "Outstanding") return row.outstanding;
    return row.status;
  }
  if (column === "Customer") return row.customer;
  if (column === "Invoice reference" || column === "Reference") return row.reference;
  if (column === "Due date") return row.due;
  if (column === "Gross") return row.gross;
  if (column === "Received") return row.received;
  if (column === "Outstanding") return row.outstanding;
  return row.status;
}

export function CustomerRegister({ rows, width, loading, error }: { rows: CustomerView[]; width: number; loading: boolean; error: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const columns = columnsForWidth("customer", width);
  return (
    <div>
      <RegisterMessage loading={loading} error={error} count={rows.length} />
      {rows.length > 0 ? (
        <div className="overflow-hidden rounded border border-[var(--color-border)]">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <thead className="bg-[var(--color-cell)]">
              <tr>{columns.map((column) => <th key={column} className="border-b px-2 py-1 font-medium">{column}</th>)}<th className="w-16 border-b px-2 py-1 font-medium"> </th></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <Fragment key={`${row.reference}-${row.status}-${index}`}>
                  <tr className="odd:bg-white even:bg-[var(--color-cell)]">
                    {columns.map((column) => <td key={column} className="truncate px-2 py-1 tabular-nums">{cell(row, column)}</td>)}
                    <td className="px-2 py-1"><button className="underline" type="button" onClick={() => setOpen(open === index ? null : index)}>{open === index ? "Hide" : "Details"}</button></td>
                  </tr>
                  {open === index ? (
                    <tr>
                      <td className="px-2 py-2 text-sm" colSpan={columns.length + 1}>
                        <p>Posted gross {row.gross} minus posted receipts {row.received} leaves outstanding {row.outstanding}. {row.receiptReferences ? `Source receipt ${row.receiptReferences}.` : "No posted receipt reference is linked."}</p>
                        <WarningList warnings={row.warnings} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function moneyText(value: string | number | boolean | null | undefined): string {
  const formatted = formatGbp(value);
  return formatted || String(value ?? "");
}
