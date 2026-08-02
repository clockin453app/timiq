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
const ui = read("app/(app)/budgets/budget-ui.tsx");
const client = read("app/(app)/budgets/budgets-client.tsx");
const calculator = read("app/(app)/budgets/budgets-calculator-tab.tsx");

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

// Values still render
check("planned budget still shown", /planned_budget_amount/.test(saved) && /Planned budget/.test(ui));
check("total spent still shown", /total_spent/.test(saved) && /Total spent/.test(ui));
check("remaining still shown", /remaining_budget/.test(saved) && /Remaining/.test(ui));
check("budget used percent still shown", /budget_used_percent/.test(saved));
check("finalised labour still shown", /finalized_labour_cost/.test(saved) && /Finalised labour/.test(ui));
check("estimated labour still shown", /estimated_labour_cost/.test(saved) && /Estimated labour/.test(ui));
check("purchases still shown", /total_expenses/.test(saved) && /Purchases \/ expenses/.test(ui));
check("open shifts still shown", /open_shift_count/.test(saved) && /missing_rate_count/.test(saved));
check("expense categories still shown", /Expense categories/.test(ui) && /BudgetCategoryBreakdown/.test(saved));

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
check("no BudgetCompactStat on overview", !/BudgetCompactStat/.test(saved));
check("no BudgetHealthBar on overview", !/BudgetHealthBar/.test(saved));
check("uses BudgetFinancialSummary", /BudgetFinancialSummary/.test(saved) && /BudgetFinancialSummary/.test(ui));
check("uses BudgetOperationalMetrics", /BudgetOperationalMetrics/.test(saved));
check("no overview 4-col compact card grid", !/grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4[\s\S]*BudgetCompactStat/.test(saved));

// Categories compact list
check("categories use list not card grid", /divide-y divide-\[var\(--color-border\)\]/.test(ui));
check("show zero categories control", /Show zero categories/.test(saved));
check("category percent bar optional", /pct\.toFixed\(0\)/.test(ui));

// Notices
check("estimated labour warnings remain", /totals\.warnings/.test(saved) && /warning-50/.test(saved));
check("labour calculation disclosure", /How labour is calculated/.test(saved) && /estimate_note/.test(saved));
check("operational site filter note", /Labour totals are filtered by the selected operational site/.test(saved));

// Mobile actions
check("mobile more actions menu", /More actions/.test(saved) && /lg:hidden/.test(saved));
check("desktop actions row", /hidden flex-wrap justify-end gap-2 lg:flex/.test(saved));
check("full width mobile action buttons", /min-h-\[44px\] w-full/.test(saved));
check("bottom nav clearance", /layout-mobile-bottom-nav-height/.test(saved));
check("320 overflow safety", /min-w-0 max-w-full/.test(saved) && /timiq-scroll-x/.test(saved));

// Calculator unchanged card style retained
check("calculator still uses BudgetStatCard", /BudgetStatCard/.test(calculator));

console.log(`${passed} budget overview premium redesign checks passed`);
