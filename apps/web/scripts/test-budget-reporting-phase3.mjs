/**
 * Budget Billing Phase 3 (reporting / Overview financial) — static source checks (web UI).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");

const saved = read("app/(app)/budgets/budgets-saved-tab.tsx");
const overview = read("app/(app)/budgets/budget-overview-financial.tsx");
const ui = read("app/(app)/budgets/budget-ui.tsx");
const api = read("features/budgets/api.ts");

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

// Overview section headings
check("Cost position heading", /Cost position/.test(overview));
check("Billing position heading", /Billing position/.test(overview));
check("Profitability heading", /Profitability/.test(overview));
check("renders BudgetOverviewFinancial", /BudgetOverviewFinancial/.test(saved));

// Net / Gross labels
check("Contract value Net", /Contract value Net/.test(overview));
check("Amount invoiced Net", /Amount invoiced Net/.test(overview));
check("Payments received Gross", /Payments received Gross/.test(overview));
check("Outstanding Gross", /Outstanding Gross/.test(overview));
check("Overdue outstanding Gross", /Overdue outstanding Gross/.test(overview));
check("Forecast revenue Net", /Forecast revenue Net/.test(overview));

// Contract null messaging
check(
  "Set contract value to calculate forecast profit",
  /Set contract value to calculate forecast profit\./.test(overview),
);
check(
  "Forecast profit note",
  /Forecast profit uses the current Contract value and forecast project costs\./.test(overview),
);

// API helpers
for (const name of [
  "fetchBudgetFinancialSummary",
  "downloadFinancialSummaryCsv",
  "openFinancialSummaryPrint",
  "downloadInvoiceRegisterCsv",
  "openInvoiceRegisterPrint",
]) {
  check(
    `API helper ${name}`,
    new RegExp(`export async function ${name}\\b`).test(api) ||
      new RegExp(`export function ${name}\\b`).test(api),
  );
}
check("financial-summary endpoint", /financial-summary/.test(api));
check("invoice-register endpoint", /invoice-register/.test(api));
check("BudgetFinancialSummaryResponse type", /BudgetFinancialSummaryResponse/.test(api));
check("cost_position type fields", /forecast_total_cost/.test(api) && /BudgetCostPosition/.test(api));
check("profitability type", /forecast_profit/.test(api) && /BudgetProfitability/.test(api));

// Existing cost report still referenced
check("downloadBudgetReportCsv still used", /downloadBudgetReportCsv/.test(saved) && /downloadBudgetReportCsv/.test(api));
check("openBudgetReportPrint still used", /openBudgetReportPrint/.test(saved) && /openBudgetReportPrint/.test(api));
check("report.csv path retained", /report\.csv/.test(api));
check("report.print path retained", /report\.print/.test(api));

// Reports tab three sections
const reportsBlock = saved.match(/detailTab === "reports"[\s\S]*?(?=detailTab ===|showEdit|$)/)?.[0] ?? "";
check("Reports Cost report section", /Cost report/.test(reportsBlock));
check("Reports Project financial summary section", /Project financial summary/.test(reportsBlock));
check("Reports Customer invoice register section", /Customer invoice register/.test(reportsBlock));
check("Export cost CSV", /Export cost CSV/.test(reportsBlock));
check("Print cost report", /Print cost report/.test(reportsBlock));
check("Export financial summary CSV", /Export financial summary CSV/.test(reportsBlock));
check("Print financial summary", /Print financial summary/.test(reportsBlock));
check("Export invoice CSV", /Export invoice CSV/.test(reportsBlock));
check("Print invoice register", /Print invoice register/.test(reportsBlock));
check("reports buttons min-h-[44px]", /min-h-\[44px\]/.test(reportsBlock));
check("reports aria-labels", /aria-label="Export cost CSV"/.test(reportsBlock));

// Tasks & notes tab is Phase 4 (see test-budget-tasks-notes-phase4.mjs)
check(
  "Tasks & notes tab after Billing before Reports (Phase 4)",
  /\["billing", "Billing"\][\s\S]*\["tasks", "Tasks & notes"\][\s\S]*\["reports", "Reports"\]/.test(saved),
);

// Overflow guards
check("overview min-w-0", /min-w-0/.test(overview) && /min-w-0 max-w-full/.test(overview));
check("saved overflow guards", /min-w-0 max-w-full/.test(saved));
check("reports min-w-0", /min-w-0 max-w-full/.test(reportsBlock));

// Reusable UI pieces
check("BudgetUsageProgress aria-valuenow", /aria-valuenow/.test(ui) && /BudgetUsageProgress/.test(ui));
check("BudgetOverviewPanel", /BudgetOverviewPanel/.test(ui) && /BudgetOverviewPanel/.test(overview));
check("BudgetFinancialSummary retained", /export function BudgetFinancialSummary\b/.test(ui));

// Fetch financial summary with detail
check("fetchBudgetFinancialSummary on load", /fetchBudgetFinancialSummary/.test(saved));

console.log(`${passed} budget reporting phase3 checks passed`);
