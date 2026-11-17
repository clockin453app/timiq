"use client";

import { useEffect, useState } from "react";

import { API_URL } from "@/config/api";
import { withCompany } from "./presentation";

export type FinanceQuery = {
  q: string;
  dateField: string;
  dateFrom: string;
  dateTo: string;
  partyId: string;
  status: string;
  offset: number;
};

export const EMPTY_QUERY: FinanceQuery = { q: "", dateField: "", dateFrom: "", dateTo: "", partyId: "", status: "all", offset: 0 };

export function FinanceQueryBar({
  dateFields,
  parties,
  partyLabel,
  statusOptions,
  showSearch = true,
  nextDisabled = false,
  value,
  onChange,
  exportHref,
}: {
  dateFields: [string, string][];
  parties?: [string, string][];
  partyLabel?: string;
  statusOptions?: [string, string][];
  showSearch?: boolean;
  nextDisabled?: boolean;
  value: FinanceQuery;
  onChange: (next: FinanceQuery) => void;
  exportHref: string;
}) {
  const [exportError, setExportError] = useState("");
  const statuses = statusOptions ?? [["all", "All"], ["posted", "Posted"], ["draft", "Draft"], ["reversed", "Reversed"]];
  async function download() {
    setExportError("");
    const response = await fetch(exportHref, { credentials: "include" });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { detail?: string } | null;
      setExportError(typeof body?.detail === "string" ? body.detail : "The export was not created. Narrow the filters and try again.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "finance-export.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div>
      <div className="filters">
        {showSearch ? <label>Search
          <input aria-label="Search" value={value.q} onChange={(event) => onChange({ ...value, q: event.target.value, offset: 0 })} />
        </label> : null}
        {dateFields.length > 0 ? <label>Date field
          <select aria-label="Date field" value={value.dateField} onChange={(event) => onChange({ ...value, dateField: event.target.value, offset: 0 })}>
            {dateFields.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label> : null}
        {dateFields.length > 0 ? <label>From
          <input aria-label="From" type="date" value={value.dateFrom} onChange={(event) => onChange({ ...value, dateFrom: event.target.value, offset: 0 })} />
        </label> : null}
        {dateFields.length > 0 ? <label>To
          <input aria-label="To" type="date" value={value.dateTo} onChange={(event) => onChange({ ...value, dateTo: event.target.value, offset: 0 })} />
        </label> : null}
        {parties && partyLabel ? <label>{partyLabel}
          <select aria-label={partyLabel} value={value.partyId} onChange={(event) => onChange({ ...value, partyId: event.target.value, offset: 0 })}>
            <option value="">All</option>
            {parties.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label> : null}
        <label>Status
          <select aria-label="Status" value={value.status} onChange={(event) => onChange({ ...value, status: event.target.value, offset: 0 })}>
            {statuses.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <button className="btn" type="button" onClick={() => onChange({ ...EMPTY_QUERY, dateField: value.dateField })}>Clear filters</button>
        <button className="btn" type="button" onClick={() => void download()}>Download CSV</button>
        <button className="btn" type="button" disabled={value.offset === 0} onClick={() => onChange({ ...value, offset: Math.max(0, value.offset - 50) })}>Previous</button>
        <button className="btn" type="button" disabled={nextDisabled} onClick={() => onChange({ ...value, offset: value.offset + 50 })}>Next</button>
      </div>
      {exportError ? <p className="notice bad" role="alert">{exportError}</p> : null}
    </div>
  );
}

export function useFinanceQuery(companyId: string, register: string, query: FinanceQuery) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!companyId) return;
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (query.q) params.set("q", query.q);
      if (query.dateField) params.set("date_field", query.dateField);
      if (query.dateFrom) params.set("date_from", query.dateFrom);
      if (query.dateTo) params.set("date_to", query.dateTo);
      if (query.partyId) params.set("party_id", query.partyId);
      params.set("status", query.status || "all");
      params.set("limit", "50");
      params.set("offset", String(query.offset));
      setLoading(true);
      void fetch(`${API_URL}${withCompany(`/api/finance/query/${register}?${params.toString()}`, companyId)}`, { credentials: "include" })
        .then(async (response) => {
          if (!response.ok) throw new Error("The filtered register could not be loaded.");
          return response.json() as Promise<{ rows: Record<string, unknown>[]; total: number; effective_amount_note?: string; unsupported_filters?: string[] }>;
        })
        .then((body) => {
          setRows(body.rows);
          setTotal(body.total);
          const unsupported = body.unsupported_filters?.length ? ` Unsupported: ${body.unsupported_filters.join(", ")}.` : "";
          setNote(`${body.effective_amount_note ?? ""}${unsupported} Showing ${body.rows.length} of ${body.total}.`);
        })
        .catch((reason: unknown) => setNote(reason instanceof Error ? reason.message : "The filtered register could not be loaded."))
        .finally(() => setLoading(false));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [companyId, register, query]);
  return { rows, total, note, loading };
}

export function exportHref(companyId: string, register: string, query: FinanceQuery): string {
  const params = new URLSearchParams();
  if (companyId) params.set("company_id", companyId);
  if (query.q) params.set("q", query.q);
  if (query.dateField) params.set("date_field", query.dateField);
  if (query.dateFrom) params.set("date_from", query.dateFrom);
  if (query.dateTo) params.set("date_to", query.dateTo);
  if (query.partyId) params.set("party_id", query.partyId);
  params.set("status", query.status || "all");
  return `${API_URL}/api/finance/exports/${register}?${params.toString()}`;
}

export function CisBankPayments({ companyId, workers }: { companyId: string; workers: [string, string][] }) {
  const [query, setQuery] = useState<FinanceQuery>({ ...EMPTY_QUERY, dateField: "payment" });
  const result = useFinanceQuery(companyId, "worker-payments", query);
  return (
    <>
      <p className="sub">Date field is the actual bank payment date. All workers means every worker, not a name search. Payroll Mark Paid is not treated as a bank payment. Reversed rows remain visible when status is All and are excluded from effective cash.</p>
      <FinanceQueryBar dateFields={[["payment", "Actual payment date"]]} parties={workers} partyLabel="Worker" value={query} onChange={setQuery} exportHref={exportHref(companyId, "worker-payments", query)} />
      <p className="sub">{result.loading ? "Loading…" : result.note}</p>
      <div className="gridwrap">
        <table>
          <thead><tr><th>Worker</th><th>Payment date</th><th>Amount</th><th>Bank reference</th><th>Payroll week</th><th>Status</th></tr></thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={String(row.id)}>
                <td>{String(row.worker_label || "Not recorded")}</td>
                <td>{String(row.payment_date || "Not recorded")}</td>
                <td>{String(row.amount || "Not recorded")}</td>
                <td>{String(row.external_reference || "Not recorded")}</td>
                <td>{String(row.payroll_week || "Not recorded")}</td>
                <td>{row.payment_reversed === true ? "Reversed" : String(row.status || "Not recorded")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.rows.length === 0 ? <p className="empty">No recorded CIS bank payments match these filters.</p> : null}
    </>
  );
}

export function RegisterSearch({ companyId, register, dateField, dateFields, parties, partyLabel, statusOptions, showSearch = true }: {
  companyId: string;
  register: string;
  dateField: string;
  dateFields: [string, string][];
  parties?: [string, string][];
  partyLabel?: string;
  statusOptions?: [string, string][];
  showSearch?: boolean;
}) {
  const [query, setQuery] = useState<FinanceQuery>({ ...EMPTY_QUERY, dateField });
  const result = useFinanceQuery(companyId, register, query);
  const filtered = Boolean(query.q || query.dateFrom || query.dateTo || query.partyId || query.status !== "all" || query.offset > 0);
  return (
    <>
      <p className="sub">Cards elsewhere on this sheet stay company-wide unless their own heading says otherwise. This table is the server page for the filters below. Reversed rows are not treated as effective cash.</p>
      <FinanceQueryBar dateFields={dateFields} parties={parties} partyLabel={partyLabel} statusOptions={statusOptions} showSearch={showSearch} nextDisabled={query.offset + result.rows.length >= result.total} value={query} onChange={setQuery} exportHref={exportHref(companyId, register, query)} />
      <p className="sub">{result.loading ? "Loading…" : result.note}{filtered ? " The filtered table is not the company-wide total." : ""}</p>
      <div className="gridwrap">
        <table>
          <thead><tr>{Object.keys(result.rows[0] ?? { info: "" }).slice(0, 8).map((key) => <th key={key}>{key}</th>)}</tr></thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={String(row.id)}>{Object.keys(result.rows[0] ?? {}).slice(0, 8).map((key) => <td key={key}>{row[key] == null || row[key] === "" ? "Not recorded" : String(row[key])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.rows.length === 0 ? <p className="empty">No records match these filters.</p> : null}
    </>
  );
}
