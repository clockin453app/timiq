export type MoneyValue = string | number | boolean | null | undefined;

/** Honest metric labels — never present experimental fields as live on every Finance DB. */
export const FINANCE_METRIC_LABELS = {
  liveAsOf: "LIVE AS-OF",
  storedMonthlySnapshot: "STORED MONTHLY SNAPSHOT",
  provisionalVow: "PROVISIONAL VOW",
  certifiedUnvalidated: "CERTIFIED UNVALIDATED",
  experimentalUnavailable: "EXPERIMENTAL / UNAVAILABLE",
} as const;

export function metricHonestyLabel(
  kind: keyof typeof FINANCE_METRIC_LABELS,
  options?: { experimentalSchemaPresent?: boolean },
): string {
  if (kind === "experimentalUnavailable" && options?.experimentalSchemaPresent) {
    return "EXPERIMENTAL / TEST-ONLY";
  }
  return FINANCE_METRIC_LABELS[kind];
}

/** Compact card status — never use the long honesty string as a giant card value. */
export function compactMetricStatus(
  kind: "experimentalUnavailable" | "certifiedUnvalidated" | "liveAsOf" | "missing",
): { badge: string; detail: string; tone: "amber" | "gray" } {
  if (kind === "experimentalUnavailable") {
    return { badge: "Experimental", detail: "Not available in current Finance", tone: "amber" };
  }
  if (kind === "certifiedUnvalidated") {
    return { badge: "Unvalidated", detail: "Certificate basis not approved — not official profit", tone: "amber" };
  }
  if (kind === "liveAsOf") {
    return { badge: "Live current", detail: "No cut-off selected", tone: "gray" };
  }
  return { badge: "Missing", detail: "Not determined from loaded Finance data", tone: "amber" };
}

export type MetricScope = "SELECTED PROJECT" | "COMPANY-WIDE" | "LIVE AS-OF" | "EXPERIMENTAL";

const SCALE = 10000n;

export const WORKSHEETS = [
  "PROJECT CONTROL",
  "Project Expenses",
  "Payment Register",
  "Customer Invoices",
  "Receipts Register",
  "VAT Reconciliation",
  "CIS Tax HMRC",
  "Retention Register",
  "DAYWORKS LIVE",
  "Loans & Advances",
] as const;

export type Worksheet = (typeof WORKSHEETS)[number];

export type FinanceNavigateTarget = {
  sheet: Worksheet;
  focus?: "attention-center" | "as-of-cutoff" | "portfolio" | "control-dashboard";
  expenseFilter?: string;
};

/** Plain-English worksheet groups mapped only to real existing worksheets. */
export const WORKSHEET_NAV: { group: string; items: { sheet: Worksheet; label: string; hint: string }[] }[] = [
  {
    group: "Overview & jobs",
    items: [
      { sheet: "PROJECT CONTROL", label: "Finance overview & Project Control", hint: "Company or one job: incurred cost, commitments, forecast and attention." },
    ],
  },
  {
    group: "Costs & suppliers",
    items: [
      { sheet: "Project Expenses", label: "Supplier invoices & credits", hint: "Post invoices, allocate net across jobs, view credits. Not bank payments." },
      { sheet: "Payment Register", label: "Supplier payments", hint: "Record bank settlements. Payments do not create project cost again." },
    ],
  },
  {
    group: "Customers & cash in",
    items: [
      { sheet: "Customer Invoices", label: "Customer invoices", hint: "Amounts billed to the customer." },
      { sheet: "Receipts Register", label: "Customer receipts", hint: "Cash received. Receipts do not create Value of Work." },
    ],
  },
  {
    group: "Commercial & tax",
    items: [
      { sheet: "VAT Reconciliation", label: "VAT reconciliation", hint: "Recorded VAT control — not a verified reclaim." },
      { sheet: "CIS Tax HMRC", label: "CIS tax (HMRC)", hint: "CIS tax view from Finance registers." },
      { sheet: "Retention Register", label: "Retention", hint: "Retention held and released where recorded." },
      { sheet: "DAYWORKS LIVE", label: "Basic Dayworks", hint: "Labour / materials / plant amount register on a7. Hours, rates, frozen rate and CVR-6 are experimental — not active." },
      { sheet: "Loans & Advances", label: "Loans & advances", hint: "Financing movements — not trading income or project cost." },
    ],
  },
];

export const FINANCE_FIGURE_HELP: Record<string, { title: string; body: string; warning: string }> = {
  actualIncurred: {
    title: "Actual Incurred Cost",
    body: "Eligible supplier cost allocated to the job, plus CIS labour gross where recorded. Supplier bank payments are not added again.",
    warning: "This is not Forecast Final Cost and not cash paid.",
  },
  openCommitments: {
    title: "Open Commitments",
    body: "Committed spend not yet fully drawn. Remaining commitment is not already-incurred cost.",
    warning: "Do not add open commitments on top of invoices already posted for the same work without reviewing overlap.",
  },
  additionalCtc: {
    title: "Additional Cost to Complete (CTC)",
    body: "An estimated remaining cost entered for the job. Missing CTC is not treated as £0.",
    warning: "If CTC is missing, Forecast Final Cost and margin stay Not determined.",
  },
  forecastFinalCost: {
    title: "Forecast Final Cost",
    body: "Actual incurred + open commitments + additional CTC when CTC is present.",
    warning: "Indicative. Not a month-end close and not recognised accounting profit.",
  },
  forecastProfit: {
    title: "Forecast Profit / Margin",
    body: "Approved contract minus Forecast Final Cost, with margin as a percent of contract when contract is known and positive.",
    warning: "Missing or zero contract cannot produce a meaningful margin. Losses are shown with a minus sign.",
  },
  supplierOutstanding: {
    title: "Supplier Outstanding",
    body: "COMPANY-WIDE document liability: posted supplier invoice/expense gross after supplier credits and allocated bank payments. A multi-job invoice is counted once. This is not project eligible incurred cost.",
    warning: "Outstanding is settlement, not project incurred cost. Credits are not bank payments.",
  },
  liveAsOf: {
    title: "LIVE AS-OF",
    body: "Position using document dates and the selected cut-off. A later-entered backdated document can still appear.",
    warning: "LIVE AS-OF is not a frozen month-end snapshot.",
  },
  experimentalVow: {
    title: "Internal VOW / certificates / accruals",
    body: "Persistent VOW, accrual matching, monthly snapshot close and site attribution remain experimental.",
    warning: metricHonestyLabel("experimentalUnavailable"),
  },
};

export function isForecastLoss(profit: MoneyValue): boolean {
  const minor = toMinor(profit);
  return minor !== null && minor < 0n;
}

export function forecastTone(profit: MoneyValue): "red" | "green" | "amber" | "" {
  if (profit === "missing" || profit === undefined || profit === null || profit === "") return "amber";
  if (isForecastLoss(profit)) return "red";
  const minor = toMinor(profit);
  if (minor !== null && minor === 0n) return "";
  if (minor !== null && minor > 0n) return "green";
  return "amber";
}

export type FinanceAttentionAction = {
  id: string;
  label: string;
  title: string;
  reason: string;
  recommendedAction: string;
  sheet: Worksheet | null;
  focus?: FinanceNavigateTarget["focus"];
  expenseFilter?: string;
  severity: "amber" | "red";
  available: boolean;
};

