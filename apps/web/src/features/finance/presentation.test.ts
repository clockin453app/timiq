import assert from "node:assert/strict";
import test from "node:test";

import { FICTIONAL_WORKER_PREVIEW } from "./finance-preview.ts";
import {
  FINANCE_SECTIONS,
  WORKSHEETS,
  WORKSHEET_NAV,
  INVOICE_LEARNING_STEPS,
  controlAmount,
  controlColumns,
  controlPercent,
  forecastShare,
  financeAttentionActions,
  financeUiAttentionActions,
  financePortfolioSummary,
  forecastTone,
  isForecastLoss,
  invoiceGross,
  allocationRemaining,
  paymentPreview,
  retentionPreview,
  vatPostingBlocker,
  activeMovementCount,
  auditDescription,
  budgetForecastReview,
  columnsForWidth,
  confirmationCopy,
  customerSettlementStatus,
  customerViews,
  formatGbp,
  invoiceCashReceived,
  loanPosition,
  metricHonestyLabel,
  payrollEmptyCopy,
  postedSupplierTotals,
  receiptAllocationStatus,
  registerNotice,
  ownerControl,
  primaryKpisIncomplete,
  primaryKpisReady,
  retentionPosition,
  retentionReleaseStatus,
  reversalState,
  compactMetricStatus,
  costDocumentTouchesProject,
  projectControlDrilldown,
  supplierCashPaid,
  supplierCreditApplied,
  supplierSettlementStatus,
  supplierViews,
  worksheetHeading,
  withCompany,
} from "./presentation.ts";

const today = "2026-10-11";

test("formats stored four-decimal amounts as GBP to two decimals", () => {
  assert.equal(formatGbp("1200.0000"), "£1,200.00");
  assert.equal(formatGbp("700.0000"), "£700.00");
  assert.equal(formatGbp("0.0000"), "£0.00");
});

test("C5 reporting honesty labels distinguish live, snapshot, provisional and experimental", () => {
  assert.equal(metricHonestyLabel("liveAsOf"), "LIVE AS-OF");
  assert.equal(metricHonestyLabel("storedMonthlySnapshot"), "STORED MONTHLY SNAPSHOT");
  assert.equal(metricHonestyLabel("provisionalVow"), "PROVISIONAL VOW");
  assert.equal(metricHonestyLabel("certifiedUnvalidated"), "CERTIFIED UNVALIDATED");
  assert.equal(metricHonestyLabel("experimentalUnavailable"), "EXPERIMENTAL / UNAVAILABLE");
  assert.equal(
    metricHonestyLabel("experimentalUnavailable", { experimentalSchemaPresent: true }),
    "EXPERIMENTAL / TEST-ONLY",
  );
});

test("owner worksheet nav maps only to real worksheets with plain-English labels", () => {
  const sheets = WORKSHEET_NAV.flatMap((group) => group.items.map((item) => item.sheet));
  // Groups may reuse a real worksheet (e.g. Payment Register under Costs and Payroll).
  assert.deepEqual([...new Set(sheets)].sort(), [...WORKSHEETS].sort());
  assert.ok(sheets.every((sheet) => (WORKSHEETS as readonly string[]).includes(sheet)));
  assert.ok(WORKSHEET_NAV.some((group) => group.items.some((item) => item.label.includes("Supplier invoices"))));
  assert.equal(INVOICE_LEARNING_STEPS.length, 5);
  assert.ok(WORKSHEET_NAV.some((group) => group.group === "Costs & Suppliers"));
  assert.ok(WORKSHEET_NAV.some((group) => group.group === "Reports"));
  assert.ok(WORKSHEET_NAV.some((group) => group.group === "Payroll Finance"));
});

test("primary KPI incomplete helper collapses all-missing grids", () => {
  assert.equal(primaryKpisIncomplete(["Not determined", "MISSING / NOT AVAILABLE", "missing", ""]), true);
  assert.equal(primaryKpisIncomplete(["£10.00", "Not determined", "Not determined", "Not determined"]), false);
  assert.equal(primaryKpisReady(["£10.00", "£20.00", "£30.00", "£40.00"]), true);
  assert.equal(primaryKpisReady(["£10.00", "Not determined", "£30.00", "£40.00"]), false);
});

test("portfolio summary never treats missing CTC as zero and flags forecast loss", () => {
  const missing = financePortfolioSummary([
    {
      name: "Alpha",
      approved_contract_value: "20000.0000",
      actual_incurred_cost: "11000.0000",
      open_commitments: "3000.0000",
      cost_to_complete: "missing",
      forecast_final_cost: "missing",
      forecast_final_profit: "missing",
    },
  ]);
  assert.equal(missing.additionalCtc, "MISSING / NOT AVAILABLE");
  assert.equal(missing.forecastFinalCost, "MISSING / NOT AVAILABLE");
  assert.equal(missing.forecastProfit, "MISSING / NOT AVAILABLE");
  assert.equal(missing.forecastMargin, "Not determined");
  assert.equal(missing.reliableProjects, 0);
  assert.equal(missing.missingCtc, 1);

  const complete = financePortfolioSummary([
    {
      name: "Alpha",
      approved_contract_value: "20000.0000",
      actual_incurred_cost: "11000.0000",
      open_commitments: "3000.0000",
      cost_to_complete: "500.0000",
      forecast_final_cost: "14500.0000",
      forecast_final_profit: "5500.0000",
    },
  ]);
  assert.equal(complete.forecastFinalCost, "£14,500.00");
  assert.equal(complete.forecastProfit, "£5,500.00");
  assert.equal(complete.forecastMargin, "27.50%");
  assert.equal(complete.reliableProjects, 1);

  const loss = financePortfolioSummary([
    {
      name: "Loss",
      approved_contract_value: "1000.0000",
      actual_incurred_cost: "2000.0000",
      open_commitments: "0.0000",
      cost_to_complete: "500.0000",
      forecast_final_cost: "2500.0000",
      forecast_final_profit: "-1500.0000",
    },
  ]);
  assert.equal(loss.lossMaking, 1);
  assert.equal(isForecastLoss("-1500.0000"), true);
  assert.equal(forecastTone("-1500.0000"), "red");
  assert.equal(forecastTone("5500.0000"), "green");
});

