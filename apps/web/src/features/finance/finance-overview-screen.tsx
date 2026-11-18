"use client";

import { useMemo, useState } from "react";

import { FinanceDataGrid, type FinanceGridColumn, type FinanceGridRow } from "./finance-data-grid";
import { FinanceSourceDrawer } from "./finance-source-drawer";
import { formatMoneyCell, type SourceBreakdownPayload } from "./finance-reconcile";
import {
  financePortfolioSummary,
  forecastTone,
  primaryKpisReady,
  type FinanceNavigateTarget,
} from "./presentation";
import {
  FinanceWorkplaceLinksPanel,
  type ProjectLinksPayload,
} from "./finance-workplace-links";

type Row = Record<string, string | number | boolean | null>;

type Props = {
  companyName: string;
  projects: Row[];
  cvrs: Row[];
  demoMode?: boolean;
  projectLinks?: ProjectLinksPayload | null;
  linksLoading?: boolean;
  linksError?: string;
  previewReadonly?: boolean;
  onSelectProject: (projectId: string) => void;
  onRefresh: () => void;
  onNavigate: (target: FinanceNavigateTarget) => void;
  onRefreshLinks?: () => void;
  onInitializeWorkplace?: (workplaceId: string) => void;
  onDryRunLinks?: () => void;
};

const COLUMNS: FinanceGridColumn[] = [
  { id: "project", label: "Project" },
  { id: "contract", label: "Contract", money: true, align: "right" },
  { id: "incurred", label: "Cost to date", money: true, align: "right" },
  { id: "commitments", label: "Open commitments", money: true, align: "right" },
  { id: "ctc", label: "CTC", money: true, align: "right" },
  { id: "final", label: "Forecast final", money: true, align: "right" },
  { id: "profit", label: "Forecast profit", money: true, align: "right" },
];