/** Map ownerControl attention strings to real worksheets when possible (1:1 with attention count). */
export function financeAttentionActions(attention: string[]): FinanceAttentionAction[] {
  return attention.map((label, index) => {
    const lower = label.toLowerCase();
    let sheet: Worksheet | null = "PROJECT CONTROL";
    let severity: "amber" | "red" = "amber";
    let focus: FinanceNavigateTarget["focus"] | undefined = "control-dashboard";
    let expenseFilter: string | undefined;
    let title = "Attention item";
    let recommendedAction = "Open Project Control and review the loaded figures.";
    let available = true;

    if (lower.includes("supplier invoice reference") || lower.includes("draft supplier")) {
      sheet = "Project Expenses";
      focus = undefined;
      expenseFilter = lower.includes("draft") ? "Draft" : "All";
      title = lower.includes("draft") ? "Draft supplier document" : "Supplier reference review";
      recommendedAction = "Open Supplier invoices & credits and resolve the draft or duplicate reference.";
    } else if (lower.includes("customer invoice") || lower.includes("overdue")) {
      sheet = "Customer Invoices";
      focus = undefined;
      title = lower.includes("overdue") ? "Overdue customer invoice" : "Customer invoice data";
      recommendedAction = "Open Customer invoices for the selected company.";
      if (lower.includes("overdue")) severity = "red";
    } else if (lower.includes("opening balance")) {
      sheet = "Loans & Advances";
      focus = undefined;
      title = "Opening balance review";
      recommendedAction = "Open Loans & advances and review opening balances.";
    } else if (lower.includes("retention")) {
      sheet = "Retention Register";
      focus = undefined;
      title = "Retention audit";
      recommendedAction = "Open Retention and verify release audit history.";
    } else if (lower.includes("forecast") && lower.includes("loss")) {
      severity = "red";
      title = "Forecast loss";
      focus = "portfolio";
      recommendedAction = "Review Forecast Profit on Project Control for the affected job.";
    } else if (lower.includes("cost to complete") || lower.includes("missing ctc") || (lower.includes("incomplete") && lower.includes("forecast"))) {
      title = "Incomplete forecast / missing CTC";
      focus = "portfolio";
      recommendedAction = "Review Project Control portfolio — CTC cannot be invented as £0.";
    } else if (lower.includes("certified") || lower.includes("unvalidated")) {
      title = "Certified basis unvalidated";
      recommendedAction = "This action is not yet available in current Finance — no experimental posting.";
      available = true;
      focus = "control-dashboard";
    } else if (lower.includes("multi-job")) {
      sheet = "Project Expenses";
      focus = undefined;
      title = "Multi-job supplier invoice";
      recommendedAction = "Open Supplier invoices & credits — outstanding stays COMPANY-WIDE.";
    } else if (lower.includes("experimental") || lower.includes("vow") || lower.includes("accrual")) {
      title = "Experimental / unavailable";
      recommendedAction = "This action is not yet available in current Finance.";
      available = false;
    } else if (lower.includes("vat")) {
      sheet = "VAT Reconciliation";
      focus = undefined;
      title = "VAT recoverability";
      recommendedAction = "Open VAT reconciliation — recorded VAT is not a verified reclaim.";
    } else if (lower.includes("commitment")) {
      title = "Open commitments reminder";
      focus = "control-dashboard";
      recommendedAction = "Review Open Commitments on Project Control — they are not incurred cost.";
    }

    return {
      id: `attn-${index}`,
      label,
      title,
      reason: label,
      recommendedAction,
      sheet,
      focus,
      expenseFilter,
      severity,
      available,
    };
  });
}

/** Build drill-down text from live CVR / register values — never hardcode DEMO GBP. */
export function projectControlDrilldown(
  kind:
    | "approvedContract"
    | "actualIncurred"
    | "supplierIncurred"
    | "cisGross"
    | "openCommitments"
    | "additionalCtc"
    | "forecastFinalCost"
    | "forecastProfit"
    | "forecastMargin"
    | "supplierOutstanding"
    | "customerInvoiced"
    | "cashReceived"
    | "approvedVariations"
    | "internalVow"
    | "certifiedValue"
    | "asOf"
    | "reliableProjects",
  input: {
    projectName: string;
    scope: MetricScope;
    row?: Record<string, MoneyValue> | null;
    supplierOutstanding?: string;
    supplierGross?: string;
    supplierCashPaid?: string;
    supplierCredits?: string;
    cashReceived?: string;
    customerInvoiced?: string;
    reliableProjects?: number;
    totalProjects?: number;
    incompleteNotes?: string[];
  },
): { title: string; body: string; warning: string; navigate?: FinanceNavigateTarget | null; interactive: boolean } {
  const row = input.row ?? null;
  const incurred = controlAmount(row?.actual_incurred_cost ?? row?.actual_eligible_cost);
  const eligible = controlAmount(row?.actual_eligible_cost);
  const commitments = controlAmount(row?.open_commitments ?? row?.open_commitment);
  const ctc = controlAmount(row?.cost_to_complete);
  const finalCost = controlAmount(row?.forecast_final_cost);
  const profit = controlAmount(row?.forecast_final_profit ?? row?.forecast_margin);
  const margin = controlPercent(row?.forecast_final_margin_percent);
  const contract = controlAmount(row?.approved_contract_value);
  const variations = controlAmount(row?.approved_variations);
  const cis = controlAmount(row?.cis_labour_gross);
  const scopeLine = `Scope: ${input.scope}.`;

  switch (kind) {
    case "approvedContract":
      return {
        title: "Approved Contract",
        body: `${scopeLine} Project ${input.projectName || "(company portfolio)"}. Approved contract value ${contract}. Original contract ${controlAmount(row?.original_contract_value)}. Approved variations ${variations}. Approved dayworks in contract ${controlAmount(row?.approved_dayworks_in_contract)}.`,
        warning: "Contract value is not cash received and not certified VOW.",
        navigate: null,
        interactive: true,
      };
    case "actualIncurred":
      return {
        title: "Actual Incurred Cost",
        body: `${scopeLine} Project ${input.projectName}. Actual incurred ${incurred}. Eligible supplier cost ${eligible}. CIS labour gross ${cis}. Supplier bank payments are not added again. Invoice gross is not this figure.`,
        warning: "Do not treat supplier invoice gross as project incurred cost.",
        navigate: { sheet: "Project Expenses", expenseFilter: "All" },
        interactive: true,
      };
    case "supplierIncurred":
      return {
        title: "Supplier incurred (eligible)",
        body: `${scopeLine} Project ${input.projectName}. Eligible supplier cost ${eligible}. Credits reduce eligible cost. Bank payments do not create cost again.`,
        warning: "Eligible cost follows allocated net under the VAT rule.",
        navigate: { sheet: "Project Expenses", expenseFilter: "All" },
        interactive: true,
      };
    case "cisGross":
      return {
        title: "CIS gross incurred",
        body: `${scopeLine} Project ${input.projectName}. Source field: CVR cis_labour_gross = ${cis}. This is project labour cost included in Actual Incurred — not CIS tax / HMRC deduction and not a bank payment. CIS Tax HMRC shows statutory deductions from approved snapshots, which is a different figure.`,
        warning: "This action is not yet available as a dedicated Finance cost register. Payroll Mark Paid / Paid-Locked are not opened from this card.",
        navigate: null,
        interactive: true,
      };
    case "openCommitments":
      return {
        title: "Open Commitments",
        body: `${scopeLine} Project ${input.projectName}. Open commitments ${commitments}. Open commitments are not actual incurred cost.`,
        warning: "Cost to complete must not double-count remaining committed work automatically.",
        navigate: null,
        interactive: true,
      };
    case "additionalCtc":
      return {
        title: "Additional Cost to Complete",
        body: `${scopeLine} Project ${input.projectName}. Additional CTC ${ctc}. Missing CTC stays MISSING — never silent £0.`,
        warning: row?.cost_to_complete === "missing"
          ? "This action is not yet available as an editor in current Finance when CTC is missing from the API."
          : "CTC comes from the loaded CVR row.",
        navigate: null,
        interactive: true,
      };
    case "forecastFinalCost":
      return {
        title: "Forecast Final Cost",
        body: `${scopeLine} Project ${input.projectName}. Actual Incurred ${incurred} + Open Commitments ${commitments} + Additional CTC ${ctc} = Forecast Final Cost ${finalCost}. Open accruals are not a separate live layer in current Finance.`,
        warning: "Do not add bank payments or invoice gross into this forecast.",
        navigate: null,
        interactive: true,
      };
    case "forecastProfit":
      return {
        title: "Forecast Profit",
        body: `${scopeLine} Project ${input.projectName}. Approved Contract ${contract} − Forecast Final Cost ${finalCost} = Forecast Profit ${profit}. This is an estimate to job completion.`,
        warning: "Not certified or official accounting profit.",
        navigate: null,
        interactive: true,
      };
    case "forecastMargin":
      return {
        title: "Forecast Margin",
        body: `${scopeLine} Project ${input.projectName}. Forecast Profit ${profit} / Approved Contract ${contract} = Forecast Margin ${margin}. Missing or zero contract cannot produce a meaningful margin.`,
        warning: "Forecast margin is not certified margin.",
        navigate: null,
        interactive: true,
      };
    case "supplierOutstanding":
      return {
        title: "Supplier Outstanding",
        body: `${scopeLine} Invoice gross ${input.supplierGross ?? "Not determined"}. Cash paid (bank) ${input.supplierCashPaid ?? "Not determined"}. Supplier credits ${input.supplierCredits ?? "Not determined"}. Outstanding ${input.supplierOutstanding ?? "Not determined"}. Multi-job invoices are counted once.`,
        warning: "COMPANY-WIDE document liability — not a single-project payable split.",
        navigate: { sheet: "Project Expenses", expenseFilter: "Outstanding" },
        interactive: true,
      };
    case "customerInvoiced":
      return {
        title: "Customer invoiced",
        body: `${scopeLine} Posted customer invoice net for the current selection: ${input.customerInvoiced ?? "Not determined"}.`,
        warning: "Invoiced is not Value of Work.",
        navigate: { sheet: "Customer Invoices" },
        interactive: true,
      };
    case "cashReceived":
      return {
        title: "Cash received",
        body: `${scopeLine} ${input.cashReceived ?? "Not determined"}. Receipts are settlement, not VOW.`,
        warning: "Reversed receipts are excluded where the register flags them.",
        navigate: { sheet: "Receipts Register" },
        interactive: true,
      };
    case "approvedVariations":
      return {
        title: "Approved variations",
        body: `${scopeLine} Project ${input.projectName}. Source field: CVR approved_variations = ${variations}. That contract uplift is not the same as Basic Dayworks amount rows (labour/materials/plant totals). BASIC DAYWORKS may list separate variation amount documents when loaded, but it is not the full CVR-6 approval engine.`,
        warning: "No experimental daywork/variation posting is opened from this card.",
        navigate: null,
        interactive: true,
      };
    case "internalVow": {
      const status = compactMetricStatus("experimentalUnavailable");
      return {
        title: "Internal VOW",
        body: `${scopeLine} Status: ${status.badge}. ${status.detail}. Persistent Internal VOW is not active on a7.`,
        warning: "No experimental posting route is opened from this card.",
        navigate: null,
        interactive: true,
      };
    }
    case "certifiedValue": {
      const status = compactMetricStatus("certifiedUnvalidated");
      return {
        title: "Certified value",
        body: `${scopeLine} Status: ${status.badge}. ${status.detail}. No official certified profit is invented from experimental VOW.`,
        warning: metricHonestyLabel("certifiedUnvalidated"),
        navigate: null,
        interactive: true,
      };
    }
    case "asOf":
      return {
        title: "Reporting basis",
        body: `${scopeLine} Live current position until a historical cut-off is selected below. As-of does not invent accruals or Internal VOW.`,
        warning: FINANCE_FIGURE_HELP.liveAsOf.warning,
        navigate: { sheet: "PROJECT CONTROL", focus: "as-of-cutoff" },
        interactive: true,
      };
    case "reliableProjects":
      return {
        title: "Projects with reliable data",
        body: `${scopeLine} ${input.reliableProjects ?? 0} of ${input.totalProjects ?? 0} loaded project(s) have contract, CTC, forecast final cost and forecast profit. ${(input.incompleteNotes ?? []).join(" ") || "No incomplete notes."}`,
        warning: "This is a count of complete forecast rows — not a reliability percentage.",
        navigate: { sheet: "PROJECT CONTROL", focus: "portfolio" },
        interactive: true,
      };
    default:
      return { title: "Figure", body: scopeLine, warning: "", navigate: null, interactive: false };
  }
}