test("attention actions link draft invoices and forecast losses to real worksheets", () => {
  const figures = ownerControl({
    ...blankOwner(),
    cvrs: [
      {
        name: "Loss job",
        approved_contract_value: "1000.0000",
        actual_incurred_cost: "2000.0000",
        open_commitments: "0.0000",
        cost_to_complete: "missing",
        forecast_final_cost: "missing",
        forecast_final_profit: "-500.0000",
        forecast_margin: "missing",
        forecast_final_margin_percent: "missing",
      },
    ],
    costs: [{ status: "draft", document_type: "supplier_invoice", external_reference: "D1", project_names: "Loss job" }],
  });
  assert.ok(figures.attention.some((item) => /draft supplier document/i.test(item)));
  assert.ok(figures.attention.some((item) => /missing Additional Cost to Complete/i.test(item)));
  assert.ok(figures.attention.some((item) => /forecast loss/i.test(item)));
  const actions = financeAttentionActions(figures.attention);
  assert.equal(actions.length, figures.attention.length);
  assert.ok(actions.every((item) => item.title && item.reason && item.recommendedAction));
  assert.ok(actions.some((item) => item.sheet === "Project Expenses" && item.expenseFilter === "Draft"));
  assert.ok(actions.some((item) => item.severity === "red" && /loss/i.test(item.label)));
  const ui = financeUiAttentionActions(figures.attention);
  assert.ok(ui.every((item) => item.title !== "Attention item"));
  assert.ok(ui.some((item) => /draft/i.test(item.title)));
  assert.ok(ui.some((item) => /loss/i.test(item.title)));
  assert.equal(new Set(ui.map((item) => item.title)).size, ui.length);
});

test("Project Control drill-downs use live Alpha values and compact experimental status", () => {
  const alpha = {
    name: "DEMO Project Alpha",
    approved_contract_value: "20000.0000",
    actual_eligible_cost: "400.0000",
    actual_incurred_cost: "400.0000",
    cis_labour_gross: "0.0000",
    open_commitments: "3000.0000",
    cost_to_complete: "500.0000",
    forecast_final_cost: "3900.0000",
    forecast_final_profit: "16100.0000",
    forecast_final_margin_percent: "80.50",
    approved_variations: "0.0000",
  };
  const finalCost = projectControlDrilldown("forecastFinalCost", { projectName: "DEMO Project Alpha", scope: "SELECTED PROJECT", row: alpha });
  assert.match(finalCost.body, /£400\.00/);
  assert.match(finalCost.body, /£3,000\.00/);
  assert.match(finalCost.body, /£500\.00/);
  assert.match(finalCost.body, /£3,900\.00/);
  assert.equal(finalCost.navigate, null);

  const profit = projectControlDrilldown("forecastProfit", { projectName: "DEMO Project Alpha", scope: "SELECTED PROJECT", row: alpha });
  assert.match(profit.body, /£20,000\.00/);
  assert.match(profit.body, /£3,900\.00/);
  assert.match(profit.body, /£16,100\.00/);

  const margin = projectControlDrilldown("forecastMargin", { projectName: "DEMO Project Alpha", scope: "SELECTED PROJECT", row: alpha });
  assert.match(margin.body, /80\.50%/);

  const incurred = projectControlDrilldown("actualIncurred", { projectName: "DEMO Project Alpha", scope: "SELECTED PROJECT", row: alpha });
  assert.equal(incurred.navigate?.sheet, "Project Expenses");
  assert.match(incurred.body, /£400\.00/);
  assert.doesNotMatch(incurred.body, /£1,440/);

  const outstanding = projectControlDrilldown("supplierOutstanding", {
    projectName: "DEMO Project Alpha",
    scope: "COMPANY-WIDE",
    supplierGross: "£1,440.00",
    supplierCashPaid: "£400.00",
    supplierCredits: "£120.00",
    supplierOutstanding: "£920.00",
  });
  assert.match(outstanding.body, /COMPANY-WIDE|Scope: COMPANY-WIDE/);
  assert.match(outstanding.body, /£920\.00/);
  assert.equal(outstanding.navigate?.sheet, "Project Expenses");

  const vow = projectControlDrilldown("internalVow", { projectName: "DEMO Project Alpha", scope: "EXPERIMENTAL" });
  assert.match(vow.body, /Experimental/);
  assert.equal(vow.navigate, null);
  assert.doesNotMatch(compactMetricStatus("experimentalUnavailable").badge, /EXPERIMENTAL \/ UNAVAILABLE/);
  assert.equal(compactMetricStatus("certifiedUnvalidated").badge, "Unvalidated");
  assert.equal(compactMetricStatus("liveAsOf").badge, "Live current");

  const cis = projectControlDrilldown("cisGross", { projectName: "DEMO Project Alpha", scope: "SELECTED PROJECT", row: alpha });
  assert.equal(cis.navigate, null);
  assert.match(cis.body, /cis_labour_gross/);
  assert.match(cis.body, /not CIS tax/i);

  const variations = projectControlDrilldown("approvedVariations", { projectName: "DEMO Project Alpha", scope: "SELECTED PROJECT", row: alpha });
  assert.equal(variations.navigate, null);
  assert.match(variations.body, /approved_variations/);
  assert.match(variations.body, /not the same as Basic Dayworks/i);
});

