/**
 * Presentation-layer reconciliation helpers for Finance Data Grid / source drawer.
 */

import { addMoney, formatGbp, subtractMoney, toMinor, type MoneyValue } from "./presentation.ts";

const SCALE = 10000n;

function minorToDecimalString(minor: bigint): string {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export type VerificationBadge =
  | "RECONCILED"
  | "PARTIAL"
  | "UNVERIFIED"
  | "SOURCE BREAKDOWN UNAVAILABLE — NOT VERIFIED";

export type SourceBreakdownRow = {
  id: string;
  reference: string;
  source_type: string;
  document_date?: string | null;
  status?: string | null;
  cost_code?: string | null;
  amount: string;
  net?: string | null;
  vat_non_recoverable?: string | null;
  gross_document?: string | null;
  document_id?: string | null;
};

export type SourceBreakdownGroup = {
  id: string;
  label: string;
  total: string;
  verification?: VerificationBadge | string;
  note?: string;
  rows: SourceBreakdownRow[];
};

export type FormulaCheck = "MATCH" | "MISMATCH" | "INCOMPLETE";

export type SourceBreakdownPayload = {
  metric: string;
  company_id: string;
  project_id: string;
  displayed_total: string;
  formula: string;
  basis: string;
  reconcilable: boolean;
  verification: VerificationBadge | string;
  /** Mathematical components vs displayed total. Diff 0 is MATCH, not source proof. */
  formula_check?: FormulaCheck | string;
  /** Document / register verification for components. */
  source_verification?: VerificationBadge | string;
  difference: string;
  source_total?: string;
  verified_subtotal?: string | null;
  unverified_subtotal?: string | null;
  components_incomplete?: boolean;
  groups: SourceBreakdownGroup[];
  warnings: string[];
};

export function sumContributionStrings(amounts: MoneyValue[]): string {
  return minorToDecimalString(addMoney(amounts));
}

export function differenceStrings(displayed: MoneyValue, sourceTotal: MoneyValue): string | null {
  const diff = subtractMoney(displayed, sourceTotal);
  return diff === null ? null : minorToDecimalString(diff);
}

export function reconcileKpiToContributions(
  displayed: MoneyValue,
  contributions: MoneyValue[],
  options?: { allComponentsKnown?: boolean },
): { sourceTotal: string; difference: string; verification: VerificationBadge } {
  const sourceTotal = sumContributionStrings(contributions);
  const allComponentsKnown = options?.allComponentsKnown !== false;
  if (
    displayed === "missing" ||
    displayed === null ||
    displayed === undefined ||
    String(displayed).trim() === ""
  ) {
    return { sourceTotal, difference: "0.0000", verification: "PARTIAL" };
  }
  if (toMinor(displayed) === null) {
    return { sourceTotal, difference: "0.0000", verification: "PARTIAL" };
  }
  const diff = subtractMoney(displayed, sourceTotal);
  if (diff === null) {
    return { sourceTotal, difference: "0.0000", verification: "PARTIAL" };
  }
  if (!allComponentsKnown) {
    return {
      sourceTotal,
      difference: minorToDecimalString(diff),
      verification: "PARTIAL",
    };
  }
  if (diff === 0n) {
    return { sourceTotal, difference: "0.0000", verification: "RECONCILED" };
  }
  return { sourceTotal, difference: minorToDecimalString(diff), verification: "PARTIAL" };
}

export function uniqueDocumentAmounts(
  rows: Array<{ document_id?: string | null; amount: MoneyValue; project_id?: string | null }>,
): { total: string; documentCount: number } {
  const seen = new Set<string>();
  const amounts: MoneyValue[] = [];
  for (const row of rows) {
    const key = String(row.document_id || "").trim();
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    amounts.push(row.amount);
  }
  return { total: sumContributionStrings(amounts), documentCount: amounts.length };
}

export function creditNoteNetEffect(invoiceGross: MoneyValue, creditGross: MoneyValue): string | null {
  return differenceStrings(invoiceGross, creditGross);
}

export function missingCtcIncomplete(costToComplete: MoneyValue, forecastFinal: MoneyValue): boolean {
  const ctcMissing =
    costToComplete === "missing" ||
    costToComplete === null ||
    costToComplete === undefined ||
    String(costToComplete).trim() === "";
  const finalMissing =
    forecastFinal === "missing" ||
    forecastFinal === null ||
    forecastFinal === undefined ||
    String(forecastFinal).trim() === "";
  return ctcMissing || finalMissing;
}

/** Missing values render as an em dash — never as £0. */
export function formatMoneyCell(value: MoneyValue): string {
  if (value === "missing" || value === null || value === undefined || String(value).trim() === "") {
    return "—";
  }
  return formatGbp(value);
}


export function formulaCheckFromDifference(displayed: MoneyValue, difference: string): FormulaCheck {
  if (
    displayed === "missing" ||
    displayed === null ||
    displayed === undefined ||
    String(displayed).trim() === ""
  ) {
    return "INCOMPLETE";
  }
  if (difference === "0.0000" || difference === "0" || difference === "+0.0000" || difference === "-0.0000") {
    return "MATCH";
  }
  return "MISMATCH";
}

export function verificationTone(verification: string): "green" | "amber" | "red" | "neutral" {
  if (verification === "RECONCILED") return "green";
  if (verification.includes("UNAVAILABLE")) return "red";
  if (verification === "UNVERIFIED" || verification === "PARTIAL") return "neutral";
  return "amber";
}

export function demoMonthlyPeriods(): Array<{
  period: string;
  contract: string;
  incurred: string;
  commitments: string;
  forecastFinal: string;
  profit: string;
  demo: true;
}> {
  return [
    { period: "2026-01", contract: "1200000.0000", incurred: "80000.0000", commitments: "40000.0000", forecastFinal: "1100000.0000", profit: "100000.0000", demo: true },
    { period: "2026-02", contract: "1220000.0000", incurred: "160000.0000", commitments: "90000.0000", forecastFinal: "1085000.0000", profit: "135000.0000", demo: true },
    { period: "2026-03", contract: "1250000.0000", incurred: "320000.0000", commitments: "140000.0000", forecastFinal: "1050000.0000", profit: "200000.0000", demo: true },
    { period: "2026-04", contract: "1250000.0000", incurred: "602500.0000", commitments: "165000.0000", forecastFinal: "1157500.0000", profit: "92500.0000", demo: true },
  ];
}
