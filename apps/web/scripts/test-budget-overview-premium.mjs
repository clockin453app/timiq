/**
 * Saved Budget detail Overview — premium presentation checks (no calc changes).
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
const client = read("app/(app)/budgets/budgets-client.tsx");
const calculator = read("app/(app)/budgets/budgets-calculator-tab.tsx");

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

// Values still render (Phase 3 Overview financial panels)
check("planned budget still shown", /planned_budget_amount/.test(overview) || /planned_budget_amount/.test(saved));
check("Planned cost budget label", /Planned cost budget/.test(overview));
check("forecast total cost shown", /Forecast total cost/.test(overview));
check("remaining / over budget shown", /Cost budget remaining/.test(overview) && /Over budget/.test(overview));
check("budget used percent still shown", /budget_used_percent/.test(overview) || /BudgetUsageProgress/.test(overview));
check("finalised labour still shown", /Finalised labour/.test(overview));
check("estimated labour still shown", /Estimated labour/.test(overview));
check("purchases still shown", /Purchases/.test(overview));
check("open shifts still shown", /Open shifts/.test(overview) && /Missing rates/.test(overview));
check("expense categories still shown", /Expense categories/.test(ui) && /BudgetCategoryBreakdown/.test(overview));

// Actions preserved
check("Edit action present", /openEditFromDetail/.test(saved) && /\bEdit\b/.test(saved));
check("Print report present", /Print report/.test(saved) && /handlePrint/.test(saved));
check("Export CSV present", /Export CSV/.test(saved) && /handleExportCsv/.test(saved));
check("Archive present as danger", /Archive/.test(saved) && /variant=\"danger\"/.test(saved) && /handleArchive/.test(saved));
check("no toolbar Back button", !/>\s*Back\s*</.test(saved));
check("list return link present", /Saved budgets/.test(saved));

// Tabs
check("overview purchases labour reports tabs", /Overview/.test(saved) && /Purchases/.test(saved) && /Labour/.test(saved) && /Reports/.test(saved));
check("setDetailTab still used", /setDetailTab/.test(saved));
check("saved/quick calculator tabs refined", /budgetUnderlineTabClass/.test(client) && /tab_saved/.test(client));
check("record tabs use underline class", /budgetUnderlineTabClass\(detailTab === id\)/.test(saved));
check("no bordered tab bar container on detail", !/rounded-\[var\(--radius-md\)\] border border-\[var\(--color-border-dark\)\] bg-\[var\(--color-cell\)\] p-1/.test(saved));

// Overview no metric-card grid
check("no BudgetCompactStat on overview", !/BudgetCompactStat/.test(saved) && !/BudgetCompactStat/.test(overview));
check("no BudgetHealthBar on overview", !/BudgetHealthBar/.test(saved) && !/BudgetHealthBar/.test(overview));
check("uses BudgetOverviewFinancial", /BudgetOverviewFinancial/.test(saved) && /BudgetOverviewFinancial/.test(overview));
check("BudgetFinancialSummary retained in ui", /export function BudgetFinancialSummary\b/.test(ui));
check("no overview 4-col compact card grid", !/grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4[\s\S]*BudgetCompactStat/.test(saved));

// Categories compact list
check("categories use list not card grid", /divide-y divide-\[var\(--color-border\)\]/.test(ui));
check("show zero categories control", /Show zero categories/.test(overview));
check("category percent bar optional", /pct\.toFixed\(0\)/.test(ui));

// Notices
check("estimated labour warnings remain", /cost\.warnings/.test(overview) && /warning-50/.test(overview));
check("labour calculation disclosure", /How labour is calculated/.test(overview) && /estimate_note/.test(overview));
check("operational site filter note", /Labour totals are filtered by the selected operational site/.test(overview));

// Mobile actions
check("mobile more actions menu", /More actions/.test(saved) && /lg:hidden/.test(saved));
check("desktop actions row", /hidden flex-wrap justify-end gap-2 lg:flex/.test(saved));
check("full width mobile action buttons", /min-h-\[44px\] w-full/.test(saved));
check("bottom nav clearance", /layout-mobile-bottom-nav-height/.test(saved));
check("320 overflow safety", /min-w-0 max-w-full/.test(saved) && /timiq-scroll-x/.test(saved));

// Calculator unchanged card style retained
check("calculator still uses BudgetStatCard", /BudgetStatCard/.test(calculator));

console.log(`${passed} budget overview premium redesign checks passed`);