test("keeps the company filter on every finance request", () => {
  assert.equal(withCompany("/api/finance/registers/supplier-invoices", "company-1"), "/api/finance/registers/supplier-invoices?company_id=company-1");
  assert.equal(withCompany("/api/finance/dashboard?project_id=p1", "company-1"), "/api/finance/dashboard?project_id=p1&company_id=company-1");
  assert.equal(withCompany("/api/finance/dashboard", ""), "/api/finance/dashboard");
});

test("A9 as-of URL stays company-scoped and delayed responses must not overwrite selection", () => {
  const pathA = withCompany(
    "/api/finance/cvr/as-of?project_id=project-a&cut_off=2026-01-31",
    "company-a",
  );
  const pathB = withCompany(
    "/api/finance/cvr/as-of?project_id=project-b&cut_off=2026-02-28",
    "company-b",
  );
  assert.equal(
    pathA,
    "/api/finance/cvr/as-of?project_id=project-a&cut_off=2026-01-31&company_id=company-a",
  );
  assert.equal(
    pathB,
    "/api/finance/cvr/as-of?project_id=project-b&cut_off=2026-02-28&company_id=company-b",
  );
  assert.notEqual(pathA, pathB);

  // Models the finance-workspace cancelled flag: a late Company A response must not apply
  // after the selection moved to Company B / Project B / February.
  let cancelled = false;
  let applied: string | null = null;
  const applyIfCurrent = (payload: string) => {
    if (!cancelled) applied = payload;
  };
  applyIfCurrent("company-a-jan");
  cancelled = true;
  applyIfCurrent("stale-company-a-jan");
  assert.equal(applied, "company-a-jan");
});

test("posted NS-100 is gross 1200, cash paid 500, outstanding 700, and the draft is excluded", () => {
  const rows = [
    { counterparty_id: "s1", document_type: "supplier_invoice", external_reference: "NS-100", document_date: "2026-10-01", due_date: "2026-10-20", gross_amount: "1200.0000", outstanding: "700.0000", cash_paid: "500.0000", credit_applied: "0.0000", status: "posted", payment_references: "BACS-500" },
    { counterparty_id: "s1", document_type: "supplier_invoice", external_reference: "NS-100", document_date: "2026-10-01", gross_amount: "1200.0000", outstanding: "0.0000", status: "draft", payment_references: "" },
  ];
  const names = new Map([["s1", "North Supplies"]]);
  const views = supplierViews(rows, names, today);
  assert.equal(views[0].supplier, "North Supplies");
  assert.equal(views[0].gross, "£1,200.00");
  assert.equal(views[0].cashPaid, "£500.00");
  assert.equal(views[0].creditApplied, "£0.00");
  assert.equal(views[0].paid, "£500.00");
  assert.equal(views[0].outstanding, "£700.00");
  assert.equal(views[0].status, "Partial");
  assert.equal(views[0].paymentReferences, "BACS-500");
  assert.equal(views[0].countsInTotals, true);
  assert.equal(views[1].status, "Draft");
  assert.equal(views[1].countsInTotals, false);
  assert.equal(views[1].outstanding, "£0.00");
  const totals = postedSupplierTotals(rows);
  assert.equal(totals.gross, "£1,200.00");
  assert.equal(totals.cashPaid, "£500.00");
  assert.equal(totals.paid, "£500.00");
  assert.equal(totals.outstanding, "£700.00");
  assert.equal(views[0].duplicateReference, true);
});

test("DEMO invoice separates cash paid £400 from credits £120; outstanding £920 is not Paid £520", () => {
  const row = {
    document_type: "supplier_invoice",
    status: "posted",
    gross_amount: "1440.0000",
    outstanding: "920.0000",
    cash_paid: "400.0000",
    credit_applied: "120.0000",
    payment_references: "DEMO-PAY-400",
  };
  // Legacy mistake: gross − outstanding = 520 conflates cash + credit.
  assert.notEqual(formatGbp("520.0000"), formatGbp(row.cash_paid));
  assert.equal(formatGbp(supplierCashPaid(row)), "£400.00");
  assert.equal(formatGbp(supplierCreditApplied(row)), "£120.00");
  assert.equal(supplierSettlementStatus(row, today), "Partial");
  const views = supplierViews([row], new Map([["s1", "DEMO"]]), today);
  assert.equal(views[0].cashPaid, "£400.00");
  assert.equal(views[0].creditApplied, "£120.00");
  assert.notEqual(views[0].status, "Paid");
  assert.equal(views[0].outstanding, "£920.00");

  assert.equal(supplierSettlementStatus({ ...row, outstanding: "0.0000", cash_paid: "1320.0000", credit_applied: "120.0000" }, today), "Settled — cash + credit");
  assert.equal(supplierSettlementStatus({ ...row, outstanding: "0.0000", cash_paid: "1440.0000", credit_applied: "0.0000" }, today), "Paid");
  assert.equal(supplierSettlementStatus({ ...row, outstanding: "0.0000", cash_paid: "0.0000", credit_applied: "1440.0000" }, today), "Credited");
  assert.equal(supplierSettlementStatus({ ...row, cash_paid: "0.0000", credit_applied: "0.0000", outstanding: "1440.0000" }, today), "Posted");
});

