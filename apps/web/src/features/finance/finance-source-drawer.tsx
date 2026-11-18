"use client";

import { useState } from "react";

import {
  formatMoneyCell,
  verificationTone,
  type SourceBreakdownPayload,
} from "./finance-reconcile";
import "./finance-grid.css";

type Props = {
  open: boolean;
  title?: string;
  payload: SourceBreakdownPayload | null;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  onOpenDocument?: (documentId: string) => void;
};

export function FinanceSourceDrawer({
  open,
  title,
  payload,
  loading = false,
  error = "",
  onClose,
  onOpenDocument,
}: Props) {
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [docsOpen, setDocsOpen] = useState(true);
  if (!open) return null;

  const verification = payload?.verification ?? "PARTIAL";
  const tone = verificationTone(String(verification));
  const formulaCheck = payload?.formula_check ?? (payload?.difference === "0.0000" ? "MATCH" : "MISMATCH");
  const sourceVerification =
    payload?.source_verification ??
    (payload?.components_incomplete ? "PARTIAL" : verification);

  return (
    <div className="fsd-back" role="dialog" aria-modal="true" aria-label={title || payload?.metric || "Source breakdown"}>
      <div className="fsd-panel">
        <div className="fsd-head">
          <div className="fsd-head-text">
            <h2>{title || metricLabel(payload?.metric) || "Source breakdown"}</h2>
            <div className="fsd-badge-row">
              <span className={`fsd-badge ${tone}`}>{String(verification)}</span>
            </div>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="fsd-body">
          {loading ? <p className="sub">Loading source rows…</p> : null}
          {error ? (
            <p className="notice bad" role="alert">
              {error}
            </p>
          ) : null}
          {payload ? (
            <>
              <section className="fsd-section">
                <h3>KPI total</h3>
                <p className="fsd-kpi-total">{formatMoneyCell(payload.displayed_total)}</p>
              </section>

              <section className="fsd-section">
                <button type="button" className="fsd-section-toggle" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((v) => !v)}>
                  <span>{detailsOpen ? "▼" : "▶"} Formula & checks</span>
                </button>
                {detailsOpen ? (
                  <div className="fsd-section-body">
                    <dl className="fsd-meta">
                      <dt>Formula</dt>
                      <dd className="fsd-wrap">{payload.formula}</dd>
                      <dt>Basis</dt>
                      <dd className="fsd-wrap">{payload.basis}</dd>
                      <dt>A. Formula check</dt>
                      <dd className="fsd-wrap">
                        <span className={`fsd-badge ${formulaCheck === "MATCH" ? "green" : "amber"}`}>{String(formulaCheck)}</span>
                        {" "}
                        <span className="fsd-inline">
                          Displayed {formatMoneyCell(payload.displayed_total)} · Components{" "}
                          {formatMoneyCell(payload.source_total ?? "missing")} · Diff {formatMoneyCell(payload.difference)}
                        </span>
                      </dd>
                      <dt>B. Source verification</dt>
                      <dd className="fsd-wrap">
                        <span className={`fsd-badge ${verificationTone(String(sourceVerification))}`}>
                          {String(sourceVerification)}
                        </span>
                      </dd>
                      <dt>Verified subtotal</dt>
                      <dd>{formatMoneyCell(payload.verified_subtotal ?? "missing")}</dd>
                      <dt>Unverified / incomplete</dt>
                      <dd>{formatMoneyCell(payload.unverified_subtotal ?? "missing")}</dd>
                    </dl>
                  </div>
                ) : null}
              </section>

              <section className="fsd-section">
                <button type="button" className="fsd-section-toggle" aria-expanded={docsOpen} onClick={() => setDocsOpen((v) => !v)}>
                  <span>{docsOpen ? "▼" : "▶"} Components & documents</span>
                </button>
                {docsOpen ? (
                  <div className="fsd-section-body fsd-groups">
                    {(payload.groups ?? []).map((group) => {
                      const groupTone = verificationTone(String(group.verification || "PARTIAL"));
                      return (
                        <div key={group.id} className="fsd-group">
                          <div className="fsd-group-head">
                            <div className="fsd-wrap">
                              <strong>{group.label}</strong>
                              {group.verification ? (
                                <span className={`fsd-badge ${groupTone}`}>{String(group.verification)}</span>
                              ) : null}
                            </div>
                            <span className="fsd-amount">{formatMoneyCell(group.total)}</span>
                          </div>
                          {group.note ? <div className="fsd-row muted fsd-wrap">{group.note}</div> : null}
                          {(group.rows ?? []).length === 0 ? (
                            <div className="fsd-row">
                              <div className="fsd-wrap">No source documents</div>
                              <div className="fsd-amount">{formatMoneyCell(group.total)}</div>
                            </div>
                          ) : (
                            group.rows.map((row) => (
                              <div key={row.id} className="fsd-row">
                                <div className="fsd-wrap">
                                  <div>
                                    {row.document_id && onOpenDocument ? (
                                      <button type="button" className="linkbtn" onClick={() => onOpenDocument(row.document_id!)}>
                                        {row.reference}
                                      </button>
                                    ) : (
                                      row.reference
                                    )}
                                  </div>
                                  <div className="muted">
                                    {[row.source_type, row.document_date, row.status, row.cost_code].filter(Boolean).join(" · ")}
                                  </div>
                                </div>
                                <div className="fsd-amount">{formatMoneyCell(row.amount)}</div>
                              </div>
                            ))
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            </>
          ) : null}
          {!payload && !loading && !error ? <p className="sub">No source breakdown loaded.</p> : null}
        </div>
      </div>
    </div>
  );
}

function metricLabel(metric?: string): string {
  if (!metric) return "";
  const labels: Record<string, string> = {
    actual_eligible: "Actual eligible cost",
    cost_to_date_eligible: "Cost to date (eligible)",
    cost_to_date: "Cost to date",
    actual_incurred: "Cost to date",
    open_commitments: "Open commitments",
    cost_to_complete: "Cost to complete",
    contract_value: "Contract value",
    forecast_final_cost: "Forecast final cost",
    forecast_profit: "Forecast profit",
  };
  return labels[metric] ?? metric;
}
