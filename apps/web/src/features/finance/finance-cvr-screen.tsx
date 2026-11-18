"use client";

import { useEffect, useMemo, useState } from "react";

import { API_URL } from "@/config/api";

import { CommercialPerformanceChart, buildCommercialBars } from "./finance-chart";
import { FinanceDataGrid, type FinanceGridColumn, type FinanceGridRow } from "./finance-data-grid";
import {
  missingCtcIncomplete,
  reconcileKpiToContributions,
  sumContributionStrings,
  type SourceBreakdownPayload,
  type SourceBreakdownRow,
} from "./finance-reconcile";
import { FinanceSourceDrawer } from "./finance-source-drawer";
import {
  controlAmount,
  controlPercent,
  financeUiAttentionActions,
  forecastTone,
  isForecastLoss,
  ownerControl,
  primaryKpisReady,
  withCompany,
  type FinanceNavigateTarget,
  type MoneyValue,
} from "./presentation";

type Row = Record<string, string | number | boolean | null>;

type DemoAllocation = {
  id: string;
  costCode: string;
  costCodeName: string;
  reference: string;
  document_date: string;
  amount: string;
  net: string;
  vat_non_recoverable: string;
  document_id: string;
  source_type?: string;
};

type Props = {
  companyId: string;
  companyName: string;
  projectId: string;
  projectName: string;
  cvr: Row;
  categories: { category: string; eligible: string }[];
  categoryLoadFailed: boolean;
  books: {
    costs: Row[];
    receipts: Row[];
    customerInvoices: Row[];
    supplierPayments: Row[];
    funding: Row[];
    openings: Row[];
    releases: Row[];
    audit: Row[];
  };
  demoMode?: boolean;
  demoAllocations?: DemoAllocation[];
  onRefresh: () => void;
  onNavigate: (target: FinanceNavigateTarget) => void;
  onExplain: (title: string, body: string, warning: string) => void;
};

const COLUMNS: FinanceGridColumn[] = [
  { id: "code", label: "Hierarchy", width: "220px" },
  { id: "description", label: "Description / reference" },
  { id: "budget", label: "Budget", money: true, align: "right" },
  { id: "actual", label: "Actual cost", money: true, align: "right" },
  { id: "commitments", label: "Open commitments", money: true, align: "right" },
  { id: "ctc", label: "Additional CTC", money: true, align: "right" },
  { id: "final", label: "Forecast final", money: true, align: "right" },
  { id: "margin", label: "Margin", money: true, align: "right" },
];