export const INVOICE_LEARNING_STEPS = [
  "1. Choose supplier and invoice dates/reference",
  "2. Enter net and VAT (gross is calculated)",
  "3. Allocate eligible net across one or more projects",
  "4. Check allocated total and remaining net",
  "5. Save draft, then confirm post — posted documents stay read-only",
] as const;

function sumOrMissing(values: (bigint | null)[]): string {
  if (!values.length || values.some((value) => value === null)) return "Not determined";
  return formatGbp((values as bigint[]).reduce((sum, value) => sum + value, 0n));
}

/** Company/project portfolio cards from live CVR rows — never substitute £0 for missing CTC/contract. */
export function financePortfolioSummary(cvrs: Record<string, MoneyValue>[]): {
  approvedContract: string;
  actualIncurred: string;
  openCommitments: string;
  additionalCtc: string;
  forecastFinalCost: string;
  forecastProfit: string;
  forecastMargin: string;
  reliableProjects: number;
  missingContract: number;
  missingCtc: number;
  lossMaking: number;
} {
  const contracts = cvrs.map((row) => toMinor(row.approved_contract_value));
  const incurred = cvrs.map((row) => {
    const direct = toMinor(row.actual_incurred_cost);
    if (direct !== null) return direct;
    const eligible = toMinor(row.actual_eligible_cost);
    const labour = toMinor(row.cis_labour_gross);
    if (eligible !== null && labour !== null) return eligible + labour;
    return eligible;
  });
  const commitments = cvrs.map((row) => toMinor(row.open_commitments ?? row.open_commitment));
  const ctc = cvrs.map((row) => {
    const raw = row.cost_to_complete;
    if (raw === "missing" || raw === undefined || raw === null || String(raw).trim() === "") return null;
    return toMinor(raw);
  });
  const finals = cvrs.map((row) => toMinor(row.forecast_final_cost));
  const profits = cvrs.map((row) => toMinor(row.forecast_final_profit));
  const missingContract = contracts.filter((value) => value === null).length;
  const missingCtc = ctc.filter((value) => value === null).length;
  const lossMaking = profits.filter((value) => value !== null && value < 0n).length;
  const reliableProjects = cvrs.filter((row, index) => {
    return contracts[index] !== null && ctc[index] !== null && finals[index] !== null && profits[index] !== null;
  }).length;
  // Margin only when every project has a positive contract and known profit — otherwise MISSING.
  let forecastMargin = "Not determined";
  if (cvrs.length && contracts.every((value) => value !== null && value > 0n) && profits.every((value) => value !== null)) {
    const contractTotal = (contracts as bigint[]).reduce((sum, value) => sum + value, 0n);
    const profitTotal = (profits as bigint[]).reduce((sum, value) => sum + value, 0n);
    forecastMargin = percentOf(profitTotal, contractTotal);
  }
  return {
    approvedContract: sumOrMissing(contracts),
    actualIncurred: sumOrMissing(incurred),
    openCommitments: sumOrMissing(commitments),
    additionalCtc: missingCtc ? "MISSING / NOT AVAILABLE" : sumOrMissing(ctc),
    forecastFinalCost: missingCtc || finals.some((value) => value === null) ? "MISSING / NOT AVAILABLE" : sumOrMissing(finals),
    forecastProfit: missingCtc || profits.some((value) => value === null) ? "MISSING / NOT AVAILABLE" : sumOrMissing(profits),
    forecastMargin,
    reliableProjects,
    missingContract,
    missingCtc,
    lossMaking,
  };
}

