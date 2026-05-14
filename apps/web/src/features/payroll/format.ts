import { formatPayrollWeekUkLabel } from "../../lib/week-label";

export function formatHoursFromSeconds(seconds: number): string {
  return (seconds / 3600).toFixed(2);
}
export function formatMoney(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  const n = Number(value);
  if (Number.isNaN(n)) {
    return value;
  }
  return n.toFixed(2);
}

export function formatMoneyGBP(value: string | null | undefined): string {
  const inner = formatMoney(value);
  if (inner === "—") {
    return "—";
  }
  return `£${inner}`;
}

/**
 * CIS amount shown in UI: server fields only; optional `paymentMode` so gross payment never
 * substitutes calculated tax when display CIS is zero.
 */
export function effectiveDisplayedTaxAmount(
  displayTax: string | null | undefined,
  calculatedTax: string | null | undefined,
  paymentMode?: string | null,
): string | null | undefined {
  const raw = (paymentMode ?? "").trim().toLowerCase();
  const isGross = raw === "gross_payment" || raw === "gross";
  if (isGross) {
    if (displayTax !== null && displayTax !== undefined && displayTax !== "") {
      return displayTax;
    }
    return "0";
  }
  if (displayTax === null || displayTax === undefined || displayTax === "") {
    return calculatedTax;
  }
  const d = Number(displayTax);
  const c = Number(calculatedTax);
  if (
    calculatedTax !== null &&
    calculatedTax !== undefined &&
    calculatedTax !== "" &&
    !Number.isNaN(d) &&
    !Number.isNaN(c) &&
    d === 0 &&
    c !== 0
  ) {
    return calculatedTax;
  }
  return displayTax;
}

/** Monday `weekStartIso` through Sunday, UK-style week label in `timeZone` (company payroll TZ). */
export function formatPayrollWeekRangeLabel(weekStartIso: string, timeZone: string): string {
  return formatPayrollWeekUkLabel(weekStartIso, timeZone, false);
}