test("customer invoices show received cash and a missing reference warning", () => {
  const views = customerViews([
    { counterparty_id: "c1", document_kind: "invoice", external_reference: null, due_date: null, gross_amount: "120.0000", outstanding: "70.0000", cash_allocated: "40.0000", status: "posted", receipt_references: "HC-RCPT-1" },
  ], new Map([["c1", "Harbour Client"]]), today);
  assert.equal(views[0].customer, "Harbour Client");
  assert.equal(views[0].reference, "Reference missing");
  assert.equal(views[0].gross, "£120.00");
  assert.equal(views[0].received, "£40.00");
  assert.equal(views[0].outstanding, "£70.00");
  assert.equal(views[0].status, "Partial");
  assert.equal(views[0].receiptReferences, "HC-RCPT-1");
  assert.ok(views[0].warnings.some((warning) => warning.includes("authorised correction")));
});

test("errors stay visible and empty companies stay distinct", () => {
  assert.equal(registerNotice({ loading: false, error: "The finance server is not responding.", count: 0 }), "The finance server is not responding.");
  assert.equal(registerNotice({ loading: false, error: "", count: 0 }), "No records for this company.");
  assert.equal(registerNotice({ loading: true, error: "", count: 0 }), "");
});

test("posting asks for confirmation and mentions a duplicate reference", () => {
  assert.match(confirmationCopy("supplier invoice"), /Post this supplier invoice/);
  assert.match(confirmationCopy("supplier invoice", true), /already used/);
});

test("invoice gross, VAT block, payment and retention previews use fixed examples", () => {
  assert.equal(invoiceGross("1000.00", "200.00").gross, "£1,200.00");
  assert.equal(invoiceGross("100.00", "20.00").gross, "£120.00");
  assert.match(vatPostingBlocker("undetermined", "200.00", "0.00"), /blocked/);
  assert.equal(vatPostingBlocker("confirmed_non_recoverable", "200.00", "0.00"), "");
  assert.match(vatPostingBlocker("verified_recoverable", "200.00", "0.00"), /cannot be zero/);
  assert.equal(paymentPreview("700.0000", "200.00").after, "£500.00");
  assert.match(paymentPreview("700.0000", "800.00").error, /more than the outstanding/);
  assert.equal(allocationRemaining("1200.00", ["500.00", "700.00"]).remaining, "£0.00");
  assert.equal(allocationRemaining("1200.00", ["500.00", "600.00"]).remaining, "£100.00");
  assert.match(allocationRemaining("1200.00", ["500.00", "800.00"]).error, /cannot exceed/);
  assert.equal(allocationRemaining("10000.00", ["2000.00", "3000.00", "5000.00"]).remaining, "£0.00");
  assert.equal(allocationRemaining("10000.00", ["9500.00"]).remaining, "£500.00");
  assert.match(allocationRemaining("10000.00", ["10500.00"]).error, /cannot exceed/);
  // UI01 five-project total
  assert.equal(
    allocationRemaining("10000.00", ["1000.00", "1500.00", "2000.00", "2500.00", "3000.00"]).remaining,
    "£0.00",
  );
  // UI02 under / over
  assert.equal(allocationRemaining("10000.00", ["2000.00", "3000.00", "4500.00"]).remaining, "£500.00");
  assert.match(allocationRemaining("10000.00", ["2000.00", "3000.00", "5500.00"]).error, /cannot exceed/);
  assert.equal(retentionPreview("500.0000", "200.0000", "50.00").remaining, "£250.00");
  assert.match(retentionPreview("500.0000", "200.0000", "400.00").error, /more than the remaining/);
  assert.equal(forecastShare("106000.0000", "101500.0000"), "95.7% of the approved contract. This is not realised profit.");
  assert.equal(forecastShare("missing", "missing"), "Not determined");
});

test("fictional worker preview is labelled and is not a posting source", () => {
  assert.equal(FICTIONAL_WORKER_PREVIEW.label, "FICTIONAL PREVIEW — NOT POSTED");
  assert.equal(FICTIONAL_WORKER_PREVIEW.cis.length, 3);
  assert.equal(FICTIONAL_WORKER_PREVIEW.paye[0]?.worker, "Test Employee D");
  assert.equal(JSON.stringify(FICTIONAL_WORKER_PREVIEW).includes("finance.local"), false);
});

test("the approved workbook has exactly ten sheets and opens on project control", () => {
  assert.deepEqual([...WORKSHEETS], [
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
  ]);
  assert.equal(WORKSHEETS[0], "PROJECT CONTROL");
  assert.equal(controlAmount("missing"), "Not determined");
  assert.equal(controlAmount("4500.0000"), "£4,500.00");
  assert.deepEqual(controlColumns(768), ["Project", "Contract value", "Forecast final profit", "Forecast final margin %", "Review"]);
  assert.equal(controlColumns(1366).includes("Actual incurred cost"), true);
  assert.equal(controlColumns(1366).includes("Forecast final margin %"), true);
  assert.equal(controlColumns(1366).includes("Approved budget"), false);
  assert.equal(controlPercent("27.50"), "27.50%");
  assert.equal(controlPercent("missing"), "Not determined");
  assert.equal(controlPercent("-30.00"), "-30.00%");
});

