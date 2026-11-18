"use client";

import { useEffect, useState } from "react";

import { API_URL } from "@/config/api";
import { FinanceDataGrid } from "./finance-data-grid";
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

export function useFinanceQuery(
  companyId: string,
  register: string,
  query: FinanceQuery,
  options?: { enabled?: boolean },
) {
  const enabled = options?.enabled !== false;
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [note, setNote] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setTotal(0);
      setError(false);
      setLoading(false);
      setNote("Server-side advanced filter requires the LIVE Finance API. Local DEMO uses the main register above.");
      return;
    }
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
      setError(false);
      void fetch(`${API_URL}${withCompany(`/api/finance/query/${register}?${params.toString()}`, companyId)}`, { credentials: "include" })
        .then(async (response) => {
          if (!response.ok) throw new Error("The filtered register could not be loaded.");
          return response.json() as Promise<{ rows: Record<string, unknown>[]; total: number; effective_amount_note?: string; unsupported_filters?: string[] }>;
        })
        .then((body) => {
          setRows(body.rows);
          setTotal(body.total);
          setError(false);
          const unsupported = body.unsupported_filters?.length ? ` Unsupported: ${body.unsupported_filters.join(", ")}.` : "";
          setNote(`${body.effective_amount_note ?? ""}${unsupported} Showing ${body.rows.length} of ${body.total}.`.trim());
        })
        .catch((reason: unknown) => {
          setRows([]);
          setTotal(0);
          setError(true);
          setNote(reason instanceof Error ? reason.message : "The filtered register could not be loaded.");
        })
        .finally(() => setLoading(false));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [companyId, register, query, enabled]);
  return { rows, total, note, loading, error, enabled };
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

export function CisBankPayments({
  companyId,
  workers,
  demoMode = false,
}: {
  companyId: string;
  workers: [string, string][];
  demoMode?: boolean;
}) {
  const [query, setQuery] = useState<FinanceQuery>({ ...EMPTY_QUERY, dateField: "payment" });
  const result = useFinanceQuery(companyId, "worker-payments", query, { enabled: !demoMode });
  return (
    <>
      <p className="sub">Date field is the actual bank payment date. All workers means every worker, not a name search. Payroll Mark Paid is not treated as a bank payment. Reversed rows remain visible when status is All and are excluded from effective cash.</p>
      {demoMode ? (
        <p className="notice neutral" role="status">
          CIS bank-payment server query is LIVE-only. Local DEMO does not call `/api/finance/query/worker-payments`, so this panel stays empty instead of faking a failed empty register.
        </p>
      ) : (
        <FinanceQueryBar dateFields={[["payment", "Actual payment date"]]} parties={workers} partyLabel="Worker" value={query} onChange={setQuery} exportHref={exportHref(companyId, "worker-payments", query)} />
      )}
      {result.error ? <p className="notice bad" role="alert">{result.note}</p> : <p className="sub">{result.loading ? "Loading…" : result.note}</p>}
      <FinanceDataGrid
        columns={[
          { id: "worker", label: "Worker" },
          { id: "date", label: "Payment date" },
          { id: "amount", label: "Amount", money: true, align: "right" },
          { id: "reference", label: "Bank reference", compactHide: true },
          { id: "week", label: "Payroll week", compactHide: true },
          { id: "status", label: "Status" },
        ]}
        emptyTitle={result.error ? "Filtered register unavailable" : demoMode ? "CIS bank payments (LIVE API)" : "No CIS bank payments"}
        emptyText={
          result.error
            ? result.note
            : demoMode
              ? "No DEMO fixture rows are shown here. Open LIVE Finance with an authenticated session to query worker bank payments."
              : "No recorded CIS bank payments match these filters."
        }
        compactMetricColumnIds={["amount"]}
        rows={result.rows.map((row) => ({
          id: String(row.id),
          amountColumnIds: ["amount"],
          cells: {
            worker: String(row.worker_label || "Not recorded"),
            date: String(row.payment_date || "Not recorded"),
            amount: row.amount == null || row.amount === ""
              ? { value: "missing", kind: "missing-required" as const }
              : { value: String(row.amount), kind: "source-linked" as const },
            reference: String(row.external_reference || "Not recorded"),
            week: String(row.payroll_week || "Not recorded"),
            status: row.payment_reversed === true ? "Reversed" : String(row.status || "Not recorded"),
          },
        }))}
      />
    </>
  );
}

export function RegisterSearch({
  companyId,
  register,
  dateField,
  dateFields,
  parties,
  partyLabel,
  statusOptions,
  showSearch = true,
  enabled = true,
}: {
  companyId: string;
  register: string;
  dateField: string;
  dateFields: [string, string][];
  parties?: [string, string][];
  partyLabel?: string;
  statusOptions?: [string, string][];
  showSearch?: boolean;
  /** When false (local DEMO), do not call LIVE query endpoints. */
  enabled?: boolean;
}) {
  const [query, setQuery] = useState<FinanceQuery>({ ...EMPTY_QUERY, dateField });
  const result = useFinanceQuery(companyId, register, query, { enabled });
  const filtered = Boolean(query.q || query.dateFrom || query.dateTo || query.partyId || query.status !== "all" || query.offset > 0);
  if (!enabled) {
    return (
      <p className="notice neutral" role="status">
        Server-side advanced search/pagination for <strong>{register}</strong> requires the LIVE Finance API. The main register on this sheet still uses the loaded books and is not an empty calculation.
      </p>
    );
  }
  return (
    <>
      <p className="sub">Cards elsewhere on this sheet stay company-wide unless their own heading says otherwise. This table is the server page for the filters below. Reversed rows are not treated as effective cash.</p>
      <FinanceQueryBar dateFields={dateFields} parties={parties} partyLabel={partyLabel} statusOptions={statusOptions} showSearch={showSearch} nextDisabled={query.offset + result.rows.length >= result.total} value={query} onChange={setQuery} exportHref={exportHref(companyId, register, query)} />
      {result.error ? (
        <p className="notice bad" role="alert">{result.note} This is a query failure, not an empty company register.</p>
      ) : (
        <p className="sub">{result.loading ? "Loading…" : result.note}{filtered ? " The filtered table is not the company-wide total." : ""}</p>
      )}
      <FinanceDataGrid
        columns={Object.keys(result.rows[0] ?? { info: "" }).slice(0, 8).map((key) => ({
          id: key,
          label: key,
          money: /amount|gross|net|vat|paid|outstanding|retained|released/i.test(key),
          align: /amount|gross|net|vat|paid|outstanding|retained|released/i.test(key) ? "right" as const : "left" as const,
        }))}
        emptyTitle={result.error ? "Filtered register unavailable" : "No matching records"}
        emptyText={result.error ? result.note : "No records match these filters."}
        compactMetricColumnIds={Object.keys(result.rows[0] ?? {}).slice(0, 8).filter((key) => /amount|gross|outstanding|paid/i.test(key)).slice(0, 3)}
        rows={result.rows.map((row) => {
          const keys = Object.keys(result.rows[0] ?? {}).slice(0, 8);
          return {
            id: String(row.id),
            cells: Object.fromEntries(keys.map((key) => {
              const raw = row[key];
              if (raw == null || raw === "") {
                return [key, /amount|gross|net|vat|paid|outstanding/i.test(key)
                  ? { value: "missing", kind: "missing-required" as const }
                  : "Not recorded"];
              }
              if (/amount|gross|net|vat|paid|outstanding|retained|released/i.test(key)) {
                return [key, { value: String(raw), kind: "source-linked" as const }];
              }
              return [key, String(raw)];
            })),
          };
        })}
      />
    </>
  );
}
