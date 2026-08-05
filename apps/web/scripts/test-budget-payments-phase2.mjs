/**
 * Budget Billing Phase 2 (payments) — static source checks (web UI).
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

// Summary + invoice balance fields
check("payments_received_gross in API types", /payments_received_gross/.test(api));
check("outstanding_gross in API types", /outstanding_gross/.test(api));
check("overdue_outstanding_gross in BillingSummary", /overdue_outstanding_gross/.test(api));
check("Payments received — Gross card", /Payments received — Gross/.test(billing));
check("Outstanding — Gross card", /Outstanding — Gross/.test(billing));
check("Overdue outstanding — Gross card", /Overdue outstanding — Gross/.test(billing));
check("Paid / Outstanding table columns", />Paid</.test(billing) && />Outstanding</.test(billing));
check("invoice payments_received_gross column", /row\.payments_received_gross/.test(billing));
check("invoice outstanding_gross column", /row\.outstanding_gross/.test(billing));

// Record payment actions
check("Record payment action present", /Record payment/.test(billing));
check("no Record payment on Draft", !/ds === \"draft\"[\s\S]{0,1200}Record payment/.test(billing));
check(
  "Record payment for issued/part_paid/overdue",
  /ds === \"issued\" \|\| ds === \"part_paid\" \|\| ds === \"overdue\"/.test(billing) &&
    /Record payment/.test(billing),
);
check("Payment history action", /Payment history/.test(billing));

// Status badges Phase 2
check("part_paid badge warning", /part_paid/.test(billing) && /tone=\"warning\"/.test(billing));
check("paid badge success", /s === \"paid\"/.test(billing) && /tone=\"success\"/.test(billing));
check("Part paid label", /Part paid/.test(billing));

// Payment API helpers
for (const name of ["listInvoicePayments", "createInvoicePayment", "reverseInvoicePayment"]) {
  check(`API helper ${name}`, new RegExp(`export async function ${name}\\b`).test(api));
}
check("CreatePaymentBody client_action_id", /CreatePaymentBody[\s\S]*client_action_id/.test(api));
check("PaymentMethod options", /bank_transfer/.test(api) && /PAYMENT_METHOD_OPTIONS/.test(api));
check(
  "method labels Bank transfer Card Cash Cheque Other",
  /Bank transfer/.test(api) &&
    /Card/.test(api) &&
    /Cash/.test(api) &&
    /Cheque/.test(api) &&
    /Other/.test(api),
);

// Record payment UX
check("payment client_action_id stable per submit", /paymentClientActionId/.test(billing) && /client_action_id: paymentClientActionId/.test(billing));
check("default amount outstanding", /outstanding_gross/.test(billing) && /setPaymentAmount/.test(billing));
check("Saving… disable while busy", /Saving…/.test(billing));
check(
  "success messages",
  /Payment recorded successfully\./.test(billing) &&
    /Payment was already recorded successfully\./.test(billing),
);
check(
  "exceeds outstanding message",
  /Payment exceeds the invoice outstanding balance\./.test(billing),
);

// Payment history + reverse
check("list payments including reversed", /listInvoicePayments/.test(billing) && /is_reversed/.test(billing));
check("reverse confirm + reason", /reverseConfirm/.test(billing) && /reverseInvoicePayment/.test(billing));
check("no payment edit/delete", !/Edit payment/i.test(billing) && !/Delete payment/i.test(billing));

// Mobile
check("min-h-[44px] touch targets", /min-h-\[44px\]/.test(billing));
check("mobile overflow guards", /min-w-0 max-w-full/.test(billing));
check("full-screen-friendly payment modals", /fixed inset-0/.test(billing) && /Record payment/.test(billing));

// Out of scope
check("no bank feed", !/bank feed/i.test(billing) && !/bank_feed/i.test(billing) && !/bank feed/i.test(api));
check("no credit note", !/credit note/i.test(billing) && !/credit_note/i.test(billing));
check("no Tasks tab", !/\[\"tasks\"/.test(saved) && !/>\s*Tasks\s*</.test(saved));
check(
  "no Overview redesign in billing",
  !/Overview redesign/i.test(billing) && !/detailTab === \"overview\"/.test(billing),
);
check("reports tab unchanged for cost Export CSV", /detailTab === \"reports\"[\s\S]*Export CSV/.test(saved));

console.log(`${passed} budget payments phase2 checks passed`);