test("navigation still reaches every existing finance section", () => {
  assert.deepEqual(FINANCE_SECTIONS, [
    "Dashboard",
    "Projects and Budgets",
    "Commitments and CVR",
    "Supplier Invoices",
    "Supplier Payments",
    "CIS Weekly Payments",
    "PAYE Monthly Payments",
    "Customer Invoices",
    "Customer Receipts",
    "Applications and Certificates",
    "Retention",
    "Variations and Dayworks",
    "Loans and Advances",
    "VAT/CIS Reports",
    "Historical Balances",
    "Audit and Reconciliation",
  ]);
  assert.equal(FINANCE_SECTIONS.length, 16);
});

test("narrow screens keep only the essential columns", () => {
  assert.deepEqual(columnsForWidth("supplier", 1366), ["Supplier", "Invoice reference", "Date", "Gross", "Cash paid", "Credits", "Outstanding", "Status"]);
  assert.deepEqual(columnsForWidth("supplier", 1280), ["Supplier", "Invoice reference", "Date", "Gross", "Cash paid", "Credits", "Outstanding", "Status"]);
  assert.deepEqual(columnsForWidth("supplier", 768), ["Supplier", "Reference", "Outstanding", "Status"]);
  assert.equal(columnsForWidth("customer", 1024).includes("Due date"), true);
  assert.equal(columnsForWidth("customer", 800).includes("Due date"), false);
});

test("forecast margin stays labelled as forecast and a missing cost to complete is not zero", () => {
  const review = budgetForecastReview({ approved_budget: "80000.0000", forecast_final_cost: "4500.0000" });
  assert.match(review, /£80,000.00/);
  assert.match(review, /£4,500.00/);
  assert.match(review, /Review is required/);
  assert.match(budgetForecastReview({ approved_budget: "80000.0000", forecast_final_cost: "missing" }), /not treated as zero/);
});

test("forecast attention keeps estimated profit distinct from certified profit", () => {
  const figures = ownerControl({
    ...blankOwner(),
    cvrs: [{
      name: "Alpha",
      approved_contract_value: "20000.0000",
      approved_budget: "18000.0000",
      actual_incurred_cost: "400.0000",
      open_commitments: "3000.0000",
      cost_to_complete: "500.0000",
      forecast_final_cost: "3900.0000",
      forecast_final_profit: "16100.0000",
      forecast_final_margin_percent: "80.50",
      forecast_margin: "16100.0000",
    }],
  });
  assert.ok(figures.attention.some((item) => /Forecast Profit is an estimate/i.test(item)));
  assert.ok(figures.attention.some((item) => /CERTIFIED UNVALIDATED/i.test(item)));
  assert.ok(!figures.attention.some((item) => /are not estimated profit/i.test(item)));
});

test("project control labels separate incurred cost from open commitments and percent margin", () => {
  assert.deepEqual(
    controlColumns(1366),
    [
      "Project",
      "Contract value",
      "Actual incurred cost",
      "Open commitments",
      "Cost to complete",
      "Forecast final cost",
      "Forecast final profit",
      "Forecast final margin %",
      "Review",
    ],
  );
  const figures = ownerControl({
    ...blankOwner(),
    cvrs: [{
      name: "Riverside",
      approved_contract_value: "20000.0000",
      approved_budget: "18000.0000",
      actual_eligible_cost: "10000.0000",
      cis_labour_gross: "1000.0000",
      actual_incurred_cost: "11000.0000",
      open_commitment: "3000.0000",
      cost_to_complete: "500.0000",
      forecast_final_cost: "14500.0000",
      forecast_margin: "5500.0000",
      forecast_final_profit: "5500.0000",
      forecast_final_margin_percent: "27.50",
    }],
  });
  assert.equal(figures.actualCost, "£11,000.00");
  assert.notEqual(figures.actualCost, "£14,500.00");
  assert.ok(figures.attention.some((item) => item.includes("Open commitments are not actual incurred cost")));
  assert.ok(figures.attention.some((item) => item.includes("Employer NI")));
  assert.ok(figures.attention.some((item) => item.includes("Accruals are not yet fully supported")));
});

test("retention, loans, payroll empty states and audit text use business words", () => {
  const retention = retentionPosition([{ retention_withheld: "500.0000", status: "posted" }], [{ amount: "200.0000", status: "posted" }]);
  assert.equal(retention.withheld, "£500.00");
  assert.equal(retention.released, "£200.00");
  assert.equal(retention.remaining, "£300.00");
  const loans = loanPosition([
    { entry_kind: "loan_draw", amount: "2000.0000", status: "posted" },
    { entry_kind: "loan_repayment", amount: "500.0000", status: "posted" },
  ]);
  assert.equal(loans.draw, "£2,000.00");
  assert.equal(loans.repayment, "£500.00");
  assert.equal(loans.outstanding, "£1,500.00");
  assert.match(payrollEmptyCopy("CIS"), /will not invent/);
  assert.equal(auditDescription({ action: "posted", entity_type: "supplier_invoice", reason: "NS-100" }), "posted supplier invoice. NS-100");
  assert.equal(retentionReleaseStatus(5000000n, 0n), "Fully released");
  assert.equal(retentionReleaseStatus(2000000n, 3000000n), "Partially released");
  assert.equal(retentionReleaseStatus(0n, 5000000n), "Withheld");
});