export function FinanceOverviewScreen({
  companyName,
  projects,
  cvrs,
  demoMode = false,
  projectLinks = null,
  linksLoading = false,
  linksError = "",
  previewReadonly = true,
  onSelectProject,
  onRefresh,
  onRefreshLinks,
  onInitializeWorkplace,
  onDryRunLinks,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPayload, setDrawerPayload] = useState<SourceBreakdownPayload | null>(null);

  const portfolio = financePortfolioSummary(cvrs);
  const approved = portfolio.approvedContract;
  const incurred = portfolio.actualIncurred;
  const finalCost = portfolio.forecastFinalCost;
  const profit = portfolio.forecastProfit;
  const kpisReady = primaryKpisReady([approved, incurred, finalCost, profit]);

  const rows = useMemo(() => {
    const out: FinanceGridRow[] = [];
    for (const cvr of cvrs) {
      const id = String(cvr.id || "");
      const open = Boolean(expanded[id]);
      const tone = forecastTone(cvr.forecast_final_profit);
      out.push({
        id,
        expandable: true,
        expanded: open,
        metricId: "contract_value",
        amountColumnIds: ["contract", "incurred", "final", "profit"],
        cells: {
          project: String(cvr.name || projects.find((p) => String(p.id) === id)?.name || "Project"),
          contract: cvr.approved_contract_value,
          incurred: cvr.actual_incurred_cost ?? cvr.actual_eligible_cost,
          commitments: cvr.open_commitments ?? cvr.open_commitment,
          ctc: cvr.cost_to_complete,
          final: cvr.forecast_final_cost,
          profit: cvr.forecast_final_profit ?? cvr.forecast_margin,
        },
        meta: { projectId: id, tone },
      });
      if (open) {
        out.push({
          id: `${id}-detail`,
          child: true,
          depth: 1,
          cells: {
            project: (
              <button type="button" className="linkbtn" onClick={() => onSelectProject(id)}>
                Open Project CVR
              </button>
            ) as unknown as string,
            contract: null,
            incurred: null,
            commitments: null,
            ctc: null,
            final: null,
            profit: null,
          },
        });
        const notes: string[] = [];
        if (String(cvr.approved_contract_value) === "missing") notes.push("Missing approved contract");
        if (String(cvr.cost_to_complete) === "missing") notes.push("Missing CTC");
        if (notes.length) {
          out.push({
            id: `${id}-notes`,
            child: true,
            depth: 1,
            cells: {
              project: notes.join(" ? "),
              contract: null,
              incurred: null,
              commitments: null,
              ctc: null,
              final: null,
              profit: null,
            },
          });
        }
      }
    }
    return out;
  }, [cvrs, expanded, projects, onSelectProject]);

  function openPortfolioMetric(metric: string, label: string, displayed: string) {
    setDrawerPayload({
      metric,
      company_id: "portfolio",
      project_id: "",
      displayed_total: displayed === "Not determined" ? "missing" : String(displayed).replace(/[?,]/g, "") || "missing",
      formula: "Sum of project contributions (no double count across projects)",
      basis: "Portfolio overview ? open a project for source rows",
      reconcilable: false,
      verification: "PARTIAL",
      difference: "0.0000",
      source_total: "0.0000",
      groups: [
        {
          id: "hint",
          label: "Project drill-down required",
          total: "0.0000",
          rows: [],
        },
      ],
      warnings: [
        demoMode ? "DEMO portfolio strip." : "Select a project and open Project CVR for RECONCILED source breakdown.",
      ],
    });
    setDrawerOpen(true);
    void label;
  }

  return (
    <>
      <div className="cvr-v3-header">
        <div>
          <h2>Finance overview</h2>
          <div className="cvr-v3-meta">
            <span className="chip">{companyName || "Company"}</span>
            <span className="chip live">Projects commercial position</span>
            <span className="chip readonly">READ-ONLY</span>
            {demoMode ? <span className="chip readonly">DEMO DATA</span> : null}
          </div>
          <p className="sub">Expand a project row, then open Project CVR for the full cost-code grid.</p>
        </div>
        <button className="btn" type="button" onClick={onRefresh}>Refresh</button>
      </div>

      {kpisReady ? (
        <div className="fdg-kpi-strip">
          <button type="button" className="fdg-kpi blue" onClick={() => openPortfolioMetric("contract_value", "Contract", approved)}>
            <span className="label">Contract</span>
            <span className="value">{approved}</span>
          </button>
          <button type="button" className="fdg-kpi" onClick={() => openPortfolioMetric("actual_eligible", "Cost to date", incurred)}>
            <span className="label">Cost to date</span>
            <span className="value">{incurred}</span>
          </button>
          <button type="button" className={`fdg-kpi${portfolio.missingCtc ? " amber" : ""}`} onClick={() => openPortfolioMetric("forecast_final_cost", "Forecast final", finalCost)}>
            <span className="label">Forecast final</span>
            <span className="value">{finalCost}</span>
          </button>
          <button type="button" className={`fdg-kpi${portfolio.lossMaking ? " red" : " green"}`} onClick={() => openPortfolioMetric("forecast_profit", "Forecast profit", profit)}>
            <span className="label">Forecast profit</span>
            <span className="value">{profit}</span>
          </button>
        </div>
      ) : (
        <p className="notice amber" role="status">Portfolio KPIs incomplete ? one or more projects are missing contract/CTC.</p>
      )}

      <p className="sub">
        Reliable projects {portfolio.reliableProjects} of {cvrs.length}. Open commitments {portfolio.openCommitments}.
      </p>

      <FinanceDataGrid
        columns={COLUMNS}
        rows={rows}
        emptyTitle="No projects"
        emptyText="No project CVR rows loaded for this company."
        onToggle={(row) => {
          const id = String(row.meta?.projectId || row.id);
          setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
        }}
        onAmountClick={(_metric, row) => {
          const id = String(row.meta?.projectId || row.id);
          onSelectProject(id);
        }}
      />

      <FinanceWorkplaceLinksPanel
        companyName={companyName}
        payload={projectLinks}
        loading={linksLoading}
        error={linksError}
        readonly={previewReadonly || Boolean(demoMode)}
        onRefresh={() => (onRefreshLinks ? onRefreshLinks() : onRefresh())}
        onOpenCvr={onSelectProject}
        onInitialize={(workplaceId) => onInitializeWorkplace?.(workplaceId)}
        onDryRun={() => onDryRunLinks?.()}
      />

      <FinanceSourceDrawer
        open={drawerOpen}
        title="Portfolio metric"
        payload={drawerPayload}
        onClose={() => setDrawerOpen(false)}
      />
    </>
  );
}