export function controlColumns(width: number): string[] {
  if (width < 1024) {
    return ["Project", "Contract value", "Forecast final profit", "Forecast final margin %", "Review"];
  }
  return [
    "Project",
    "Contract value",
    "Actual incurred cost",
    "Open commitments",
    "Cost to complete",
    "Forecast final cost",
    "Forecast final profit",
    "Forecast final margin %",
    "Review",
  ];
}

export function controlAmount(value: string | number | boolean | null | undefined): string {
  if (value === undefined || value === null || value === "" || value === "missing") return "Not determined";
  return formatGbp(String(value));
}

export function controlPercent(value: string | number | boolean | null | undefined): string {
  if (value === undefined || value === null || value === "" || value === "missing") return "Not determined";
  const text = String(value).trim();
  if (!text) return "Not determined";
  return text.endsWith("%") ? text : `${text}%`;
}

export const FINANCE_GROUPS = [
  { id: "overview", label: "Overview", sections: ["Dashboard"] },
  { id: "projects", label: "Projects, Budgets & CVR", sections: ["Projects and Budgets", "Commitments and CVR"] },
  { id: "costs", label: "Costs & Suppliers", sections: ["Supplier Invoices", "Supplier Payments"] },
  { id: "payroll", label: "Payroll Finance", sections: ["CIS Weekly Payments", "PAYE Monthly Payments"] },
  { id: "customers", label: "Customers & Receivables", sections: ["Customer Invoices", "Customer Receipts"] },
  { id: "commercial", label: "Commercial", sections: ["Applications and Certificates", "Retention", "Variations and Dayworks"] },
  { id: "loans", label: "Loans & Advances", sections: ["Loans and Advances"] },
  { id: "tax", label: "Tax, Reports & Reconciliation", sections: ["VAT/CIS Reports", "Historical Balances", "Audit and Reconciliation"] },
] as const;

export const FINANCE_SECTIONS = FINANCE_GROUPS.flatMap((group) => group.sections);