test("owner control keeps one meaning for each figure and does not invent a category", () => {
  const figures = ownerControl({
    projectSelected: false,
    projectName: "",
    receipts: [{ status: "posted", amount: "50.0000", receipt_date: "2026-10-11", allocated_amount: "50.0000", receipt_reversed: false }],
    invoices: [{ status: "posted", document_kind: "invoice", project_id: "p1", net_amount: "100.0000", gross_amount: "120.0000", outstanding: "70.0000", external_reference: "", due_date: "" }],
    cvrs: [{ name: "Riverside", approved_contract_value: "100000.0000", approved_budget: "80000.0000", actual_eligible_cost: "1000.0000", forecast_margin: "missing", forecast_final_cost: "missing" }],
    costs: [
      { status: "posted", document_type: "supplier_invoice", outstanding: "0.0000", gross_amount: "1200.0000", external_reference: "NS-100", project_names: "Riverside" },
      { status: "posted", document_type: "supplier_credit", outstanding: "-300.0000", gross_amount: "-360.0000", external_reference: "CR-1", project_names: "Riverside" },
      { status: "draft", document_type: "supplier_invoice", outstanding: "0.0000", gross_amount: "1200.0000", external_reference: "NS-100", project_names: "Riverside" },
    ],
    supplierPayments: [{ status: "posted", amount: "700.0000", payment_date: "2026-10-12", payment_reversed: false }],
    funding: [{ status: "posted", entry_kind: "loan_draw", amount: "2000.0000", entry_date: "2026-10-01" }],
    openings: [{ review_status: "reviewed", balance_kind: "supplier_payable", amount: "250.0000" }],
    categories: [{ category: "Materials", eligible: "700.0000" }],
    categoryLoadFailed: false,
    releasesPosted: 2,
    retentionAudited: false,
    today: "2026-10-12",
  });
  assert.equal(figures.cashReceived, "£50.00");
  assert.equal(figures.remainingToInvoice, "£99,900.00");
  assert.equal(figures.customerOutstanding, "£70.00");
  assert.equal(figures.actualCost, "£1,000.00");
  // Liability outstanding only (invoice £0); credits are not a second payable and are not bank paid.
  assert.equal(figures.supplierOutstanding, "£0.00");
  assert.equal(figures.supplierOutstandingScope, "COMPANY-WIDE");
  assert.equal(figures.categoryGap, "£300.00");
  assert.equal(figures.budgetUse[0].percent, "1.25%");
  assert.equal(figures.cashMonths?.length, 1);
  assert.equal(figures.cashMonths?.[0].loanDraws, 20000000n);
  assert.equal(figures.cashMonths?.[0].supplierPayments, 7000000n);
  assert.equal(figures.cashMonths?.[0].receipts, 500000n);
  assert.ok(figures.attention.some((item) => /incomplete \(missing CTC|Forecast Profit is an estimate/i.test(item)));
  assert.equal(figures.attention.some((item) => item.includes("could not be loaded")), false);
  assert.match(figures.supplierNote, /COMPANY-WIDE document liability/);
  assert.ok(figures.attention.some((item) => item.includes("not backfilled")));
  assert.equal(figures.attention.some((item) => item.includes("£1,000.00")), false);
  const failedLoad = ownerControl({ ...blankOwner(), categoryLoadFailed: true, categories: [] });
  assert.equal(failedLoad.attention.some((item) => item.includes("Cost-code")), false);
  const missingContract = ownerControl({
    ...blankOwner(),
    cvrs: [{ name: "Other Site", approved_contract_value: "missing", approved_budget: "0.0000", actual_eligible_cost: "0.0000", forecast_margin: "missing", forecast_final_cost: "missing" }],
    invoices: [],
  });
  assert.equal(missingContract.remainingToInvoice, "Not determined");
  const zeroContract = ownerControl({
    ...blankOwner(),
    cvrs: [{ name: "Empty", approved_contract_value: "0.0000", approved_budget: "0.0000", actual_eligible_cost: "0.0000", forecast_margin: "missing", forecast_final_cost: "missing" }],
    invoices: [],
  });
  assert.equal(zeroContract.remainingToInvoice, "£0.00");
});

test("project cash uses effective receipt allocations and reversed bank movements stay out", () => {
  const project = ownerControl({
    ...blankOwner(),
    projectSelected: true,
    projectName: "Riverside",
    receipts: [
      { status: "posted", amount: "100.0000", receipt_date: "2026-10-03", allocated_amount: "0.0000", receipt_reversed: false },
    ],
    invoices: [
      { status: "posted", document_kind: "invoice", project_id: "p1", gross_amount: "120.0000", outstanding: "50.0000", cash_allocated: "40.0000" },
      { status: "posted", document_kind: "credit", project_id: "p1", gross_amount: "-30.0000", outstanding: "-30.0000", cash_allocated: "0.0000" },
    ],
  });
  assert.equal(project.cashReceived, "£40.00");
  assert.equal(project.cashMonths, null);
  assert.match(project.cashNote, /Credits, reversed receipts and unallocated receipts/);

  const company = ownerControl({
    ...blankOwner(),
    receipts: [
      { status: "posted", amount: "50.0000", receipt_date: "2026-10-11", receipt_reversed: false },
      { status: "posted", amount: "80.0000", receipt_date: "2026-10-11", receipt_reversed: true },
      { status: "posted", amount: "100.0000", receipt_date: "2026-10-03", allocated_amount: "0.0000", receipt_reversed: false },
    ],
    supplierPayments: [
      { status: "posted", amount: "700.0000", payment_date: "2026-10-12", payment_reversed: false },
      { status: "posted", amount: "20.0000", payment_date: "2026-10-12", payment_reversed: true },
    ],
    funding: [{ status: "posted", entry_kind: "loan_draw", amount: "2000.0000", entry_date: "2026-10-01" }],
  });
  assert.equal(company.cashReceived, "£150.00");
  assert.equal(company.cashMonths?.length, 1);
  assert.equal(company.cashMonths?.[0].receipts, 1500000n);
  assert.equal(company.cashMonths?.[0].supplierPayments, 7000000n);
  assert.equal(company.cashMonths?.[0].loanDraws, 20000000n);
  assert.notEqual(company.cashMonths?.[0].receipts, company.cashMonths?.[0].loanDraws);
});

test("missing cash and reversal fields do not become zero or an active movement", () => {
  assert.equal(invoiceCashReceived({ status: "posted", document_kind: "invoice" }), null);
  assert.equal(invoiceCashReceived({ status: "posted", document_kind: "invoice", cash_allocated: null }), null);
  assert.equal(invoiceCashReceived({ status: "posted", document_kind: "invoice", cash_allocated: "not-a-number" }), null);
  assert.equal(invoiceCashReceived({ status: "posted", document_kind: "invoice", cash_allocated: "40.0000" }), 400000n);
  assert.equal(invoiceCashReceived({ status: "posted", document_kind: "invoice", cash_allocated: false }), null);
  assert.equal(reversalState({ status: "posted", amount: "10.0000" }, "receipt_reversed"), null);
  assert.equal(reversalState({ status: "posted", receipt_reversed: null }, "receipt_reversed"), null);
  assert.equal(reversalState({ status: "posted", receipt_reversed: "no" }, "receipt_reversed"), null);
  assert.equal(reversalState({ status: "posted", receipt_reversed: false }, "receipt_reversed"), false);
  assert.equal(reversalState({ status: "posted", receipt_reversed: "false" }, "receipt_reversed"), false);
  assert.equal(reversalState({ status: "posted", receipt_reversed: true }, "receipt_reversed"), true);
  assert.equal(reversalState({ status: "posted", payment_reversed: "true" }, "payment_reversed"), true);
  const missing = ownerControl({
    ...blankOwner(),
    receipts: [{ status: "posted", amount: "50.0000", receipt_date: "2026-10-11" }],
    supplierPayments: [{ status: "posted", amount: "700.0000", payment_date: "2026-10-12" }],
  });
  assert.equal(missing.cashReceived, "Not determined");
  assert.equal(missing.cashMonths, null);
  assert.match(missing.cashMovementNote, /not determined/);
  const project = ownerControl({
    ...blankOwner(),
    projectSelected: true,
    invoices: [{ status: "posted", document_kind: "invoice", gross_amount: "120.0000", outstanding: "0.0000" }],
  });
  assert.equal(project.cashReceived, "Not determined");
  assert.notEqual(project.cashReceived, "£0.00");
});

test("DEMO multi-job invoice keeps COMPANY-WIDE totals when a project is selected", () => {
  const demoCosts = [
    {
      document_type: "supplier_invoice",
      status: "posted",
      external_reference: "DEMO-INV-1200",
      gross_amount: "1440.0000",
      outstanding: "920.0000",
      cash_paid: "400.0000",
      credit_applied: "120.0000",
      project_names: "DEMO Project Alpha, DEMO Project Beta",
    },
    {
      document_type: "supplier_credit",
      status: "posted",
      external_reference: "DEMO-CR-100",
      gross_amount: "-120.0000",
      outstanding: "0.0000",
      project_names: "DEMO Project Alpha",
    },
  ];
  const companyTotals = postedSupplierTotals(demoCosts);
  assert.equal(companyTotals.scope, "COMPANY-WIDE");
  assert.equal(companyTotals.gross, "£1,440.00");
  assert.equal(companyTotals.cashPaid, "£400.00");
  assert.equal(companyTotals.creditApplied, "£120.00");
  assert.equal(companyTotals.outstanding, "£920.00");

  assert.equal(costDocumentTouchesProject(demoCosts[0], "", ""), true);
  assert.equal(costDocumentTouchesProject(demoCosts[0], "alpha-id", "DEMO Project Alpha"), true);
  assert.equal(costDocumentTouchesProject(demoCosts[0], "beta-id", "DEMO Project Beta"), true);
  assert.equal(costDocumentTouchesProject(demoCosts[0], "other-id", "Other Job"), false);
  assert.equal(costDocumentTouchesProject(demoCosts[1], "alpha-id", "DEMO Project Alpha"), true);
  assert.equal(costDocumentTouchesProject(demoCosts[1], "beta-id", "DEMO Project Beta"), false);

  // Project-filtered list must not be used for document liability totals (would show £0 before the fix).
  const alphaOnly = demoCosts.filter((row) => costDocumentTouchesProject(row, "alpha-id", "DEMO Project Alpha"));
  assert.equal(alphaOnly.some((row) => row.external_reference === "DEMO-INV-1200"), true);
  assert.equal(alphaOnly.some((row) => row.external_reference === "DEMO-CR-100"), true);
  const wrongLegacyFilter = demoCosts.filter((row) => {
    const names = String(row.project_names ?? "").split(",").map((name) => name.trim()).filter(Boolean);
    return names.length === 1 && names[0] === "DEMO Project Alpha";
  });
  assert.equal(wrongLegacyFilter.some((row) => row.external_reference === "DEMO-INV-1200"), false);

  const alphaControl = ownerControl({
    projectSelected: true,
    projectName: "DEMO Project Alpha",
    receipts: [],
    invoices: [],
    cvrs: [{ name: "DEMO Project Alpha", approved_contract_value: "20000.0000", approved_budget: "5000.0000", actual_eligible_cost: "400.0000", actual_incurred_cost: "400.0000", forecast_final_cost: "3900.0000", forecast_final_profit: "16100.0000", forecast_final_margin_percent: "80.5000", forecast_margin: "16100.0000", cost_to_complete: "3500.0000" }],
    costs: demoCosts,
    supplierPayments: [{ status: "posted", amount: "400.0000", payment_date: "2026-10-12", payment_reversed: false }],
    funding: [],
    openings: [],
    categories: [],
    categoryLoadFailed: false,
    releasesPosted: 0,
    retentionAudited: true,
    today,
  });
  assert.equal(alphaControl.supplierOutstanding, "£920.00");
  assert.equal(alphaControl.supplierOutstandingScope, "COMPANY-WIDE");
  assert.ok(alphaControl.attention.some((item) => /multi-job/i.test(item)));
  assert.equal(worksheetHeading("DAYWORKS LIVE"), "BASIC DAYWORKS");
});

test("credit settlement is not labelled as cash paid", () => {
  const names = new Map([["c1", "Harbour Client"]]);
  const paid = customerViews([{ status: "posted", document_kind: "invoice", counterparty_id: "c1", gross_amount: "120.0000", outstanding: "0.0000", cash_allocated: "120.0000", credit_applied: "0.0000", due_date: "2026-11-01" }], names, today);
  assert.equal(paid[0].status, "Paid");
  assert.equal(paid[0].received, "£120.00");
  const credited = customerViews([{ status: "posted", document_kind: "invoice", counterparty_id: "c1", gross_amount: "120.0000", outstanding: "0.0000", cash_allocated: "0.0000", credit_applied: "120.0000", due_date: "2026-11-01" }], names, today);
  assert.equal(credited[0].status, "Credited");
  assert.notEqual(credited[0].status, "Paid");
  const mixed = customerViews([{ status: "posted", document_kind: "invoice", counterparty_id: "c1", gross_amount: "120.0000", outstanding: "30.0000", cash_allocated: "40.0000", credit_applied: "50.0000", due_date: "2026-11-01" }], names, today);
  assert.equal(mixed[0].status, "Partial");
  const settledByBoth = customerViews([{ status: "posted", document_kind: "invoice", counterparty_id: "c1", gross_amount: "120.0000", outstanding: "0.0000", cash_allocated: "70.0000", credit_applied: "50.0000", due_date: "2026-11-01" }], names, today);
  assert.equal(settledByBoth[0].status, "Settled — cash + credit");
  assert.notEqual(settledByBoth[0].status, "Paid");
  assert.notEqual(settledByBoth[0].status, "Partial");
  const open = customerViews([{ status: "posted", document_kind: "invoice", counterparty_id: "c1", gross_amount: "120.0000", outstanding: "120.0000", cash_allocated: "0.0000", credit_applied: "0.0000", due_date: "2026-11-01" }], names, today);
  assert.equal(open[0].status, "Posted");
  const reversedReceipt = customerViews([{ status: "posted", document_kind: "invoice", counterparty_id: "c1", gross_amount: "120.0000", outstanding: "120.0000", cash_allocated: "0.0000", credit_applied: "0.0000", due_date: "2026-11-01", receipt_references: "" }], names, today);
  assert.equal(reversedReceipt[0].status, "Posted");
  assert.notEqual(reversedReceipt[0].status, "Paid");
  const unknown = customerViews([{ status: "posted", document_kind: "invoice", counterparty_id: "c1", gross_amount: "120.0000", outstanding: "0.0000", due_date: "2026-11-01" }], names, today);
  assert.equal(unknown[0].status, "Not determined");
  assert.equal(unknown[0].received, "Not determined");
  assert.equal(receiptAllocationStatus({ status: "posted", amount: "80.0000", allocated_amount: "0.0000", receipt_reversed: true }), "Reversed");
  assert.equal(receiptAllocationStatus({ status: "posted", amount: "80.0000", allocated_amount: "0.0000" }), "Reversal not confirmed");
  assert.equal(activeMovementCount([{ status: "posted", payment_reversed: false }, { status: "posted", payment_reversed: true }], "payment_reversed"), 1);
  assert.equal(activeMovementCount([{ status: "posted" }], "payment_reversed"), null);
});

function blankOwner() {
  return {
    projectSelected: false,
    projectName: "",
    receipts: [],
    invoices: [],
    cvrs: [],
    costs: [],
    supplierPayments: [],
    funding: [],
    openings: [],
    categories: [],
    categoryLoadFailed: false,
    releasesPosted: 0,
    retentionAudited: true,
    today: "2026-10-12",
  };
}

test("finance module nav filter hides company finance leaves when disabled", async () => {
  const { filterFinanceModuleNavigation, getDesktopSidebarNavigationTree } = await import(
    "../../config/navigation.ts"
  );
  const on = getDesktopSidebarNavigationTree("administrator", { financeModuleEnabled: true });
  const off = filterFinanceModuleNavigation(on, false);
  const leafHrefs = (nodes: { href?: string; children?: unknown[] }[]): string[] => {
    const out: string[] = [];
    const walk = (list: { href?: string; children?: unknown[] }[]) => {
      for (const n of list) {
        if (n.href) out.push(n.href);
        if (n.children) walk(n.children as { href?: string; children?: unknown[] }[]);
      }
    };
    walk(nodes);
    return out;
  };
  assert.ok(leafHrefs(on).includes("/finance"));
  assert.ok(leafHrefs(on).includes("/finance/audit"));
  assert.equal(leafHrefs(off).includes("/finance"), false);
  assert.equal(leafHrefs(off).includes("/finance/audit"), false);
  assert.ok(leafHrefs(off).includes("/budgets"));
});

