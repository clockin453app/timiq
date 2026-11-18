"use client";

import { useEffect, useState } from "react";

import { API_URL } from "@/config/api";
import { listCompanies, type Company } from "@/features/companies/api";
import { readStoredCompanyId } from "@/features/companies/selected-company";

import "./finance-v3.css";
import { withCompany } from "./presentation";

const CATEGORIES = [
  "All operations",
  "CIS worker payments",
  "PAYE employee payments",
  "Supplier payments",
  "Customer invoices and credits",
  "Customer receipts",
  "Project expenses",
  "Budgets and commitments",
  "Contracts, variations and dayworks",
  "Retentions",
  "Loans and advances",
  "Approvals and corrections",
  "Reversals",
  "CIS/HMRC",
  "Other evidenced financial actions",
];

type AuditRow = {
  id?: string;
  created_at?: string;
  recorded_uk?: string;
  actor_label?: string;
  category?: string;
  action?: string;
  raw_action?: string;
  operation?: string;
  reason?: string;
  entity_type?: string;
  entity_id?: string;
  party_display?: string;
  amount_display?: string;
  reference_display?: string;
  project_display?: string;
  status_display?: string;
  currency_display?: string;
  related_display?: string;
  reversal_display?: string;
  historical_amount?: string;
  historical_reference?: string;
  evidence_note?: string;
  before_json?: unknown;
  after_json?: unknown;
};

function shown(value: unknown): string {
  return value == null || value === "" ? "Not recorded" : String(value);
}

export function FinanceAuditTrail() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [category, setCategory] = useState("All operations");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const [query, setQuery] = useState({ q: "", dateFrom: "", dateTo: "", offset: 0 });

  useEffect(() => {
    listCompanies().then((list) => {
      setCompanies(list);
      const stored = readStoredCompanyId();
      setCompanyId(list.find((item) => item.id === stored)?.id ?? list[0]?.id ?? "");
    }).catch(() => setNote("Companies could not be loaded."));
  }, []);

  useEffect(() => {
    if (!companyId) return;
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams({ category, limit: "50", offset: String(query.offset) });
      if (query.q) params.set("q", query.q);
      if (query.dateFrom) params.set("date_from", query.dateFrom);
      if (query.dateTo) params.set("date_to", query.dateTo);
      void fetch(`${API_URL}${withCompany(`/api/finance/audit-trail?${params.toString()}`, companyId)}`, { credentials: "include" })
        .then(async (response) => {
          if (!response.ok) throw new Error("The audit trail could not be loaded.");
          return response.json() as Promise<{ rows: AuditRow[]; total: number; date_field?: string; actor_note?: string; ledger_note?: string }>;
        })
        .then((body) => {
          setRows(body.rows);
          setTotal(body.total);
          setNote(`${body.date_field ?? ""} ${body.actor_note ?? ""} ${body.ledger_note ?? ""} Showing ${body.rows.length} of ${body.total}.`);
        })
        .catch((reason: unknown) => setNote(reason instanceof Error ? reason.message : "The audit trail could not be loaded."));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [companyId, category, query]);

  return (
    <div className="fv3">
      <header className="top">
        <div className="brand">TIMIQ <span>Finance</span><small>Audit trail</small></div>
        <div className="top-meta"><a className="chip" href="/finance">Back to Finance</a></div>
      </header>
      <div className="main">
        <div className="titlebar">
          <div>
            <h1>Audit trail</h1>
            <p>Append-only finance events for this company. An event is not an extra payment.</p>
          </div>
        </div>
        <section className="workarea">
          <div className="panel">
          <div className="filters">
            <label>Company
              <select aria-label="Company" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
                {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            </label>
            <label>Category
              <select aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)}>
                {CATEGORIES.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Search
              <input aria-label="Search" value={query.q} onChange={(event) => setQuery({ ...query, q: event.target.value, offset: 0 })} />
            </label>
            <label>Recorded from
              <input aria-label="Recorded from" type="date" value={query.dateFrom} onChange={(event) => setQuery({ ...query, dateFrom: event.target.value, offset: 0 })} />
            </label>
            <label>Recorded to
              <input aria-label="Recorded to" type="date" value={query.dateTo} onChange={(event) => setQuery({ ...query, dateTo: event.target.value, offset: 0 })} />
            </label>
            <button className="btn" type="button" onClick={() => setQuery({ q: "", dateFrom: "", dateTo: "", offset: 0 })}>Clear filters</button>
          </div>
          <p className="sub">{note}</p>
          <div className="gridwrap">
            <table>
              <thead><tr><th>When</th><th>Operation</th><th>Party</th><th>Amount</th><th>Reference</th><th>Actor</th><th></th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={String(row.id)}>
                    <td>{shown(row.recorded_uk)}</td>
                    <td>{shown(row.operation)}</td>
                    <td>{shown(row.party_display)}</td>
                    <td className="amt">{shown(row.amount_display)}</td>
                    <td>{shown(row.reference_display)}</td>
                    <td>{shown(row.actor_label)}</td>
                    <td><button className="linkbtn" type="button" onClick={() => setSelected(row)}>View details</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 ? <p className="empty">No audit events match these filters. Missing historical events are not invented.</p> : null}
          <div className="actions">
            <button className="btn" type="button" disabled={query.offset === 0} onClick={() => setQuery({ ...query, offset: Math.max(0, query.offset - 50) })}>Previous</button>
            <button className="btn" type="button" disabled={query.offset + rows.length >= total} onClick={() => setQuery({ ...query, offset: query.offset + 50 })}>Next</button>
          </div>
          </div>
        </section>
      </div>
      {selected ? (
        <div className="drawerback" role="dialog" aria-modal="true" aria-label="Audit event">
          <div className="drawer">
            <header className="dhead"><h2>{shown(selected.operation)}</h2><button className="x" type="button" onClick={() => setSelected(null)}>Close</button></header>
            <section className="dbody">
              <p><b>Operation.</b> {shown(selected.operation)} · {shown(selected.category)}</p>
              <p><b>Who.</b> {shown(selected.actor_label)}. A personal name is not stored.</p>
              <p><b>When.</b> {shown(selected.recorded_uk)}</p>
              <p><b>Party.</b> {shown(selected.party_display)}</p>
              <p><b>Amount.</b> {shown(selected.amount_display)}. Currency: {shown(selected.currency_display)}</p>
              <p><b>Recorded on the event.</b> Amount {shown(selected.historical_amount)}. Reference {shown(selected.historical_reference)}</p>
              <p><b>Reference.</b> {shown(selected.reference_display)}</p>
              <p><b>Project.</b> {shown(selected.project_display)}</p>
              <p><b>Status.</b> {shown(selected.status_display)}</p>
              <p><b>Related record.</b> {shown(selected.related_display)}</p>
              <p><b>Reason.</b> {shown(selected.reason)}</p>
              <p><b>Reversal.</b> {shown(selected.reversal_display)}</p>
              <p><b>Evidence.</b> {shown(selected.evidence_note)} This event is not an extra payment.</p>
              <details>
                <summary>Technical details</summary>
                <p>Action code: {shown(selected.raw_action || selected.action)}</p>
                <p>Entity: {shown(selected.entity_type)} {shown(selected.entity_id)}</p>
                <p>Event ID: {shown(selected.id)}</p>
                <pre>{JSON.stringify({ before: selected.before_json ?? null, after: selected.after_json ?? null }, null, 2)}</pre>
              </details>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