export function withCompany(path: string, companyId: string): string {
  if (!companyId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}company_id=${encodeURIComponent(companyId)}`;
}

export function toMinor(value: MoneyValue): bigint | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const text = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  const minor = BigInt(whole) * SCALE + BigInt((fraction + "0000").slice(0, 4));
  return negative ? -minor : minor;
}

export function formatGbp(value: MoneyValue | bigint): string {
  const minor = typeof value === "bigint" ? value : toMinor(value);
  if (minor === null) return "";
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  let pounds = absolute / SCALE;
  let cents = (absolute % SCALE) / 100n;
  const remainder = (absolute % SCALE) % 100n;
  if (remainder >= 50n) cents += 1n;
  if (cents === 100n) {
    pounds += 1n;
    cents = 0n;
  }
  const body = `${pounds.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents.toString().padStart(2, "0")}`;
  return negative ? `−£${body}` : `£${body}`;
}

export function addMoney(values: MoneyValue[]): bigint {
  return values.reduce<bigint>((total, value) => total + (toMinor(value) ?? 0n), 0n);
}

export function subtractMoney(left: MoneyValue, right: MoneyValue): bigint | null {
  const a = toMinor(left);
  const b = toMinor(right);
  if (a === null || b === null) return null;
  return a - b;
}

export type SupplierView = {
  supplier: string;
  reference: string;
  referenceMissing: boolean;
  date: string;
  dateMissing: boolean;
  gross: string;
  cashPaid: string;
  creditApplied: string;
  /** @deprecated use cashPaid — never treat credits as bank paid */
  paid: string;
  outstanding: string;
  status: string;
  countsInTotals: boolean;
  duplicateReference: boolean;
  paymentReferences: string;
  warnings: string[];
};

const SUPPLIER_LIABILITY = new Set(["supplier_invoice", "expense_receipt"]);

/** Bank cash allocated to the invoice. Credits are not cash. */
export function supplierCashPaid(row: Record<string, MoneyValue>): bigint | null {
  if (!SUPPLIER_LIABILITY.has(String(row.document_type ?? "supplier_invoice"))) return 0n;
  if (String(row.status) !== "posted") return 0n;
  if (Object.prototype.hasOwnProperty.call(row, "cash_paid") && row.cash_paid !== null && row.cash_paid !== undefined && row.cash_paid !== "") {
    return toMinor(row.cash_paid);
  }
  return null;
}

/** Gross effect of posted supplier credits on this invoice (positive GBP). Not a bank payment. */
export function supplierCreditApplied(row: Record<string, MoneyValue>): bigint | null {
  if (!SUPPLIER_LIABILITY.has(String(row.document_type ?? "supplier_invoice"))) return 0n;
  if (String(row.status) !== "posted") return 0n;
  if (Object.prototype.hasOwnProperty.call(row, "credit_applied") && row.credit_applied !== null && row.credit_applied !== undefined && row.credit_applied !== "") {
    return toMinor(row.credit_applied);
  }
  return null;
}

export function supplierSettlementStatus(row: Record<string, MoneyValue>, today: string): string {
  const status = String(row.status ?? "");
  if (status === "draft") return "Draft";
  if (status !== "posted") return "Review";
  if (String(row.document_type) === "supplier_credit") return "Credit";
  const outstanding = toMinor(row.outstanding);
  const cash = supplierCashPaid(row);
  const credit = supplierCreditApplied(row);
  if (outstanding === null || cash === null || credit === null) {
    // Without explicit cash/credit fields, never invent a Paid label from gross−outstanding.
    if (outstanding !== null && outstanding <= 0n) return "Settled — breakdown missing";
    if (outstanding !== null && outstanding > 0n) {
      const due = String(row.due_date ?? "");
      if (due && due < today) return "Overdue";
      return "Posted";
    }
    return "Not determined";
  }
  if (outstanding <= 0n) {
    if (cash > 0n && credit > 0n) return "Settled — cash + credit";
    if (cash > 0n && credit === 0n) return "Paid";
    if (cash === 0n && credit > 0n) return "Credited";
    return "Settled";
  }
  if (cash > 0n || credit > 0n) return "Partial";
  const due = String(row.due_date ?? "");
  if (due && due < today) return "Overdue";
  return "Posted";
}

/** @deprecated prefer supplierSettlementStatus — kept for call sites during transition */
export function supplierStatus(row: Record<string, MoneyValue>, today: string): string {
  return supplierSettlementStatus(row, today);
}

export function supplierViews(rows: Record<string, MoneyValue>[], names: Map<string, string>, today: string): SupplierView[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const reference = String(row.external_reference ?? "").trim();
    if (reference) counts.set(reference, (counts.get(reference) ?? 0) + 1);
  }
  return rows.map((row) => {
    const reference = String(row.external_reference ?? "").trim();
    const date = String(row.document_date ?? "").trim();
    const countsInTotals = String(row.status) === "posted" && SUPPLIER_LIABILITY.has(String(row.document_type ?? "supplier_invoice"));
    const cash = countsInTotals ? supplierCashPaid(row) : 0n;
    const credit = countsInTotals ? supplierCreditApplied(row) : 0n;
    const warnings: string[] = [];
    if (!reference) warnings.push("Invoice reference was not stored. It needs an authorised correction, not a silent rewrite.");
    if (!date) warnings.push("Invoice date was not stored.");
    const duplicateReference = Boolean(reference) && (counts.get(reference) ?? 0) > 1;
    if (duplicateReference) warnings.push("This reference is used on more than one document. Only posted supplier invoices are included in totals.");
    if (String(row.status) === "draft") warnings.push("This draft is not a posted liability.");
    if (countsInTotals && (cash === null || credit === null)) {
      warnings.push("Cash paid and supplier credits are not separated on this row. Gross minus outstanding is not labelled as bank paid.");
    }
    const cashText = cash === null ? "Not determined" : formatGbp(cash);
    const creditText = credit === null ? "Not determined" : formatGbp(credit);
    return {
      supplier: names.get(String(row.counterparty_id ?? "")) ?? "Supplier name missing",
      reference: reference || "Reference missing",
      referenceMissing: !reference,
      date: date || "Date missing",
      dateMissing: !date,
      gross: formatGbp(row.gross_amount),
      cashPaid: cashText,
      creditApplied: creditText,
      paid: cashText,
      outstanding: formatGbp(countsInTotals ? row.outstanding : 0),
      status: supplierSettlementStatus(row, today),
      countsInTotals,
      duplicateReference,
      paymentReferences: String(row.payment_references ?? "").trim(),
      warnings,
    };
  });
}

/** Display heading for the large workbook title (internal sheet ids stay stable). */
export function worksheetHeading(sheet: Worksheet): string {
  if (sheet === "DAYWORKS LIVE") return "BASIC DAYWORKS";
  if (sheet === "Project Expenses") return "Supplier invoices & credits";
  if (sheet === "Payment Register") return "Supplier payments";
  return sheet;
}

/**
 * Whether a cost document should appear in a SELECTED PROJECT list.
 * Multi-job invoices that allocate to the selected job are included once in the list.
 * Document-level liability totals must stay COMPANY-WIDE (see postedSupplierTotals).
 */
export function costDocumentTouchesProject(
  row: Record<string, MoneyValue>,
  projectId: string,
  projectName: string,
): boolean {
  if (!projectId) return true;
  if (row.project_id !== undefined && row.project_id !== null && String(row.project_id).trim() !== "") {
    return String(row.project_id) === projectId;
  }
  const names = String(row.project_names ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) return false;
  return names.includes(projectName);
}

export function postedSupplierTotals(rows: Record<string, MoneyValue>[]): {
  gross: string;
  cashPaid: string;
  creditApplied: string;
  /** @deprecated use cashPaid */
  paid: string;
  outstanding: string;
  scope: "COMPANY-WIDE";
} {
  const liabilityRows = rows.filter((row) => String(row.status) === "posted" && SUPPLIER_LIABILITY.has(String(row.document_type ?? "")));
  const creditRows = rows.filter((row) => String(row.status) === "posted" && String(row.document_type) === "supplier_credit");
  const gross = addMoney(liabilityRows.map((row) => row.gross_amount));
  const outstanding = addMoney(liabilityRows.map((row) => row.outstanding));
  const cashValues = liabilityRows.map((row) => supplierCashPaid(row));
  const creditValues = liabilityRows.map((row) => supplierCreditApplied(row));
  // Empty liability set → known £0 cash, but still allow credit-document fallback for creditApplied.
  const cashKnown = liabilityRows.length === 0 || cashValues.every((value) => value !== null);
  const creditKnown = liabilityRows.length > 0 && creditValues.every((value) => value !== null);
  const cashPaid = cashKnown
    ? formatGbp(liabilityRows.length === 0 ? 0n : (cashValues as bigint[]).reduce((sum, value) => sum + value, 0n))
    : "Not determined";
  // Prefer explicit credit_applied on invoices; fall back to absolute posted credit document gross.
  let creditApplied = "Not determined";
  if (creditKnown) {
    creditApplied = formatGbp((creditValues as bigint[]).reduce((sum, value) => sum + value, 0n));
  } else if (creditRows.length) {
    const creditGross = addMoney(creditRows.map((row) => row.gross_amount));
    creditApplied = formatGbp(creditGross < 0n ? -creditGross : creditGross);
  } else if (liabilityRows.length === 0) {
    creditApplied = formatGbp(0n);
  }
  return {
    gross: formatGbp(gross),
    cashPaid,
    creditApplied,
    paid: cashPaid,
    outstanding: formatGbp(outstanding),
    scope: "COMPANY-WIDE",
  };
}

export type CustomerView = {
  customer: string;
  reference: string;
  referenceMissing: boolean;
  due: string;
  gross: string;
  received: string;
  outstanding: string;
  status: string;
  countsInTotals: boolean;
  receiptReferences: string;
  warnings: string[];
};

export function customerViews(rows: Record<string, MoneyValue>[], names: Map<string, string>, today: string): CustomerView[] {
  return rows.map((row) => {
    const reference = String(row.external_reference ?? "").trim();
    const due = String(row.due_date ?? "").trim();
    const received = invoiceCashReceived(row);
    const warnings: string[] = [];
    if (!reference) warnings.push("Invoice reference was not stored. It needs an authorised correction, not a silent rewrite.");
    if (!due) warnings.push("Due date was not stored.");
    if (String(row.status) === "draft") warnings.push("This draft is not a posted receivable.");
    const status = customerSettlementStatus(row, today);
    if (status === "Not determined") warnings.push("Settlement is not determined. A Paid or Credited label is not invented.");
    return {
      customer: names.get(String(row.counterparty_id ?? "")) ?? "Customer name missing",
      reference: reference || "Reference missing",
      referenceMissing: !reference,
      due: due || "Due date missing",
      gross: formatGbp(row.gross_amount),
      received: formatKnownMoney(received),
      outstanding: formatGbp(String(row.status) === "posted" && String(row.document_kind ?? "invoice") === "invoice" ? row.outstanding : 0),
      status,
      countsInTotals: String(row.status) === "posted" && String(row.document_kind ?? "invoice") === "invoice",
      receiptReferences: String(row.receipt_references ?? "").trim(),
      warnings,
    };
  });
}

export function columnsForWidth(kind: "supplier" | "customer", width: number): string[] {
  if (kind === "supplier") {
    if (width < 1024) return ["Supplier", "Reference", "Outstanding", "Status"];
    return ["Supplier", "Invoice reference", "Date", "Gross", "Cash paid", "Credits", "Outstanding", "Status"];
  }
  if (width < 1024) return ["Customer", "Reference", "Outstanding", "Status"];
  return ["Customer", "Invoice reference", "Due date", "Gross", "Received", "Outstanding", "Status"];
}

export function registerNotice(input: { loading: boolean; error: string; count: number }): string {
  if (input.loading) return "";
  if (input.error) return input.error;
  if (input.count === 0) return "No records for this company.";
  return "";
}

export type VatDecision = "undetermined" | "verified_recoverable" | "confirmed_non_recoverable" | "accountant_review";

export function invoiceGross(net: string, vat: string): { gross: string; error: string } {
  const netMinor = toMinor(net);
  const vatMinor = toMinor(vat);
  if (netMinor === null || vatMinor === null) return { gross: "Not determined", error: "Enter the net and VAT as amounts." };
  return { gross: formatGbp(netMinor + vatMinor), error: "" };
}

export function vatPostingBlocker(decision: VatDecision, vat: string, recoverable: string): string {
  if (decision === "undetermined" || decision === "accountant_review") {
    return "Recoverability is not determined. A draft can be saved only where the database stores an explicit VAT status. Recorded VAT is not classified as recoverable or non-recoverable, and it is not added to project cost. Posting is blocked until recoverability is confirmed.";
  }
  const tax = toMinor(vat);
  const recovered = toMinor(recoverable);
  if (tax === null || recovered === null) return "VAT amounts are not valid.";
  if (recovered < 0n || (tax >= 0n && recovered > tax) || (tax < 0n && recovered < tax)) {
    return "Recoverable VAT must sit between zero and the recorded VAT.";
  }
  if (decision === "verified_recoverable" && recovered === 0n && tax !== 0n) {
    return "Verified recoverable VAT cannot be zero while VAT is recorded. Confirm non-recoverable treatment, or enter the verified amount.";
  }
  if (decision === "confirmed_non_recoverable" && recovered !== 0n) {
    return "Confirmed non-recoverable treatment records recoverable VAT as zero. The recorded VAT is then included in eligible project cost.";
  }
  return "";
}

export function paymentPreview(outstanding: string, proposed: string): { after: string; error: string } {
  const due = toMinor(outstanding);
  const amount = toMinor(proposed);
  if (due === null || amount === null) return { after: "Not determined", error: "Enter the payment amount." };
  if (amount <= 0n) return { after: "Not determined", error: "The payment amount must be greater than zero." };
  if (amount > due) return { after: "Not determined", error: "This allocation is more than the outstanding balance. It will not be sent." };
  return { after: formatGbp(due - amount), error: "" };
}

/** Remaining invoice net still needing project/cost-code allocation before posting. */
export function allocationRemaining(invoiceNet: string, allocatedParts: string[]): { remaining: string; error: string } {
  const net = toMinor(invoiceNet);
  if (net === null) return { remaining: "Not determined", error: "Invoice net is not valid." };
  let allocated = 0n;
  for (const part of allocatedParts) {
    const value = toMinor(part);
    if (value === null) return { remaining: "Not determined", error: "An allocation amount is not valid." };
    if (value < 0n) return { remaining: "Not determined", error: "Allocation amounts cannot be negative." };
    allocated += value;
  }
  if (allocated > net) return { remaining: "Not determined", error: "Allocated net cannot exceed invoice net." };
  return { remaining: formatGbp(net - allocated), error: "" };
}

export function retentionPreview(withheld: string, alreadyReleased: string, proposed: string): { remaining: string; error: string } {
  const held = toMinor(withheld);
  const released = toMinor(alreadyReleased);
  const amount = toMinor(proposed);
  if (held === null || released === null || amount === null) return { remaining: "Not determined", error: "Retention amounts are incomplete." };
  if (amount <= 0n) return { remaining: "Not determined", error: "The release amount must be greater than zero." };
  const left = held - released;
  if (amount > left) return { remaining: "Not determined", error: "This release is more than the remaining retention. It will not be sent." };
  return { remaining: formatGbp(left - amount), error: "" };
}

export function forecastShare(contract: string, margin: string): string {
  if (contract === "missing" || margin === "missing") return "Not determined";
  const contractMinor = toMinor(contract);
  const marginMinor = toMinor(margin);
  if (contractMinor === null || marginMinor === null || contractMinor === 0n) return "Not determined";
  const negative = marginMinor < 0n;
  const tenths = ((negative ? -marginMinor : marginMinor) * 1000n) / (contractMinor < 0n ? -contractMinor : contractMinor);
  return `${negative ? "-" : ""}${tenths / 10n}.${tenths % 10n}% of the approved contract. This is not realised profit.`;
}

export function confirmationCopy(action: string, duplicateReference = false): string {
  const duplicate = duplicateReference ? " This reference is already used. The draft will not be added to posted totals." : "";
  return `Post this ${action}? A posted record stays unchanged except by a reversal or a new correction.${duplicate}`;
}

export function cvrLabels(report: Record<string, string> | null): { label: string; value: string; review: boolean }[] {
  if (!report) return [];
  const fields: { key: string; label: string; kind: "money" | "percent" }[] = [
    { key: "original_contract_value", label: "Original contract", kind: "money" },
    { key: "approved_variations", label: "Approved variations", kind: "money" },
    { key: "approved_dayworks_in_contract", label: "Approved dayworks in the contract", kind: "money" },
    { key: "approved_contract_value", label: "Approved contract value", kind: "money" },
    { key: "approved_budget", label: "Approved budget", kind: "money" },
    { key: "actual_eligible_cost", label: "Actual eligible cost", kind: "money" },
    { key: "cis_labour_gross", label: "CIS gross project labour", kind: "money" },
    { key: "actual_incurred_cost", label: "Actual incurred cost", kind: "money" },
    { key: "open_commitment", label: "Open commitments", kind: "money" },
    { key: "cost_to_complete", label: "Cost to complete", kind: "money" },
    { key: "forecast_final_cost", label: "Forecast final cost", kind: "money" },
    { key: "forecast_final_profit", label: "Forecast final profit", kind: "money" },
    { key: "forecast_margin", label: "Forecast margin (GBP, legacy)", kind: "money" },
    { key: "forecast_final_margin_percent", label: "Forecast final margin", kind: "percent" },
  ];
  return fields.map(({ key, label, kind }) => {
    const raw = report[key];
    const review = raw === "missing" || raw === undefined;
    if (review) return { label, value: "Not estimated — review required", review: true };
    return {
      label,
      value: kind === "percent" ? controlPercent(raw) : formatGbp(raw),
      review: false,
    };
  });
}

export function budgetForecastReview(report: Record<string, string> | null): string {
  if (!report) return "";
  const budget = toMinor(report.approved_budget);
  const forecast = toMinor(report.forecast_final_cost);
  if (budget === null || forecast === null) return "Forecast final cost is not estimated. Missing cost to complete is not treated as zero.";
  if (budget !== forecast) return `Approved budget ${formatGbp(budget)} is not the same as forecast final cost ${formatGbp(forecast)}. Review is required before treating the budget as covered.`;
  return "";
}

export function retentionReleaseStatus(releasedMinor: bigint, remainingMinor: bigint): string {
  if (releasedMinor > 0n && remainingMinor <= 0n) return "Fully released";
  if (releasedMinor > 0n) return "Partially released";
  return "Withheld";
}

export function retentionPosition(certificates: Record<string, MoneyValue>[], releases: Record<string, MoneyValue>[]): { withheld: string; released: string; remaining: string } {
  const withheld = addMoney(certificates.filter((row) => String(row.status ?? "posted") === "posted").map((row) => row.retention_withheld));
  const released = addMoney(releases.filter((row) => String(row.status ?? "posted") === "posted").map((row) => row.amount));
  return { withheld: formatGbp(withheld), released: formatGbp(released), remaining: formatGbp(withheld - released) };
}

export function loanPosition(rows: Record<string, MoneyValue>[]): { draw: string; repayment: string; outstanding: string } {
  const posted = rows.filter((row) => String(row.status ?? "posted") === "posted");
  const draw = addMoney(posted.filter((row) => row.entry_kind === "loan_draw").map((row) => row.amount));
  const repayment = addMoney(posted.filter((row) => row.entry_kind === "loan_repayment").map((row) => row.amount));
  return { draw: formatGbp(draw), repayment: formatGbp(repayment), outstanding: formatGbp(draw - repayment) };
}

export function auditDescription(row: Record<string, MoneyValue>): string {
  const action = String(row.action ?? "recorded").replaceAll("_", " ");
  const entity = String(row.entity_type ?? "record").replaceAll("_", " ");
  const reason = String(row.reason ?? "").trim();
  return reason ? `${action} ${entity}. ${reason}` : `${action} ${entity}.`;
}

export function payrollEmptyCopy(kind: "CIS" | "PAYE"): string {
  return `No approved ${kind} payroll exists for this company. Finance will not invent payroll figures.`;
}

export type CashMonth = {
  month: string;
  receipts: bigint;
  supplierPayments: bigint;
  loanDraws: bigint;
  loanRepayments: bigint;
};

export function ownerControl(input: {
  projectSelected: boolean;
  projectName: string;
  receipts: Record<string, MoneyValue>[];
  invoices: Record<string, MoneyValue>[];
  cvrs: Record<string, MoneyValue>[];
  costs: Record<string, MoneyValue>[];
  supplierPayments: Record<string, MoneyValue>[];
  funding: Record<string, MoneyValue>[];
  openings: Record<string, MoneyValue>[];
  categories: { category: string; eligible: MoneyValue }[];
  categoryLoadFailed: boolean;
  releasesPosted: number;
  retentionAudited: boolean;
  today: string;
}): {
  cashReceived: string;
  cashNote: string;
  remainingToInvoice: string;
  customerOutstanding: string;
  actualCost: string;
  supplierOutstanding: string;
  supplierOutstandingScope: "COMPANY-WIDE";
  supplierNote: string;
  categories: { category: string; eligible: bigint }[];
  categoryGap: string;
  budgetUse: { project: string; percent: string }[];
  cashMonths: CashMonth[] | null;
  cashMovementNote: string;
  attention: string[];
} {
  const postedInvoices = input.invoices.filter((row) => String(row.status) === "posted");
  const attention: string[] = [];
  const apiWarning = "A required cash amount or reversal flag is missing. The total is not determined.";
  let cashReceived = "Not determined";
  let cashNote = "Posted customer receipts that have not been reversed. Invoices, credits and loan drawings are not included.";
  let cashMovementNote = "";
  const projectCash = sumKnown(postedInvoices.map((row) => invoiceCashReceived(row)));
  const companyReceipts = effectiveMovementTotal(input.receipts, "amount", "receipt_reversed");
  const companyPayments = effectiveMovementTotal(input.supplierPayments, "amount", "payment_reversed");
  if (input.projectSelected) {
    if (projectCash === null) {
      cashNote = apiWarning;
      attention.push(apiWarning);
    } else {
      cashReceived = formatGbp(projectCash);
      cashNote = "Posted receipt allocations on this project's invoices. Credits, reversed receipts and unallocated receipts are not included.";
    }
    cashMovementNote = "Monthly cash is a company view. It is not split by project, so it is not shown for a single project.";
  } else if (companyReceipts === null || companyPayments === null) {
    cashNote = apiWarning;
    cashMovementNote = apiWarning;
    attention.push(apiWarning);
  } else {
    cashReceived = formatGbp(companyReceipts);
  }

  const contractMissing = input.cvrs.length === 0 || input.cvrs.some((row) => {
    const raw = row.approved_contract_value;
    return raw === "missing" || raw === undefined || raw === null || String(raw).trim() === "";
  });
  const contractValues = input.cvrs.map((row) => toMinor(row.approved_contract_value));
  const remainingToInvoice = contractMissing || contractValues.some((value) => value === null)
    ? "Not determined"
    : formatGbp((contractValues as bigint[]).reduce((sum, value) => sum + value, 0n) - addMoney(postedInvoices.map((row) => row.net_amount)));

  const customerOutstanding = formatGbp(addMoney(postedInvoices.map((row) => row.outstanding)));
  const actualValues = input.cvrs.map((row) => {
    const incurred = toMinor(row.actual_incurred_cost);
    if (incurred !== null) return incurred;
    const eligible = toMinor(row.actual_eligible_cost);
    const labour = toMinor(row.cis_labour_gross);
    if (eligible !== null && labour !== null) return eligible + labour;
    return eligible;
  });
  const actualKnown = input.cvrs.length > 0 && actualValues.every((value) => value !== null);
  const actualMinor = actualKnown ? (actualValues as bigint[]).reduce((sum, value) => sum + value, 0n) : null;
  const actualCost = actualMinor === null ? "Not determined" : formatGbp(actualMinor);

  // Document payable is always COMPANY-WIDE and counted once — never once per job allocation.
  const companyLiabilityRows = input.costs.filter(
    (row) => String(row.status) === "posted" && SUPPLIER_LIABILITY.has(String(row.document_type ?? "")),
  );
  const sharedDocuments = companyLiabilityRows.filter((row) => {
    const names = String(row.project_names ?? "").split(",").map((name) => name.trim()).filter(Boolean);
    return names.length > 1;
  }).length;
  const supplierOutstanding = formatGbp(addMoney(companyLiabilityRows.map((row) => row.outstanding)));
  const supplierOutstandingScope = "COMPANY-WIDE" as const;
  const supplierNote = `COMPANY-WIDE document liability after supplier credits and bank allocations. Multi-job invoices are counted once (not once per project). Project eligible incurred cost is on CVR, not this figure. Historical supplier opening balances are excluded and stay on Loans & Advances.`;
  if (sharedDocuments > 0) {
    attention.push(`${sharedDocuments} multi-job supplier invoice${sharedDocuments === 1 ? "" : "s"} stay in COMPANY-WIDE Supplier Outstanding so the payable is not doubled across jobs.`);
  }

  const categories = input.categoryLoadFailed ? [] : input.categories.flatMap((row) => {
    const eligible = toMinor(row.eligible);
    return eligible === null ? [] : [{ category: row.category, eligible }];
  });
  const categorySum = categories.reduce((sum, row) => sum + row.eligible, 0n);
  const categoryGap = input.categoryLoadFailed || actualMinor === null
    ? "Not determined"
    : actualMinor === categorySum ? "" : formatGbp(actualMinor - categorySum);

  const budgetUse = input.cvrs.map((row) => {
    const budget = toMinor(row.approved_budget);
    const actual = toMinor(row.actual_eligible_cost);
    return {
      project: String(row.name || "Unnamed project"),
      percent: budget === null || actual === null || budget <= 0n ? "Not determined" : percentOf(actual, budget),
    };
  });

  const scopedCosts = costsInScope(input);
  const missingReference = postedInvoices.filter((row) => !String(row.external_reference ?? "").trim()).length;
  const missingDue = postedInvoices.filter((row) => !String(row.due_date ?? "").trim()).length;
  const overdue = postedInvoices.filter((row) => {
    const due = String(row.due_date ?? "").trim();
    return Boolean(due) && due < input.today && (toMinor(row.outstanding) ?? 0n) > 0n;
  }).length;
  const references = new Map<string, number>();
  for (const row of scopedCosts) {
    if (String(row.document_type) !== "supplier_invoice") continue;
    const reference = String(row.external_reference ?? "").trim().toLowerCase();
    if (reference) references.set(reference, (references.get(reference) ?? 0) + 1);
  }
  const duplicateReferences = [...references.values()].filter((count) => count > 1).length;
  const unreviewedOpenings = input.projectSelected ? 0 : input.openings.filter((row) => String(row.review_status ?? "") !== "reviewed").length;
  const incompleteForecasts = input.cvrs.filter((row) => {
    const missingFinal = row.forecast_final_cost === "missing" || row.forecast_final_profit === "missing";
    const missingPercent = row.forecast_final_margin_percent === "missing";
    return missingFinal || missingPercent;
  }).length;
  const budgetMismatches = input.cvrs.filter((row) => Boolean(budgetForecastReview(row as Record<string, string>))).length;
  if (missingReference) attention.push(`${missingReference} posted customer invoice${missingReference === 1 ? "" : "s"} have no reference.`);
  if (missingDue) attention.push(`${missingDue} posted customer invoice${missingDue === 1 ? "" : "s"} have no due date.`);
  if (overdue) attention.push(`${overdue} posted customer invoice${overdue === 1 ? "" : "s"} are overdue.`);
  if (duplicateReferences) attention.push(`${duplicateReferences} supplier invoice reference${duplicateReferences === 1 ? "" : "s"} appear more than once.`);
  if (unreviewedOpenings) attention.push(`${unreviewedOpenings} opening balance${unreviewedOpenings === 1 ? "" : "s"} are not reviewed.`);
  if (incompleteForecasts) {
    attention.push(`${incompleteForecasts} project forecast${incompleteForecasts === 1 ? "" : "s"} are incomplete (missing CTC/contract fields). Forecast Final Cost is MISSING — not £0.`);
  }
  if (budgetMismatches) {
    attention.push(`${budgetMismatches} project${budgetMismatches === 1 ? "" : "s"} have approved budget different from Forecast Final Cost. Review before treating the budget as covered.`);
  }
  const lossMaking = input.cvrs.filter((row) => isForecastLoss(row.forecast_final_profit)).length;
  if (lossMaking) attention.push(`${lossMaking} project forecast${lossMaking === 1 ? "" : "s"} currently show a forecast loss.`);
  const missingCtc = input.cvrs.filter((row) => {
    const ctc = row.cost_to_complete;
    return ctc === "missing" || ctc === undefined || ctc === null || String(ctc).trim() === "";
  }).length;
  if (missingCtc) attention.push(`${missingCtc} project${missingCtc === 1 ? "" : "s"} have missing Additional Cost to Complete (not treated as £0).`);
  const draftCosts = scopedCosts.filter((row) => String(row.status) === "draft").length;
  if (draftCosts) attention.push(`${draftCosts} draft supplier document${draftCosts === 1 ? "" : "s"} await posting on Project Expenses.`);
  if (input.cvrs.some((row) => toMinor(row.open_commitment ?? row.open_commitments) !== null && (toMinor(row.open_commitment ?? row.open_commitments) ?? 0n) > 0n)) {
    attention.push("Open commitments are not actual incurred cost. Cost to complete must not double-count remaining committed work; overlap is not calculated automatically.");
  }
  if (input.cvrs.length > 0) {
    attention.push("Forecast Profit is an estimate to job completion. It is not certified or official accounting profit.");
    attention.push("Certified / official margin stays CERTIFIED UNVALIDATED until certificate basis is approved. Internal VOW remains experimental.");
    attention.push("Employer NI, pension and PAYE on-costs are not included in this project forecast unless separately recorded as project cost.");
    attention.push("Accruals are not yet fully supported as a separate incurred layer in this forecast.");
  }
  if (input.releasesPosted > 0 && !input.retentionAudited) attention.push("Posted retention releases have no retention audit action in the loaded history. Older releases are not backfilled.");
  if (!input.categoryLoadFailed && categoryGap && categoryGap !== "Not determined") attention.push("Expenditure by cost code does not cover actual eligible cost.");
  if (scopedCosts.some((row) => String(row.status) === "posted")) attention.push("Recorded input VAT is not verified recoverable.");

  return {
    cashReceived,
    cashNote,
    remainingToInvoice,
    customerOutstanding,
    actualCost,
    supplierOutstanding,
    supplierOutstandingScope,
    supplierNote,
    categories,
    categoryGap,
    budgetUse,
    cashMonths: input.projectSelected || companyReceipts === null || companyPayments === null ? null : cashMonths(input),
    cashMovementNote,
    attention,
  };
}

function costsInScope(input: { projectSelected: boolean; projectName: string; costs: Record<string, MoneyValue>[] }): Record<string, MoneyValue>[] {
  if (!input.projectSelected) return input.costs;
  // Include multi-job documents that allocate to this project name (for attention / draft counts only).
  return input.costs.filter((row) => {
    const names = String(row.project_names ?? "").split(",").map((name) => name.trim()).filter(Boolean);
    return names.includes(input.projectName);
  });
}

function percentOf(part: bigint, whole: bigint): string {
  const negative = part < 0n;
  const absolute = negative ? -part : part;
  const hundredths = (absolute * 10000n + whole / 2n) / whole;
  return `${negative ? "−" : ""}${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, "0")}%`;
}

function cashMonths(input: { receipts: Record<string, MoneyValue>[]; supplierPayments: Record<string, MoneyValue>[]; funding: Record<string, MoneyValue>[] }): CashMonth[] {
  const months = new Map<string, CashMonth>();
  const bucket = (month: string) => {
    const current = months.get(month) ?? { month, receipts: 0n, supplierPayments: 0n, loanDraws: 0n, loanRepayments: 0n };
    months.set(month, current);
    return current;
  };
  const dated = (value: MoneyValue) => /^(\d{4}-\d{2})/.exec(String(value ?? ""))?.[1] ?? "";
  for (const row of input.receipts) {
    if (String(row.status) !== "posted") continue;
    if (reversalState(row, "receipt_reversed") !== false) continue;
    const month = dated(row.receipt_date);
    if (!month) continue;
    bucket(month).receipts += toMinor(row.amount) ?? 0n;
  }
  for (const row of input.supplierPayments) {
    if (String(row.status) !== "posted") continue;
    if (reversalState(row, "payment_reversed") !== false) continue;
    const month = dated(row.payment_date);
    if (!month) continue;
    bucket(month).supplierPayments += toMinor(row.amount) ?? 0n;
  }
  for (const row of input.funding) {
    if (String(row.status) !== "posted") continue;
    const month = dated(row.entry_date);
    if (!month) continue;
    const amount = toMinor(row.amount) ?? 0n;
    if (row.entry_kind === "loan_draw") bucket(month).loanDraws += amount;
    if (row.entry_kind === "loan_repayment" || row.entry_kind === "principal_repayment") bucket(month).loanRepayments += amount;
  }
  return [...months.values()].sort((left, right) => left.month.localeCompare(right.month));
}

export function reversalState(row: Record<string, MoneyValue>, reversedKey: string): boolean | null {
  if (String(row.status) !== "posted") return false;
  if (!Object.prototype.hasOwnProperty.call(row, reversedKey)) return null;
  const reversed = row[reversedKey];
  if (reversed === true || reversed === "true") return true;
  if (reversed === false || reversed === "false") return false;
  return null;
}

export function effectiveMovementTotal(rows: Record<string, MoneyValue>[], amountKey: string, reversedKey: string): bigint | null {
  let total = 0n;
  for (const row of rows) {
    if (String(row.status) !== "posted") continue;
    const reversed = reversalState(row, reversedKey);
    if (reversed === null) return null;
    if (reversed) continue;
    const amount = toMinor(row[amountKey]);
    if (amount === null) return null;
    total += amount;
  }
  return total;
}

export function formatKnownMoney(value: bigint | null): string {
  return value === null ? "Not determined" : formatGbp(value);
}

function sumKnown(values: Array<bigint | null>): bigint | null {
  let total = 0n;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total;
}

export function invoiceCashReceived(row: Record<string, MoneyValue>): bigint | null {
  if (String(row.status) !== "posted" || String(row.document_kind) !== "invoice") return 0n;
  if (!Object.prototype.hasOwnProperty.call(row, "cash_allocated")) return null;
  return toMinor(row.cash_allocated);
}

export function creditApplied(row: Record<string, MoneyValue>): bigint | null {
  if (String(row.status) !== "posted" || String(row.document_kind) !== "invoice") return 0n;
  if (!Object.prototype.hasOwnProperty.call(row, "credit_applied")) return null;
  const amount = toMinor(row.credit_applied);
  if (amount === null) return null;
  return amount < 0n ? -amount : amount;
}

export function customerSettlementStatus(row: Record<string, MoneyValue>, today: string): string {
  if (String(row.status) === "draft") return "Draft";
  if (String(row.status) !== "posted" || String(row.document_kind ?? "invoice") !== "invoice") return "Review";
  const outstanding = toMinor(row.outstanding);
  const cash = invoiceCashReceived(row);
  const gross = toMinor(row.gross_amount);
  const due = String(row.due_date ?? "").trim();
  if (outstanding === null || cash === null || gross === null) return "Not determined";
  const credit = creditApplied(row);
  if (outstanding > 0n) {
    if (cash > 0n || (credit !== null && credit > 0n)) return "Partial";
    if (due && due < today) return "Overdue";
    return "Posted";
  }
  if (cash >= gross && gross > 0n && (credit === null || credit === 0n)) return "Paid";
  if (credit === null) return "Not determined";
  if (cash === 0n && credit >= gross && gross > 0n) return "Credited";
  if (cash > 0n && credit > 0n && cash + credit >= gross) return "Settled — cash + credit";
  return "Not determined";
}

export function receiptAllocationStatus(row: Record<string, MoneyValue>): string {
  if (String(row.status) !== "posted") return "Draft";
  const reversed = reversalState(row, "receipt_reversed");
  if (reversed === null) return "Reversal not confirmed";
  if (reversed) return "Reversed";
  if (row.allocated_amount === undefined || row.allocated_amount === null) return "Allocation not stored";
  const amount = toMinor(row.amount);
  const allocated = toMinor(row.allocated_amount);
  if (amount === null || allocated === null) return "Not determined";
  if (allocated <= 0n) return "Unallocated";
  if (allocated >= amount) return "Fully allocated";
  return "Part allocated";
}

export function activeMovementCount(rows: Record<string, MoneyValue>[], reversedKey: string): number | null {
  let count = 0;
  for (const row of rows) {
    if (String(row.status) !== "posted") continue;
    const reversed = reversalState(row, reversedKey);
    if (reversed === null) return null;
    if (!reversed) count += 1;
  }
  return count;
}
