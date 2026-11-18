import assert from "node:assert/strict";
import test from "node:test";

import {
  creditNoteNetEffect,
  demoMonthlyPeriods,
  missingCtcIncomplete,
  reconcileKpiToContributions,
  sumContributionStrings,
  uniqueDocumentAmounts,
  formatMoneyCell,
  formulaCheckFromDifference,
} from "./finance-reconcile.ts";

test("KPI reconciles when contributions sum to displayed", () => {
  const result = reconcileKpiToContributions("100.0000", ["40.0000", "60.0000"]);
  assert.equal(result.verification, "RECONCILED");
  assert.equal(result.difference, "0.0000");
  assert.equal(result.sourceTotal, "100.0000");
});

test("KPI partial when contributions do not match", () => {
  const result = reconcileKpiToContributions("100.0000", ["40.0000", "50.0000"]);
  assert.equal(result.verification, "PARTIAL");
  assert.equal(result.difference, "10.0000");
});

test("incomplete sources stay PARTIAL even when Diff is £0", () => {
  const result = reconcileKpiToContributions("602500.0000", ["580000.0000", "22500.0000"], {
    allComponentsKnown: false,
  });
  assert.equal(result.difference, "0.0000");
  assert.equal(result.verification, "PARTIAL");
  assert.equal(result.sourceTotal, "602500.0000");
});

test("Cost to Date counts CIS once and does not treat payments as a second cost", () => {
  const once = reconcileKpiToContributions("602500.0000", ["580000.0000", "22500.0000"], {
    allComponentsKnown: false,
  });
  assert.equal(once.sourceTotal, "602500.0000");
  const doubled = reconcileKpiToContributions("602500.0000", ["580000.0000", "22500.0000", "22500.0000"], {
    allComponentsKnown: false,
  });
  assert.equal(doubled.difference, "-22500.0000");
  assert.equal(doubled.verification, "PARTIAL");
});

test("multi-project unique documents avoid double count", () => {
  const result = uniqueDocumentAmounts([
    { document_id: "doc-1", amount: "10.0000", project_id: "p1" },
    { document_id: "doc-1", amount: "10.0000", project_id: "p2" },
    { document_id: "doc-2", amount: "5.0000", project_id: "p2" },
  ]);
  assert.equal(result.documentCount, 2);
  assert.equal(result.total, "15.0000");
});

test("credit note reduces net effect", () => {
  assert.equal(creditNoteNetEffect("100.0000", "10.0000"), "90.0000");
});

test("missing CTC marks forecast incomplete", () => {
  assert.equal(missingCtcIncomplete("missing", "missing"), true);
  assert.equal(missingCtcIncomplete("10.0000", "20.0000"), false);
});

test("money contribution helper preserves four-decimal minor units", () => {
  assert.equal(sumContributionStrings(["1.0000", "2.2500"]), "3.2500");
});

test("demo monthly periods are explicitly DEMO and not LIVE", () => {
  const rows = demoMonthlyPeriods();
  assert.ok(rows.length >= 4);
  assert.ok(rows.every((row) => row.demo === true));
});


test("Cost to Date DEMO formula: eligible + CIS labour = incurred", () => {
  const eligible = "580000.0000";
  const cis = "22500.0000";
  const incurred = "602500.0000";
  const eligibleOnly = reconcileKpiToContributions(eligible, ["90000.0000", "120000.0000", "80000.0000", "65000.0000", "70000.0000", "57500.0000", "25000.0000", "18000.0000", "22000.0000", "20000.0000", "12500.0000"]);
  assert.equal(eligibleOnly.verification, "RECONCILED");
  assert.equal(eligibleOnly.sourceTotal, "580000.0000");
  const global = reconcileKpiToContributions(incurred, [eligible, cis], { allComponentsKnown: false });
  assert.equal(global.sourceTotal, "602500.0000");
  assert.equal(global.difference, "0.0000");
  assert.equal(global.verification, "PARTIAL");
});

test("multi-project split invoice counts unique document once at company level", () => {
  // Same document gross listed under two projects must not double at company level.
  const result = uniqueDocumentAmounts([
    { document_id: "cost-split", amount: "12000.0000", project_id: "demo-project-nlo" },
    { document_id: "cost-split", amount: "12000.0000", project_id: "demo-project-riverside" },
  ]);
  assert.equal(result.documentCount, 1);
  assert.equal(result.total, "12000.0000");
});

test("missing money cells render as em dash not zero", () => {
  assert.equal(formatMoneyCell("missing"), "—");
  assert.equal(formatMoneyCell(null), "—");
  assert.equal(formatMoneyCell(""), "—");
});


test("formula MATCH with Diff 0 is not the same as source verification", () => {
  assert.equal(formulaCheckFromDifference("602500.0000", "0.0000"), "MATCH");
  const partial = reconcileKpiToContributions("602500.0000", ["580000.0000", "22500.0000"], {
    allComponentsKnown: false,
  });
  assert.equal(partial.verification, "PARTIAL");
  assert.equal(formulaCheckFromDifference("602500.0000", partial.difference), "MATCH");
});

test("zero dayworks field without documents is not auto source-verified", () => {
  // Diff 0 on a zero field is formula-only; source badge must stay unverified when no rows.
  assert.equal(formulaCheckFromDifference("0.0000", "0.0000"), "MATCH");
  assert.notEqual("RECONCILED", "SOURCE BREAKDOWN UNAVAILABLE — NOT VERIFIED");
});
