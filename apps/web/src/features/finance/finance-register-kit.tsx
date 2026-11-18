"use client";

import { FinanceDataGrid, type FinanceGridColumn, type FinanceGridRow, type FinanceMoneyCell } from "./finance-data-grid";
import { FinanceFieldState, FinanceStatusChip, type FinanceFieldKind } from "./finance-field-state";
import { formatGbp, type MoneyValue, type Worksheet } from "./presentation";
import type { SourceBreakdownPayload } from "./finance-reconcile";

function minorToDecimal(minor: bigint): string {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const whole = absolute / 10000n;
  const fraction = (absolute % 10000n).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function moneyCell(
  value: MoneyValue | bigint,
  kind: FinanceFieldKind = "calculated",
): FinanceMoneyCell {
  if (typeof value === "bigint") {
    return { value: minorToDecimal(value), kind };
  }
  if (value === null || value === undefined || value === "" || value === "missing") {
    return { value: "missing", kind: "missing-required" };
  }
  const text = String(value).trim();
  if (!text || /^not (determined|recorded|on this register)/i.test(text)) {
    return { value: "missing", kind: "missing-required" };
  }
  return { value: text, kind };
}

export function knownOrMissing(value: MoneyValue): FinanceMoneyCell {
  return formatGbp(value) ? moneyCell(value, "source-linked") : moneyCell("missing", "missing-required");
}

export function statusTone(status: string): "neutral" | "amber" | "red" | "green" | "blue" {
  if (/paid|approved|posted|settled|fully|verified/i.test(status) && !/part|review|demo|not/i.test(status)) return "green";
  if (/draft|reversed|not available|incomplete/i.test(status)) return "neutral";
  if (/overdue|error|missing|needs correction/i.test(status)) return "red";
  if (/part|review|not determined|not confirmed|not verified/i.test(status)) return "amber";
  return "blue";
}

export function statusChip(label: string, tone?: "neutral" | "amber" | "red" | "green" | "blue") {
  return <FinanceStatusChip tone={tone ?? statusTone(label)}>{label}</FinanceStatusChip>;
}

export function FieldStateLegend() {
  return (
    <div className="ff-legend" aria-label="Field state legend">
      <span><FinanceFieldState kind="missing-required" readOnly>Not provided</FinanceFieldState> Required / missing</span>
      <span><FinanceFieldState kind="calculated" readOnly>£0.00</FinanceFieldState> Calculated</span>
      <span><FinanceFieldState kind="source-linked" readOnly>£0.00</FinanceFieldState> Source-linked</span>
      <span><FinanceStatusChip tone="neutral">Not verified</FinanceStatusChip></span>
      <span><FinanceStatusChip tone="green">Verified</FinanceStatusChip></span>
      <span><FinanceStatusChip tone="amber">Warning</FinanceStatusChip></span>
      <span><FinanceStatusChip tone="red">Error</FinanceStatusChip></span>
    </div>
  );
}

export function explainToPayload(input: {
  title: string;
  body: string;
  warning: string;
  companyId?: string;
  projectId?: string;
  amount?: MoneyValue;
}): SourceBreakdownPayload {
  const displayed =
    input.amount === null || input.amount === undefined || input.amount === ""
      ? "missing"
      : String(input.amount);
  return {
    metric: input.title,
    company_id: input.companyId || "",
    project_id: input.projectId || "",
    displayed_total: displayed === "missing" || !formatGbp(displayed) ? "missing" : displayed,
    formula: input.title,
    basis: input.body,
    reconcilable: false,
    verification: "PARTIAL",
    formula_check: "INCOMPLETE",
    source_verification: "PARTIAL",
    difference: "missing",
    source_total: "missing",
    components_incomplete: true,
    groups: [],
    warnings: input.warning ? [input.warning] : [],
  };
}

export function RegisterGrid({
  columns,
  rows,
  emptyTitle,
  emptyText,
  compactMetricColumnIds,
  onAmountClick,
  onRowSelect,
}: {
  columns: FinanceGridColumn[];
  rows: FinanceGridRow[];
  emptyTitle?: string;
  emptyText?: string;
  compactMetricColumnIds?: string[];
  onAmountClick?: (metricId: string, row: FinanceGridRow, columnId: string) => void;
  onRowSelect?: (row: FinanceGridRow) => void;
}) {
  return (
    <FinanceDataGrid
      columns={columns}
      rows={rows}
      emptyTitle={emptyTitle}
      emptyText={emptyText}
      compactMetricColumnIds={compactMetricColumnIds}
      onAmountClick={onAmountClick}
      onRowSelect={onRowSelect}
    />
  );
}

export type ReportCatalogueItem = {
  id: string;
  title: string;
  description: string;
  scope: string;
  period: string;
  available: boolean;
  reason: string;
  sourceBasis: string;
  sheet: Worksheet | "audit";
};

export function buildReportsCatalogue(input: {
  projectSelected: boolean;
  projectName: string;
  hasCvr: boolean;
  costCount: number;
  customerInvoiceCount: number;
  receiptCount: number;
  cisCount: number;
  certificateCount: number;
  dayworkCount: number;
  fundingCount: number;
  taxPresent: boolean;
}): ReportCatalogueItem[] {
  const scope = input.projectSelected ? "Project" : "Company";
  const period = "All available";
  return [
    {
      id: "cvr",
      title: "Project CVR",
      description: "Commercial value, cost, forecast and margin for the selected project.",
      scope,
      period,
      available: input.projectSelected && input.hasCvr,
      reason: input.projectSelected
        ? (input.hasCvr ? "CVR snapshot loaded" : "No validated commercial CVR for this project")
        : "Select a project to open Project CVR",
      sourceBasis: "Contract, costs, commitments, forecast",
      sheet: "PROJECT CONTROL",
    },
    {
      id: "supplier-costs",
      title: "Supplier costs register",
      description: "Supplier invoices, credits and outstanding liability.",
      scope,
      period,
      available: input.costCount > 0,
      reason: input.costCount > 0 ? `${input.costCount} cost document(s)` : "No supplier records",
      sourceBasis: "Cost documents",
      sheet: "Project Expenses",
    },
    {
      id: "payroll",
      title: "Payroll Finance (CIS / PAYE)",
      description: "Worker bank settlements and CIS tax where approved snapshots exist.",
      scope: "Company",
      period,
      available: input.cisCount > 0,
      reason: input.cisCount > 0 ? `${input.cisCount} CIS snapshot row(s)` : "No approved payroll snapshots",
      sourceBasis: "Approved CIS / PAYE snapshots",
      sheet: "Payment Register",
    },
    {
      id: "customers",
      title: "Customer invoices & receipts",
      description: "Billed amounts and cash received.",
      scope,
      period,
      available: input.customerInvoiceCount + input.receiptCount > 0,
      reason:
        input.customerInvoiceCount + input.receiptCount > 0
          ? `${input.customerInvoiceCount} invoice(s), ${input.receiptCount} receipt(s)`
          : "No customer documents",
      sourceBasis: "Customer invoices, receipts",
      sheet: "Customer Invoices",
    },
    {
      id: "commercial",
      title: "Commercial (dayworks / retention)",
      description: "Dayworks, variations and retention certificates where recorded.",
      scope,
      period,
      available: input.dayworkCount + input.certificateCount > 0,
      reason:
        input.dayworkCount + input.certificateCount > 0
          ? `${input.dayworkCount} daywork(s), ${input.certificateCount} certificate(s)`
          : "No commercial register rows",
      sourceBasis: "Dayworks, variations, certificates",
      sheet: "DAYWORKS LIVE",
    },
    {
      id: "loans",
      title: "Loans & advances",
      description: "Loan principal movements — not trading income.",
      scope: "Company",
      period,
      available: input.fundingCount > 0,
      reason: input.fundingCount > 0 ? `${input.fundingCount} funding row(s)` : "No loan movements",
      sourceBasis: "Funding register",
      sheet: "Loans & Advances",
    },
    {
      id: "vat",
      title: "VAT reconciliation",
      description: "Recorded VAT control totals — not a filed return.",
      scope: "Company",
      period,
      available: input.taxPresent,
      reason: input.taxPresent ? "Tax control loaded" : "No tax control totals",
      sourceBasis: "Posted input/output VAT",
      sheet: "VAT Reconciliation",
    },
    {
      id: "audit",
      title: "Audit trail",
      description: "Existing finance audit events for this company.",
      scope: "Company",
      period,
      available: true,
      reason: "Always available",
      sourceBasis: "Audit events",
      sheet: "audit",
    },
  ];
}

export function ReportsCatalogue({
  items,
  projectLabel,
  onOpen,
}: {
  items: ReportCatalogueItem[];
  projectLabel: string;
  onOpen: (item: ReportCatalogueItem) => void;
}) {
  const columns: FinanceGridColumn[] = [
    { id: "report", label: "Report" },
    { id: "scope", label: "Scope", width: "110px" },
    { id: "period", label: "Period", width: "120px", compactHide: true },
    { id: "availability", label: "Availability / verification", width: "200px" },
    { id: "basis", label: "Source basis", compactHide: true },
    { id: "action", label: "Action", width: "120px" },
  ];
  const rows: FinanceGridRow[] = items.map((item) => ({
    id: item.id,
    cells: {
      report: (
        <div>
          <strong>{item.title}</strong>
          <div className="sub">{item.description}</div>
        </div>
      ),
      scope: statusChip(item.scope, "neutral"),
      period: item.period,
      availability: item.available
        ? statusChip("Available", "green")
        : (
          <div>
            {statusChip("Not available", "neutral")}
            <div className="sub">{item.reason}</div>
          </div>
        ),
      basis: item.sourceBasis,
      action: (
        <button
          type="button"
          className={`btn${item.available || item.sheet === "audit" ? "" : ""}`}
          onClick={() => onOpen(item)}
        >
          {item.sheet === "audit" ? "Open" : item.available ? "Open" : "View basis"}
        </button>
      ),
    },
  }));

  return (
    <div className="fin-reports">
      <div className="pagehead">
        <div>
          <h2>Reports — {projectLabel}</h2>
          <div className="sub">
            Existing Finance worksheets and controls only. Reports stay unavailable until validated sources exist — no invented outputs.
          </div>
        </div>
      </div>
      <FinanceDataGrid
        columns={columns}
        rows={rows}
        emptyTitle="No reports listed"
        emptyText="No report worksheets are registered for this company."
        compactMetricColumnIds={["availability"]}
      />
      <FieldStateLegend />
    </div>
  );
}

export function PositionLines({ lines }: { lines: Array<{ label: string; amount: MoneyValue }> }) {
  const rows: FinanceGridRow[] = lines.map((line, index) => ({
    id: `pos-${index}`,
    cells: {
      label: line.label,
      amount: moneyCell(line.amount, "calculated"),
    },
  }));
  return (
    <FinanceDataGrid
      columns={[
        { id: "label", label: "Position line" },
        { id: "amount", label: "Amount", money: true, align: "right" },
      ]}
      rows={rows}
      emptyTitle="No position lines"
      emptyText="Supplier position totals are not loaded."
      compactMetricColumnIds={["amount"]}
    />
  );
}