export function FinanceCvrScreen({
  companyId,
  companyName,
  projectId,
  projectName,
  cvr,
  categories,
  categoryLoadFailed,
  books,
  demoMode = false,
  demoAllocations = [],
  onRefresh,
  onNavigate,
  onExplain,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [childRows, setChildRows] = useState<Record<string, SourceBreakdownRow[]>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState("");
  const [drawerPayload, setDrawerPayload] = useState<SourceBreakdownPayload | null>(null);
  const [drawerTitle, setDrawerTitle] = useState("");

  const approved = controlAmount(cvr.approved_contract_value);
  const incurred = controlAmount(cvr.actual_incurred_cost ?? cvr.actual_eligible_cost);
  const finalCost = controlAmount(cvr.forecast_final_cost);
  const profit = controlAmount(cvr.forecast_final_profit ?? cvr.forecast_margin);
  const commitments = controlAmount(cvr.open_commitments ?? cvr.open_commitment);
  const ctc = controlAmount(cvr.cost_to_complete);
  const margin = controlPercent(cvr.forecast_final_margin_percent);
  const profitTone = forecastTone(cvr.forecast_final_profit);
  const kpisReady = primaryKpisReady([approved, incurred, finalCost, profit]);
  const incomplete = missingCtcIncomplete(cvr.cost_to_complete as MoneyValue, cvr.forecast_final_cost as MoneyValue);

  const figures = ownerControl({
    projectSelected: true,
    projectName,
    receipts: books.receipts,
    invoices: books.customerInvoices.filter((row) => String(row.project_id ?? "") === projectId),
    cvrs: [cvr],
    costs: books.costs,
    supplierPayments: books.supplierPayments,
    funding: books.funding,
    openings: books.openings,
    categories,
    categoryLoadFailed,
    releasesPosted: books.releases.filter((row) => String(row.status) === "posted").length,
    retentionAudited: books.audit.some((row) => String(row.action) === "retention_released"),
    today: new Date().toISOString().slice(0, 10),
  });
  const attention = financeUiAttentionActions(figures.attention);

  const chartBars = buildCommercialBars({
    contract: cvr.approved_contract_value,
    incurred: cvr.actual_incurred_cost ?? cvr.actual_eligible_cost,
    commitments: cvr.open_commitments ?? cvr.open_commitment,
    ctc: cvr.cost_to_complete,
    forecastFinal: cvr.forecast_final_cost,
    forecastProfit: cvr.forecast_final_profit ?? cvr.forecast_margin,
  });

  async function loadBreakdown(metric: string, title: string) {
    setDrawerOpen(true);
    setDrawerTitle(title);
    setDrawerLoading(true);
    setDrawerError("");
    try {
      if (demoMode) {
        setDrawerPayload(demoBreakdown(metric, cvr, demoAllocations));
        return;
      }
      const path = withCompany(
        `/api/finance/cvr/source-breakdown?project_id=${encodeURIComponent(projectId)}&metric=${encodeURIComponent(metric)}`,
        companyId,
      );
      const response = await fetch(`${API_URL}${path}`, { credentials: "include" });
      if (!response.ok) throw new Error(await response.text());
      setDrawerPayload((await response.json()) as SourceBreakdownPayload);
    } catch (reason: unknown) {
      setDrawerPayload(null);
      setDrawerError(reason instanceof Error ? reason.message : "Source breakdown could not be loaded.");
    } finally {
      setDrawerLoading(false);
    }
  }

  async function ensureChildren(category: string) {
    if (childRows[category]) return;
    if (demoMode) {
      const rows = demoAllocations.filter((row) => row.costCodeName === category || row.costCode === category);
      setChildRows((prev) => ({
        ...prev,
        [category]: rows.map((row) => ({
          id: row.id,
          reference: row.reference,
          source_type: row.source_type || "supplier_invoice",
          document_date: row.document_date,
          status: "posted",
          cost_code: `${row.costCode} / ${row.costCodeName}`,
          amount: row.amount,
          net: row.net,
          vat_non_recoverable: row.vat_non_recoverable,
          document_id: row.document_id,
        })),
      }));
      return;
    }
    try {
      const path = withCompany(
        `/api/finance/cvr/source-breakdown?project_id=${encodeURIComponent(projectId)}&metric=actual_eligible`,
        companyId,
      );
      const response = await fetch(`${API_URL}${path}`, { credentials: "include" });
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as SourceBreakdownPayload;
      const all = payload.groups.flatMap((group) => group.rows);
      const matched = all.filter((row) => String(row.cost_code || "").includes(category));
      setChildRows((prev) => ({ ...prev, [category]: matched }));
    } catch {
      setChildRows((prev) => ({ ...prev, [category]: [] }));
    }
  }

  useEffect(() => {
    setExpanded({});
    setChildRows({});
  }, [projectId, companyId]);

  const gridRows = useMemo(() => {
    const rows: FinanceGridRow[] = [];
    rows.push({
      id: "project-root",
      expandable: false,
      incomplete: incomplete,
      metricId: "cost_to_date",
      amountColumnIds: ["actual", "commitments", "ctc", "final", "margin"],
      cells: {
        code: "PROJECT",
        description: projectName || "Selected project",
        budget: cvr.approved_budget,
        actual: cvr.actual_incurred_cost ?? cvr.actual_eligible_cost,
        commitments: cvr.open_commitments ?? cvr.open_commitment,
        ctc: cvr.cost_to_complete,
        final: cvr.forecast_final_cost,
        margin: cvr.forecast_final_profit ?? cvr.forecast_margin,
      },
    });

    const cats = categories.length
      ? categories
      : [{ category: "Unallocated / all eligible", eligible: String(cvr.actual_eligible_cost || "missing") }];

    for (const cat of cats) {
      const open = Boolean(expanded[cat.category]);
      rows.push({
        id: `cat-${cat.category}`,
        depth: 1,
        expandable: true,
        expanded: open,
        metricId: "actual_eligible",
        amountColumnIds: ["actual"],
        cells: {
          code: cat.category,
          description: "Eligible allocations",
          budget: null,
          actual: cat.eligible,
          commitments: null,
          ctc: null,
          final: null,
          margin: null,
        },
        meta: { category: cat.category },
      });
      if (open) {
        const children = childRows[cat.category] ?? [];
        if (!children.length) {
          rows.push({
            id: `empty-${cat.category}`,
            child: true,
            depth: 2,
            incomplete: true,
            cells: {
              code: "No source documents",
              description: demoMode ? "DEMO fixture empty for this code" : "No matching allocation lines",
              budget: null,
              actual: null,
              commitments: null,
              ctc: null,
              final: null,
              margin: null,
            },
          });
        } else {
          for (const child of children) {
            rows.push({
              id: child.id,
              child: true,
              depth: 2,
              metricId: "actual_eligible",
              amountColumnIds: ["actual"],
              cells: {
                code: "Source document",
                description: `${child.reference} · ${child.document_date || "date —"} · ${child.cost_code || cat.category}`,
                budget: null,
                actual: child.amount,
                commitments: null,
                ctc: null,
                final: null,
                margin: null,
              },
              meta: { documentId: child.document_id },
            });
          }
        }
      }
    }

    rows.push({
      id: "eligible-subtotal",
      depth: 1,
      metricId: "actual_eligible",
      amountColumnIds: ["actual"],
      cells: {
        code: "Eligible subtotal",
        description: "Sum of cost-code eligible allocations",
        budget: null,
        actual: cvr.actual_eligible_cost ?? null,
        commitments: null,
        ctc: null,
        final: null,
        margin: null,
      },
    });
    rows.push({
      id: "cis-labour",
      depth: 1,
      incomplete: true,
      metricId: "cost_to_date",
      amountColumnIds: ["actual"],
      cells: {
        code: "CIS labour gross",
        description: "Formula component · no CIS split register",
        budget: null,
        actual: cvr.cis_labour_gross ?? "missing",
        commitments: null,
        ctc: null,
        final: null,
        margin: null,
      },
    });
    rows.push({
      id: "project-total",
      subtotal: true,
      incomplete: incomplete,
      metricId: "forecast_final_cost",
      amountColumnIds: ["final", "actual", "commitments", "ctc", "margin"],
      cells: {
        code: "PROJECT TOTAL",
        description: "Eligible + CIS labour",
        budget: cvr.approved_budget,
        actual: cvr.actual_incurred_cost ?? cvr.actual_eligible_cost,
        commitments: cvr.open_commitments ?? cvr.open_commitment,
        ctc: cvr.cost_to_complete,
        final: cvr.forecast_final_cost,
        margin: cvr.forecast_final_profit ?? cvr.forecast_margin,
      },
    });
    return rows;
  }, [categories, expanded, childRows, cvr, projectName, demoMode, incomplete]);

  return (
    <>
      <div className="cvr-v3-header">
        <div>
          <h2>Project CVR — {projectName || "Selected project"}</h2>
          <div className="cvr-v3-meta">
            <span className="chip">{companyName || "Company"}</span>
            <span className="chip live">LIVE AS-OF / GBP</span>
            <span className="chip readonly">READ-ONLY</span>
            {demoMode ? <span className="chip readonly">DEMO DATA</span> : null}
          </div>
          <p className="sub">
            Project → Cost code → Source document. KPI click opens formula + source checks.
          </p>
        </div>
        <div className="bar">
          <button className="btn" type="button" onClick={onRefresh}>
            Refresh
          </button>
          <a
            className="btn"
            href={`${API_URL}/api/finance/projects/${projectId}/report.xlsx?company_id=${encodeURIComponent(companyId)}`}
          >
            Export
          </a>
        </div>
      </div>

      {kpisReady ? (
        <div className="fdg-kpi-strip fdg-kpi-strip-6">
          <button type="button" className="fdg-kpi blue" onClick={() => void loadBreakdown("contract_value", "Contract value")}>
            <span className="label">Contract</span>
            <span className="value">{approved}</span>
          </button>
          <button type="button" className="fdg-kpi" onClick={() => void loadBreakdown("cost_to_date", "Cost to date")}>
            <span className="label">Cost to date</span>
            <span className="value">{incurred}</span>
          </button>
          <button type="button" className="fdg-kpi" onClick={() => void loadBreakdown("open_commitments", "Open commitments")}>
            <span className="label">Open commitments</span>
            <span className="value">{commitments}</span>
          </button>
          <button type="button" className={`fdg-kpi${incomplete ? " amber" : ""}`} onClick={() => void loadBreakdown("cost_to_complete", "Cost to complete")}>
            <span className="label">Cost to complete</span>
            <span className="value">{ctc}</span>
          </button>
          <button type="button" className={`fdg-kpi${incomplete ? " amber" : ""}`} onClick={() => void loadBreakdown("forecast_final_cost", "Forecast final cost")}>
            <span className="label">Forecast final</span>
            <span className="value">{finalCost}</span>
          </button>
          <button
            type="button"
            className={`fdg-kpi${profitTone === "red" ? " red" : profitTone === "amber" ? " amber" : " green"}`}
            onClick={() => void loadBreakdown("forecast_profit", "Forecast profit")}
          >
            <span className="label">Forecast profit</span>
            <span className="value">{profit}</span>
          </button>
        </div>
      ) : (
        <p className="notice amber" role="status">
          Primary KPIs incomplete — missing contract and/or CTC. Totals are not forced to zero.
        </p>
      )}

      <p className="sub">Margin {margin}.</p>

      <FinanceDataGrid
        columns={COLUMNS}
        rows={gridRows}
        emptyTitle="No cost categories"
        emptyText="Cost categories will appear when eligible allocations exist for this project."
        onToggle={(row) => {
          const category = String(row.meta?.category || row.cells.code || "");
          const next = !expanded[category];
          setExpanded((prev) => ({ ...prev, [category]: next }));
          if (next) void ensureChildren(category);
        }}
        onAmountClick={(metricId, row, columnId) => {
          const map: Record<string, { metric: string; title: string }> = {
            actual: { metric: row.depth && row.depth >= 1 ? "actual_eligible" : "cost_to_date", title: row.depth && row.depth >= 1 ? "Actual eligible cost" : "Cost to date" },
            commitments: { metric: "open_commitments", title: "Open commitments" },
            ctc: { metric: "cost_to_complete", title: "Cost to complete" },
            final: { metric: "forecast_final_cost", title: "Forecast final cost" },
            margin: { metric: "forecast_profit", title: "Forecast profit" },
            budget: { metric: "contract_value", title: "Contract value" },
          };
          const hit = map[columnId] || { metric: metricId, title: metricId };
          void loadBreakdown(hit.metric, hit.title);
        }}
      />

      {attention.length ? (
        <div className="attention-compact">
          <strong>Needs attention</strong>
          <ul>
            {attention.slice(0, 5).map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => {
                    onExplain(item.title, item.reason, item.recommendedAction);
                    if (item.available && item.sheet) {
                      onNavigate({ sheet: item.sheet, focus: item.focus, expenseFilter: item.expenseFilter });
                    }
                  }}
                >
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isForecastLoss(cvr.forecast_final_profit) ? (
        <p className="notice bad" role="status">
          Forecast loss — amount shown in the profit KPI.
        </p>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <CommercialPerformanceChart
          title="CVR commercial performance"
          subtitle="Secondary chart — validated snapshot only. No invented monthly history."
          bars={chartBars}
          demo={demoMode}
        />
      </div>

      <FinanceSourceDrawer
        open={drawerOpen}
        title={drawerTitle}
        payload={drawerPayload}
        loading={drawerLoading}
        error={drawerError}
        onClose={() => setDrawerOpen(false)}
        onOpenDocument={(documentId) => {
          onNavigate({ sheet: "Project Expenses", expenseFilter: documentId });
          onExplain(
            "Supplier document",
            `Opening authorised Project Expenses detail for document ${documentId}.`,
            "Settlement, credits and payments remain on the Expenses register.",
          );
        }}
      />
    </>
  );
}

function demoBreakdown(metric: string, cvr: Row, allocations: DemoAllocation[]): SourceBreakdownPayload {
  const projectId = String(cvr.id || "");

  if (metric === "actual_eligible" || metric === "cost_to_date_eligible") {
    const rows = allocations.map((row) => ({
      id: row.id,
      reference: row.reference,
      source_type: row.source_type || "supplier_invoice",
      document_date: row.document_date,
      status: "posted",
      cost_code: `${row.costCode} / ${row.costCodeName}`,
      amount: row.amount,
      net: row.net,
      vat_non_recoverable: row.vat_non_recoverable,
      document_id: row.document_id,
    }));
    const total = String(cvr.actual_eligible_cost || "missing");
    const check = reconcileKpiToContributions(total, rows.map((row) => row.amount));
    return {
      metric,
      company_id: "demo",
      project_id: projectId,
      displayed_total: total,
      formula: "sum(posted allocation.amount_eligible)",
      basis: "eligible = net + non-recoverable VAT",
      reconcilable: check.verification === "RECONCILED",
      verification: check.verification,
      difference: check.difference,
      source_total: check.sourceTotal,
      verified_subtotal: check.sourceTotal,
      unverified_subtotal: "0.0000",
      components_incomplete: false,
      groups: [
        {
          id: "actual",
          label: "Posted eligible allocations (DEMO)",
          total: check.sourceTotal,
          verification: check.verification,
          rows,
        },
      ],
      warnings: [],
    };
  }

  if (metric === "cost_to_date" || metric === "actual_incurred" || metric === "actual_incurred_cost") {
    const eligibleRows = allocations.map((row) => ({
      id: row.id,
      reference: row.reference,
      source_type: row.source_type || "supplier_invoice",
      document_date: row.document_date,
      status: "posted",
      cost_code: `${row.costCode} / ${row.costCodeName}`,
      amount: row.amount,
      net: row.net,
      vat_non_recoverable: row.vat_non_recoverable,
      document_id: row.document_id,
    }));
    const eligibleTotal = String(cvr.actual_eligible_cost || "missing");
    const cis = String(cvr.cis_labour_gross ?? "missing");
    const displayed = String(cvr.actual_incurred_cost || "missing");
    const eligibleCheck = reconcileKpiToContributions(
      eligibleTotal,
      eligibleRows.map((row) => row.amount),
    );
    const contributions =
      cis === "missing" ? eligibleRows.map((row) => row.amount) : [...eligibleRows.map((row) => row.amount), cis];
    const globalCheck = reconcileKpiToContributions(displayed, contributions, { allComponentsKnown: false });
    return {
      metric,
      company_id: "demo",
      project_id: projectId,
      displayed_total: displayed,
      formula: "actual_eligible_cost + cis_labour_gross",
      basis:
        "Authoritative compose_cvr_forecast: actual_incurred = actual_eligible_cost + cis_labour_gross. DEMO fixture: 580000 + 22500 = 602500.",
      reconcilable: false,
      verification: "PARTIAL",
      formula_check: globalCheck.difference === "0.0000" && displayed !== "missing" ? "MATCH" : displayed === "missing" ? "INCOMPLETE" : "MISMATCH",
      source_verification: "PARTIAL",
      difference: globalCheck.difference,
      source_total: globalCheck.sourceTotal,
      verified_subtotal: eligibleCheck.sourceTotal,
      unverified_subtotal: cis === "missing" ? "missing" : cis,
      components_incomplete: true,
      groups: [
        {
          id: "actual_eligible",
          label: "Actual eligible cost (documented)",
          total: eligibleCheck.sourceTotal,
          verification: eligibleCheck.verification,
          note: "Posted allocations for this project.",
          rows: eligibleRows,
        },
        {
          id: "cis_labour",
          label: "CIS labour gross",
          total: cis,
          verification: "SOURCE BREAKDOWN UNAVAILABLE — NOT VERIFIED",
          note: "CVR field cis_labour_gross — no CIS split register.",
          rows: [],
        },
      ],
      warnings: [],
    };
  }

  if (metric === "contract_value") {
    const original = String(cvr.original_contract_value || "missing");
    const variations = String(cvr.approved_variations || "missing");
    const dayworks = String(cvr.approved_dayworks_in_contract || "missing");
    const displayed = String(cvr.approved_contract_value || "missing");
    const known = [original, variations, dayworks].filter((v) => v !== "missing");
    const check = reconcileKpiToContributions(displayed, known.length ? known : ["0.0000"], {
      allComponentsKnown: false,
    });
    return {
      metric,
      company_id: "demo",
      project_id: projectId,
      displayed_total: displayed,
      formula: "original + approved_variations + approved_dayworks_in_contract",
      basis: "compose_cvr_forecast approved_contract",
      reconcilable: false,
      verification: "PARTIAL",
      formula_check: check.difference === "0.0000" && displayed !== "missing" ? "MATCH" : displayed === "missing" ? "INCOMPLETE" : "MISMATCH",
      source_verification: "SOURCE BREAKDOWN UNAVAILABLE — NOT VERIFIED",
      difference: check.difference,
      source_total: check.sourceTotal,
      verified_subtotal: "missing",
      unverified_subtotal: displayed,
      components_incomplete: true,
      groups: [
        {
          id: "original",
          label: "Original contract",
          total: original,
          verification: "SOURCE BREAKDOWN UNAVAILABLE — NOT VERIFIED",
          note: "No revision register.",
          rows: [],
        },
        {
          id: "variations",
          label: "Approved variations",
          total: variations,
          verification: "SOURCE BREAKDOWN UNAVAILABLE — NOT VERIFIED",
          note: "CVR field only — no source documents listed.",
          rows: [],
        },
        {
          id: "dayworks",
          label: "Approved dayworks in contract",
          total: dayworks,
          verification: "SOURCE BREAKDOWN UNAVAILABLE — NOT VERIFIED",
          note: "CVR field only — no daywork documents listed.",
          rows: [],
        },
      ],
      warnings: [],
    };
  }

  if (metric === "open_commitments") {
    const open = String(cvr.open_commitments || cvr.open_commitment || "missing");
    return {
      metric,
      company_id: "demo",
      project_id: projectId,
      displayed_total: open,
      formula: "committed_amount - posted draws",
      basis: "Open remaining only — not actual incurred cost",
      reconcilable: false,
      verification: "PARTIAL",
      difference: "0.0000",
      source_total: open,
      verified_subtotal: "missing",
      unverified_subtotal: open,
      components_incomplete: true,
      groups: [
        {
          id: "commitments",
          label: "Open commitments",
          total: open,
          verification: "PARTIAL",
          note: "Draw register not fully listable.",
          rows: [],
        },
      ],
      warnings: [],
    };
  }

  if (metric === "cost_to_complete") {
    const value = String(cvr.cost_to_complete || "missing");
    return {
      metric,
      company_id: "demo",
      project_id: projectId,
      displayed_total: value,
      formula: "latest cost_to_complete estimate",
      basis: "No revision list — missing is not zero",
      reconcilable: false,
      verification: "SOURCE BREAKDOWN UNAVAILABLE — NOT VERIFIED",
      difference: "0.0000",
      source_total: value,
      verified_subtotal: "missing",
      unverified_subtotal: value,
      components_incomplete: true,
      groups: [
        {
          id: "ctc",
          label: "Cost to complete",
          total: value,
          verification: "SOURCE BREAKDOWN UNAVAILABLE — NOT VERIFIED",
          note: "Latest estimate — no CTC revision list.",
          rows: [],
        },
      ],
      warnings: [],
    };
  }

  if (metric === "forecast_final_cost") {
    const incurredVal = String(cvr.actual_incurred_cost || "missing");
    const open = String(cvr.open_commitments || cvr.open_commitment || "missing");
    const ctcVal = String(cvr.cost_to_complete || "missing");
    const displayed = String(cvr.forecast_final_cost || "missing");
    const parts = [incurredVal, open, ctcVal].filter((v) => v !== "missing");
    const check = reconcileKpiToContributions(displayed === "missing" ? "0.0000" : displayed, parts, {
      allComponentsKnown: false,
    });
    return {
      metric,
      company_id: "demo",
      project_id: projectId,
      displayed_total: displayed,
      formula: "actual_incurred + open_commitment + cost_to_complete",
      basis: "compose_cvr_forecast; DEMO 602500 + 165000 + 390000 = 1157500",
      reconcilable: false,
      verification: "PARTIAL",
      difference: displayed === "missing" ? "0.0000" : check.difference,
      source_total: check.sourceTotal,
      verified_subtotal: "missing",
      unverified_subtotal: check.sourceTotal,
      components_incomplete: true,
      groups: [
        {
          id: "incurred",
          label: "Cost to date (actual incurred)",
          total: incurredVal,
          verification: "PARTIAL",
          note: "Eligible + CIS (CIS unverified).",
          rows: [],
        },
        {
          id: "open",
          label: "Open commitments",
          total: open,
          verification: "PARTIAL",
          note: "Remaining only.",
          rows: [],
        },
        {
          id: "ctc",
          label: "Cost to complete",
          total: ctcVal,
          verification: "SOURCE BREAKDOWN UNAVAILABLE — NOT VERIFIED",
          note: "Latest estimate — no revision list.",
          rows: [],
        },
      ],
      warnings: [],
    };
  }

  if (metric === "forecast_profit") {
    const contract = String(cvr.approved_contract_value || "missing");
    const finalCost = String(cvr.forecast_final_cost || "missing");
    const displayed = String(cvr.forecast_final_profit || cvr.forecast_margin || "missing");
    return {
      metric,
      company_id: "demo",
      project_id: projectId,
      displayed_total: displayed,
      formula: "approved_contract - forecast_final_cost",
      basis: "Indicative forecast profit — not recognised accounting profit. DEMO 1250000 - 1157500 = 92500",
      reconcilable: false,
      verification: "PARTIAL",
      difference: "0.0000",
      source_total: displayed,
      verified_subtotal: "missing",
      unverified_subtotal: displayed,
      components_incomplete: true,
      groups: [
        {
          id: "contract",
          label: "Approved contract value",
          total: contract,
          verification: "PARTIAL",
          rows: [],
        },
        {
          id: "final",
          label: "Less forecast final cost",
          total: finalCost === "missing" ? "missing" : `-${finalCost}`,
          verification: "PARTIAL",
          rows: [],
        },
      ],
      warnings: [],
    };
  }

  return {
    metric,
    company_id: "demo",
    project_id: projectId,
    displayed_total: "missing",
    formula: "unsupported",
    basis: "No DEMO breakdown for this metric",
    reconcilable: false,
    verification: "SOURCE BREAKDOWN UNAVAILABLE — NOT VERIFIED",
    difference: "0.0000",
    source_total: "missing",
    groups: [],
    warnings: [],
  };
}
