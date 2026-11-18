"use client";

import {
  DEMO_PROJECT_LINKS,
  type ProjectLinksPayload,
} from "./finance-workplace-links-data";

export { DEMO_PROJECT_LINKS, type ProjectLinksPayload, type LinkRow } from "./finance-workplace-links-data";

type Props = {
  companyName: string;
  payload: ProjectLinksPayload | null;
  loading?: boolean;
  error?: string;
  readonly: boolean;
  onRefresh: () => void;
  onOpenCvr: (projectId: string) => void;
  onInitialize: (workplaceId: string) => void;
  onDryRun: () => void;
};

export function FinanceWorkplaceLinksPanel({
  companyName,
  payload,
  loading = false,
  error = "",
  readonly,
  onRefresh,
  onOpenCvr,
  onInitialize,
  onDryRun,
}: Props) {
  const unlinked = payload?.unlinked_active_workplaces ?? [];
  const linked = (payload?.workplaces ?? []).filter((row) => row.link_status === "LINKED");
  const financeOnly = (payload?.finance_projects ?? []).filter((row) => row.link_status === "NOT LINKED");

  return (
    <section className="panel" aria-label="Workplace Finance links">
      <div className="titlebar" style={{ marginBottom: 8 }}>
        <div>
          <h3 style={{ margin: 0 }}>Workplace to Finance project</h3>
          <p className="sub" style={{ margin: "4px 0 0" }}>
            Company {companyName || "—"}. Association uses workplace ID only. No payroll, costs, or contracts are imported.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" type="button" onClick={onRefresh} disabled={loading}>
            Refresh links
          </button>
          <button className="btn" type="button" onClick={onDryRun} disabled={loading}>
            Dry-run
          </button>
        </div>
      </div>

      {readonly ? (
        <p className="notice amber" role="status">
          Pilot is read-only. You can review LINKED / NOT LINKED status. Initialize stays blocked until the owner approves writable Finance.
        </p>
      ) : null}
      {error ? (
        <p className="notice bad" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="sub">Loading workplace links…</p> : null}

      <h4 className="head2">Active workplaces available to initialize</h4>
      {unlinked.length === 0 ? (
        <p className="empty">No unlinked active workplaces for this company.</p>
      ) : (
        <div className="fdg-wrap" style={{ maxHeight: 280 }}>
          <table className="fdg-table">
            <thead>
              <tr>
                <th>Workplace</th>
                <th>Code</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {unlinked.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.code || "—"}</td>
                  <td>
                    <span className="chip">{row.link_status}</span>
                  </td>
                  <td>
                    <button
                      className="btn"
                      type="button"
                      disabled={readonly}
                      title={readonly ? "Blocked in read-only pilot" : "Create Finance project from workplace identity"}
                      onClick={() => onInitialize(row.id)}
                    >
                      Initialize Finance project
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h4 className="head2">Linked workplaces</h4>
      {linked.length === 0 ? (
        <p className="empty">No workplaces are linked yet.</p>
      ) : (
        <div className="fdg-wrap" style={{ maxHeight: 240 }}>
          <table className="fdg-table">
            <thead>
              <tr>
                <th>Workplace</th>
                <th>Code</th>
                <th>Status</th>
                <th>CVR</th>
              </tr>
            </thead>
            <tbody>
              {linked.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.code || "—"}</td>
                  <td>
                    <span className="chip">{row.link_status}</span>
                  </td>
                  <td>
                    {row.finance_project_id ? (
                      <button className="linkbtn" type="button" onClick={() => onOpenCvr(row.finance_project_id!)}>
                        Open CVR
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {financeOnly.length ? (
        <>
          <h4 className="head2">Finance projects without workplace link</h4>
          <p className="sub">Existing Finance projects are preserved and not overwritten.</p>
          <ul className="attention">
            {financeOnly.map((row) => (
              <li key={row.id}>
                {row.name}
                {row.reference_code ? ` · ${row.reference_code}` : ""} · {row.link_status}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
