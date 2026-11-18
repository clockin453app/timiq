"use client";

import { useEffect, useState } from "react";

import { FinanceStatusChip } from "./finance-field-state";
import {
  formatMoneyCell,
  verificationTone,
  type SourceBreakdownPayload,
} from "./finance-reconcile";
import "./finance-grid.css";
import "./finance-ui.css";

type Props = {
  open: boolean;
  title?: string;
  payload: SourceBreakdownPayload | null;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  onOpenDocument?: (documentId: string) => void;
};

type TabId = "formula" | "verification" | "documents";

export function FinanceSourceDrawer({
  open,
  title,
  payload,
  loading = false,
  error = "",
  onClose,
  onOpenDocument,
}: Props) {
  const [tab, setTab] = useState<TabId>("formula");

  useEffect(() => {
    if (!open) return;
    setTab("formula");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const verification = payload?.verification ?? "PARTIAL";
  const tone = verificationTone(String(verification));
  const formulaCheck = payload?.formula_check ?? (payload?.difference === "0.0000" ? "MATCH" : "MISMATCH");
  const sourceVerification =
    payload?.source_verification ??
    (payload?.components_incomplete ? "PARTIAL" : verification);
  const groups = payload?.groups ?? [];
  const docCount = groups.reduce((sum, group) => sum + (group.rows?.length ?? 0), 0);
  const missingDocs = groups.length > 0 && groups.every((group) => (group.rows ?? []).length === 0);
  const warnings = payload?.warnings ?? [];

  return (
    <div className="fsd-back" role="dialog" aria-modal="true" aria-label={title || payload?.metric || "Source breakdown"}>
      <div className="fsd-panel">
        <div className="fsd-close-bar">
          <div className="fsd-head-text">
            <h2>{title || metricLabel(payload?.metric) || "Source & Formula"}</h2>
            <div className="fsd-badge-row">
              <span className={`fsd-badge ${tone}`}>{String(verification)}</span>
              {payload?.reconcilable === false ? <FinanceStatusChip tone="neutral">Not reconcilable here</FinanceStatusChip> : null}
            </div>
          </div>
          <button type="button" className="btn" onClick={onClose} aria-label="Close source drawer">
            Close
          </button>
        </div>

        <div className="fsd-tabs" role="tablist" aria-label="Source drawer sections">
          <button type="button" role="tab" aria-selected={tab === "formula"} className={`fsd-tab${tab === "formula" ? " active" : ""}`} onClick={() => setTab("formula")}>
            Formula & breakdown
          </button>
          <button type="button" role="tab" aria-selected={tab === "verification"} className={`fsd-tab${tab === "verification" ? " active" : ""}`} onClick={() => setTab("verification")}>
            Source verification
          </button>
          <button type="button" role="tab" aria-selected={tab === "documents"} className={`fsd-tab${tab === "documents" ? " active" : ""}`} onClick={() => setTab("documents")}>
            Documents ({docCount})
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
                <h3>Selected figure</h3>
                <p className="fsd-kpi-total">{formatMoneyCell(payload.displayed_total)}</p>
                <p className="sub">
                  {metricLabel(payload.metric) || payload.metric}
                  {payload.project_id ? " · project source rows" : " · company / portfolio scope"}
                </p>
              </section>

              {tab === "formula" ? (
                <section className="fsd-section">
                  <dl className="fsd-meta">
                    <dt>Formula</dt>
                    <dd className="fsd-wrap">{payload.formula}</dd>
                    <dt>Basis</dt>
                    <dd className="fsd-wrap">{payload.basis}</dd>
                  </dl>
                  <div className="fsd-check-card">
                    <h4>A. Formula check</h4>
                    <span className={`fsd-badge ${formulaCheck === "MATCH" ? "green" : formulaCheck === "INCOMPLETE" ? "neutral" : "amber"}`}>
                      {String(formulaCheck)}
                    </span>
                    <p>
                      Compares the displayed total to formula components only. Displayed {formatMoneyCell(payload.displayed_total)} ·
                      Components {formatMoneyCell(payload.source_total ?? "missing")} · Diff {formatMoneyCell(payload.difference ?? "missing")}.
                      A MATCH is not proof that documents exist.
                    </p>
                  </div>
                  <div className="fsd-groups">
                    {groups.map((group) => (
                      <div key={group.id} className="fsd-group">
                        <div className="fsd-group-head">
                          <strong>{group.label}</strong>
                          <span className="fsd-amount">{formatMoneyCell(group.total)}</span>
                        </div>
                        {group.note ? <div className="fsd-row muted fsd-wrap">{group.note}</div> : null}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {tab === "verification" ? (
                <section className="fsd-section">
                  <div className="fsd-check-card">
                    <h4>B. Source verification</h4>
                    <span className={`fsd-badge ${verificationTone(String(sourceVerification))}`}>{String(sourceVerification)}</span>
                    <p>
                      Confirms supporting documents. Verified {formatMoneyCell(payload.verified_subtotal ?? "missing")} · Unverified /
                      incomplete {formatMoneyCell(payload.unverified_subtotal ?? "missing")}.
                    </p>
                  </div>
                  {missingDocs ? (
                    <p className="notice neutral" role="status">
                      Supporting documents are not linked for these components. The amount is not marked verified.
                    </p>
                  ) : null}
                  {warnings.length ? (
                    <div className="fsd-warnings" aria-label="Source notes">
                      <strong>Notes</strong>
                      <ul>
                        {warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {tab === "documents" ? (
                <section className="fsd-section fsd-groups">
                  {!groups.length ? (
                    <div className="empty" role="status">
                      <strong>No source groups</strong>
                      <span>This figure has no component breakdown in the current register.</span>
                    </div>
                  ) : null}
                  {groups.map((group) => {
                    const emptyRows = (group.rows ?? []).length === 0;
                    return (
                      <div key={group.id} className="fsd-group">
                        <div className="fsd-group-head">
                          <div className="fsd-wrap">
                            <strong>{group.label}</strong>
                            {emptyRows ? <FinanceStatusChip tone="neutral">Documents missing</FinanceStatusChip> : null}
                          </div>
                          <span className="fsd-amount">{formatMoneyCell(group.total)}</span>
                        </div>
                        {emptyRows ? (
                          <div className="fsd-row">
                            <div className="fsd-wrap">No source documents linked</div>
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
                </section>
              ) : null}
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
    supplier_invoice: "Supplier invoice",
  };
  return labels[metric] ?? metric;
}