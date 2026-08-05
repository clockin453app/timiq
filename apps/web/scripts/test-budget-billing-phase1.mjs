/**
 * Budget Billing Phase 1 — static source checks (web UI).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");

const saved = read("app/(app)/budgets/budgets-saved-tab.tsx");
const billing = read("app/(app)/budgets/budget-billing-tab.tsx");
const api = read("features/budgets/api.ts");

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

// Tab order: Billing after Labour, before Reports; no Tasks
const tabBlock = saved.match(/\(\(\s*\[[\s\S]*?\] as const\s*\)\)\.map\(\(\[id, label\]\)/)?.[0] ?? "";
check(
  "Billing tab after Labour",
  /\[\"labour\", \"Labour\"\][\s\S]*\[\"billing\", \"Billing\"\][\s\S]*\[\"reports\", \"Reports\"\]/.test(tabBlock) ||
    /\[\"labour\", \"Labour\"\][\s\S]*\[\"billing\", \"Billing\"\][\s\S]*\[\"reports\", \"Reports\"\]/.test(saved),
);
check("BudgetDetailTab includes billing", /type BudgetDetailTab =[\s\S]*\"billing\"/.test(saved));
check("renders BudgetBillingTab", /BudgetBillingTab/.test(saved) && /detailTab === \"billing\"/.test(saved));
check("no Tasks tab", !/\[\"tasks\"/.test(saved) && !/>\s*Tasks\s*</.test(saved));

// Contract value UX
check("Not configured when null", /Not configured/.test(billing));
check("Set contract value", /Set contract value/.test(billing));
check("Planned vs contract explanation", /Planned budget = costs/.test(billing) && /Contract value = customer revenue/.test(billing));
check(
  "rejects below invoiced message",
  /Contract value cannot be lower than the active invoiced amount\./.test(billing),
);

// Phase 1 invoice lifecycle remains; Phase 2 adds payment recording on non-draft invoices
check("Draft actions Edit Issue Delete Upload", /Edit/.test(billing) && /Issue/.test(billing) && /Delete/.test(billing) && /Upload document/.test(billing));
check("Record payment not on Draft branch alone", /ds === \"draft\"[\s\S]*?return \([\s\S]*?<\/div>\s*\);\s*\}/.test(billing));
check("no Record payment inside draft action block", !/ds === \"draft\"[\s\S]{0,800}Record payment/.test(billing));
check("client_action_id for create retries", /client_action_id/.test(api) && /createBudgetInvoice/.test(api));
check("client_action_id generated once per create", /client_action_id/.test(billing) && /randomUUID/.test(billing));

// Status badges (Phase 1 core statuses)
check("Draft status badge", /draft/i.test(billing) && /InvoiceStatusBadge/.test(billing));
check("Issued / Overdue / Void badges", /issued/.test(billing) && /overdue/.test(billing) && /void/.test(billing));
check("status badge tones", /tone=\"info\"/.test(billing) && /tone=\"danger\"/.test(billing));

// Touch targets + mobile overflow
check("min-h-[44px] touch targets", /min-h-\[44px\]/.test(billing));
check("mobile overflow guards", /min-w-0 max-w-full/.test(billing));

// Summary cards labels
check("Net VAT Gross labels", /Amount invoiced Net/.test(billing) && /VAT invoiced/.test(billing) && /Gross invoiced/.test(billing));
check("Remaining to invoice", /Remaining to invoice/.test(billing));
check("Over-invoiced only when > 0", /overInvoiced > 0/.test(billing) || /Over-invoiced/.test(billing));
check("Draft and Overdue counts", /Draft count/.test(billing) && /Overdue count/.test(billing));

// Invoice actions by status
check("Void confirm + reason", /voidConfirm/.test(billing) && /confirm: true/.test(billing) && /reason/.test(billing));
check("issue requires document message", /document is required before issuing/i.test(billing));

// Document blob pattern (no public URL preload)
check("authenticated document blob fetch", /fetchBudgetInvoiceDocumentBlob/.test(api) && /credentials: \"include\"/.test(api));
check("revoke object URL on close", /revokeObjectURL/.test(billing));
check("no list preload of documents", !/invoices\.map[\s\S]*fetchBudgetInvoiceDocumentBlob/.test(billing));

// API helpers present
for (const name of [
  "fetchBillingSummary",
  "updateContractValue",
  "listBudgetInvoices",
  "createBudgetInvoice",
  "patchBudgetInvoice",
  "deleteBudgetInvoice",
  "issueBudgetInvoice",
  "voidBudgetInvoice",
  "uploadBudgetInvoiceDocument",
  "downloadBudgetInvoiceDocument",
  "fetchBudgetInvoiceDocumentBlob",
]) {
  check(`API helper ${name}`, new RegExp(`export async function ${name}\\b`).test(api) || new RegExp(`export function ${name}\\b`).test(api));
}

// Billing exports deferred; cost reports remain on Reports tab (Phase 3 adds clearer labels + more exports)
check("billing CSV/print later note", /Billing CSV and print exports will be added later/.test(billing));
check(
  "reports tab still has cost export",
  /detailTab === \"reports\"[\s\S]*Export cost CSV/.test(saved) ||
    /detailTab === \"reports\"[\s\S]*Export CSV/.test(saved),
);

// VAT helpers
check(
  "VAT helpers 0 5 20 Custom",
  /\["0", "5", "20", "custom"\]/.test(billing) && /Custom/.test(billing) && /\$\{p\}%/.test(billing),
);

// Double-submit guard
check("prevent double-submit while saving", /savingRef/.test(billing) && /busy/.test(billing));

console.log(`${passed} budget billing phase1 checks passed`);
