/**
 * Local-only DEMO fixture for Finance visual QA.
 * Never used by production FinanceWorkspace loads from Finance Core.
 */

import type { Company } from "@/features/companies/api";

import type { CommercialBar } from "./finance-chart";

export const DEMO_COMPANY: Company = {
  id: "demo-company-001",
  name: "Demo Construction Ltd",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

export const DEMO_PROJECT_ID = "demo-project-nlo";
export const DEMO_PROJECT_B_ID = "demo-project-riverside";

/** Four-decimal Finance Core style amounts for DEMO CVR / invoices. */
export const DEMO_BOOKS = {
  projects: [
    {
      id: DEMO_PROJECT_ID,
      name: "New London Office",
      reference_code: "NL-2026",
      status: "active",
    },
    {
      id: DEMO_PROJECT_B_ID,
      name: "Riverside Fit-Out",
      reference_code: "RS-2026",
      status: "active",
    },
  ],
  parties: [
    { id: "sup-1", name: "SteelFrame Ltd", counterparty_type: "supplier" },
    { id: "sup-2", name: "SiteHire Co", counterparty_type: "supplier" },
    { id: "sup-3", name: "ReadyMix UK", counterparty_type: "supplier" },
    { id: "cus-1", name: "Northbank Developments", counterparty_type: "customer" },
  ],
  codes: [],
  costs: [
    {
      id: "cost-1",
      document_type: "supplier_invoice",
      status: "posted",
      counterparty_id: "sup-1",
      external_reference: "INV-1042",
      document_date: "2026-03-12",
      project_names: "New London Office",
      project_ids: DEMO_PROJECT_ID,
      net_amount: "40166.6700",
      tax_amount: "8033.3300",
      gross_amount: "48200.0000",
      outstanding: "18000.0000",
      cash_paid: "30200.0000",
      credit_applied: "0.0000",
      payment_references: "BP-2201",
    },
    {
      id: "cost-2",
      document_type: "supplier_invoice",
      status: "posted",
      counterparty_id: "sup-2",
      external_reference: "INV-1048",
      document_date: "2026-04-02",
      project_names: "New London Office",
      project_ids: DEMO_PROJECT_ID,
      net_amount: "10500.0000",
      tax_amount: "2100.0000",
      gross_amount: "12600.0000",
      outstanding: "12600.0000",
      cash_paid: "0.0000",
      credit_applied: "0.0000",
      payment_references: "",
    },
    {
      id: "cost-3",
      document_type: "supplier_invoice",
      status: "posted",
      counterparty_id: "sup-3",
      external_reference: "INV-1051",
      document_date: "2026-04-18",
      project_names: "Riverside Fit-Out",
      project_ids: DEMO_PROJECT_B_ID,
      net_amount: "56333.3300",
      tax_amount: "11266.6700",
      gross_amount: "67600.0000",
      outstanding: "9500.0000",
      cash_paid: "56100.0000",
      credit_applied: "2000.0000",
      payment_references: "BP-2210",
    },
    {
      id: "cost-split",
      document_type: "supplier_invoice",
      status: "posted",
      counterparty_id: "sup-1",
      external_reference: "INV-SPLIT-77",
      document_date: "2026-04-20",
      project_names: "New London Office; Riverside Fit-Out",
      project_ids: `${DEMO_PROJECT_ID},${DEMO_PROJECT_B_ID}`,
      net_amount: "10000.0000",
      tax_amount: "2000.0000",
      gross_amount: "12000.0000",
      outstanding: "4000.0000",
      cash_paid: "6000.0000",
      credit_applied: "2000.0000",
      payment_references: "BP-2299",
      allocation_notes: "Split across two projects; company-wide totals count the document once",
    },
  ],
  supplierPayments: [],
  customerInvoices: [
    {
      id: "inv-1",
      status: "posted",
      document_kind: "invoice",
      project_id: DEMO_PROJECT_ID,
      counterparty_id: "cus-1",
      external_reference: "CI-9001",
      due_date: "2026-05-01",
      net_amount: "208333.3300",
      gross_amount: "250000.0000",
    },
  ],
  receipts: [
    {
      id: "rcpt-1",
      status: "posted",
      amount: "180000.0000",
      allocated_amount: "180000.0000",
      receipt_reversed: false,
    },
  ],
  tax: null,
  certificates: [],
  releases: [],
  applications: [],
  variations: [],
  dayworks: [],
  commitments: [],
  funding: [],
  openings: [],
  audit: [],
  position: null,
  cis: [],
  workerPayments: [],
  cisSources: [],
  payeSources: [],
  cvrs: [
    {
      id: DEMO_PROJECT_ID,
      name: "New London Office",
      reference_code: "NL-2026",
      original_contract_value: "1200000.0000",
      approved_variations: "50000.0000",
      approved_dayworks_in_contract: "0.0000",
      approved_contract_value: "1250000.0000",
      approved_budget: "1100000.0000",
      actual_eligible_cost: "580000.0000",
      cis_labour_gross: "22500.0000",
      actual_incurred_cost: "602500.0000",
      open_commitments: "165000.0000",
      open_commitment: "165000.0000",
      cost_to_complete: "390000.0000",
      forecast_final_cost: "1157500.0000",
      forecast_final_profit: "92500.0000",
      forecast_margin: "92500.0000",
      forecast_final_margin_percent: "7.40",
      review_required: "",
    },
    {
      id: DEMO_PROJECT_B_ID,
      name: "Riverside Fit-Out",
      reference_code: "RS-2026",
      original_contract_value: "missing",
      approved_variations: "missing",
      approved_dayworks_in_contract: "missing",
      approved_contract_value: "missing",
      approved_budget: "missing",
      actual_eligible_cost: "67500.0000",
      cis_labour_gross: "0.0000",
      actual_incurred_cost: "67500.0000",
      open_commitments: "12000.0000",
      open_commitment: "12000.0000",
      cost_to_complete: "missing",
      forecast_final_cost: "missing",
      forecast_final_profit: "missing",
      forecast_margin: "missing",
      forecast_final_margin_percent: "missing",
      review_required: "Missing CTC and contract",
    },
  ],
};

export const DEMO_COST_CODES = [
  { code: "01-STR", name: "Structure" },
  { code: "02-MEP", name: "MEP" },
  { code: "03-FIN", name: "Finishes" },
  { code: "04-EXT", name: "External works" },
  { code: "05-PRE", name: "Preliminaries" },
  { code: "06-SUB", name: "Substructure" },
  { code: "07-ENV", name: "Envelope" },
  { code: "08-FF", name: "FF&E" },
];

/** DEMO only — local visual QA for Cost to Date expand without API. */
export const DEMO_ALLOCATION_LINES = [
  { id: "alloc-1", projectId: DEMO_PROJECT_ID, costCode: "01-STR", costCodeName: "Structure", reference: "INV-1042", document_date: "2026-03-12", amount: "90000.0000", net: "75000.0000", vat_non_recoverable: "15000.0000", document_id: "cost-1", source_type: "supplier_invoice" },
  { id: "alloc-2", projectId: DEMO_PROJECT_ID, costCode: "01-STR", costCodeName: "Structure", reference: "INV-1060", document_date: "2026-03-20", amount: "120000.0000", net: "100000.0000", vat_non_recoverable: "20000.0000", document_id: "cost-4", source_type: "supplier_invoice" },
  { id: "alloc-3", projectId: DEMO_PROJECT_ID, costCode: "02-MEP", costCodeName: "MEP", reference: "INV-1048", document_date: "2026-04-02", amount: "80000.0000", net: "66666.6700", vat_non_recoverable: "13333.3300", document_id: "cost-2", source_type: "supplier_invoice" },
  { id: "alloc-4", projectId: DEMO_PROJECT_ID, costCode: "02-MEP", costCodeName: "MEP", reference: "INV-1061", document_date: "2026-04-08", amount: "65000.0000", net: "54166.6700", vat_non_recoverable: "10833.3300", document_id: "cost-5", source_type: "supplier_invoice" },
  { id: "alloc-5", projectId: DEMO_PROJECT_ID, costCode: "03-FIN", costCodeName: "Finishes", reference: "INV-1062", document_date: "2026-04-10", amount: "70000.0000", net: "58333.3300", vat_non_recoverable: "11666.6700", document_id: "cost-6", source_type: "supplier_invoice" },
  { id: "alloc-6", projectId: DEMO_PROJECT_ID, costCode: "03-FIN", costCodeName: "Finishes", reference: "INV-1063", document_date: "2026-04-12", amount: "57500.0000", net: "47916.6700", vat_non_recoverable: "9583.3300", document_id: "cost-7", source_type: "supplier_invoice" },
  { id: "alloc-7", projectId: DEMO_PROJECT_ID, costCode: "04-EXT", costCodeName: "External works", reference: "INV-1064", document_date: "2026-04-14", amount: "25000.0000", net: "20833.3300", vat_non_recoverable: "4166.6700", document_id: "cost-8", source_type: "supplier_invoice" },
  { id: "alloc-8", projectId: DEMO_PROJECT_ID, costCode: "05-PRE", costCodeName: "Preliminaries", reference: "EXP-220", document_date: "2026-04-15", amount: "18000.0000", net: "15000.0000", vat_non_recoverable: "3000.0000", document_id: "cost-9", source_type: "expense_receipt" },
  { id: "alloc-9", projectId: DEMO_PROJECT_ID, costCode: "06-SUB", costCodeName: "Substructure", reference: "INV-1065", document_date: "2026-02-28", amount: "22000.0000", net: "18333.3300", vat_non_recoverable: "3666.6700", document_id: "cost-10", source_type: "supplier_invoice" },
  { id: "alloc-10", projectId: DEMO_PROJECT_ID, costCode: "07-ENV", costCodeName: "Envelope", reference: "INV-1066", document_date: "2026-03-05", amount: "20000.0000", net: "16666.6700", vat_non_recoverable: "3333.3300", document_id: "cost-11", source_type: "supplier_invoice" },
  { id: "alloc-11", projectId: DEMO_PROJECT_ID, costCode: "08-FF", costCodeName: "FF&E", reference: "INV-1067", document_date: "2026-04-16", amount: "12500.0000", net: "10416.6700", vat_non_recoverable: "2083.3300", document_id: "cost-12", source_type: "supplier_invoice" },
  { id: "alloc-r1", projectId: DEMO_PROJECT_B_ID, costCode: "01-STR", costCodeName: "Structure", reference: "INV-1051", document_date: "2026-04-18", amount: "67500.0000", net: "56250.0000", vat_non_recoverable: "11250.0000", document_id: "cost-3", source_type: "supplier_invoice" },
];

/** Split invoice allocations for company-wide unique-document tests (not part of NLO CVR 580k eligible). */
export const DEMO_SPLIT_ALLOCATIONS = [
  { id: "alloc-split-a", projectId: DEMO_PROJECT_ID, costCode: "05-PRE", costCodeName: "Preliminaries", reference: "INV-SPLIT-77", document_date: "2026-04-20", amount: "7000.0000", net: "5833.3300", vat_non_recoverable: "1166.6700", document_id: "cost-split", source_type: "supplier_invoice" },
  { id: "alloc-split-b", projectId: DEMO_PROJECT_B_ID, costCode: "05-PRE", costCodeName: "Preliminaries", reference: "INV-SPLIT-77", document_date: "2026-04-20", amount: "5000.0000", net: "4166.6700", vat_non_recoverable: "833.3300", document_id: "cost-split", source_type: "supplier_invoice" },
];

export const DEMO_CATEGORIES = [
  { category: "Structure", eligible: "210000.0000" },
  { category: "MEP", eligible: "145000.0000" },
  { category: "Finishes", eligible: "127500.0000" },
  { category: "External works", eligible: "25000.0000" },
  { category: "Preliminaries", eligible: "18000.0000" },
  { category: "Substructure", eligible: "22000.0000" },
  { category: "Envelope", eligible: "20000.0000" },
  { category: "FF&E", eligible: "12500.0000" },
];

export const DEMO_CHART_BARS: CommercialBar[] = [
  { id: "contract", label: "Contract value", value: "1250000.0000", kind: "contract" },
  { id: "incurred", label: "Cost to date", value: "602500.0000", kind: "cost" },
  { id: "commitments", label: "Open commitments", value: "165000.0000", kind: "commitment" },
  { id: "ctc", label: "Cost to complete", value: "390000.0000", kind: "forecast" },
  { id: "final", label: "Forecast final cost", value: "1157500.0000", kind: "forecast" },
  { id: "profit", label: "Forecast profit", value: "92500.0000", kind: "profit" },
];
