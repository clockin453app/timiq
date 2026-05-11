import { addDaysIsoYmd } from "../timesheets/week-utils";

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

/** Prefer stored display CIS when set; if display is 0 but calculated tax is non-zero, use calculated (stale display-zero rows). */
export function effectiveDisplayedTaxAmount(
  displayTax: string | null | undefined,
  calculatedTax: string | null | undefined,
): string | null | undefined {
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

/** Monday `weekStartIso` through Sunday, formatted in `timeZone` (company payroll TZ). */
export function formatPayrollWeekRangeLabel(weekStartIso: string, timeZone: string): string {
  const [y, m, d] = weekStartIso.split("-").map(Number);
  const startProbe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const endIso = addDaysIsoYmd(weekStartIso, 6);
  const [ey, em, ed] = endIso.split("-").map(Number);
  const endProbe = new Date(Date.UTC(ey, em - 1, ed, 12, 0, 0));
  const df = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${df.format(startProbe)} – ${df.format(endProbe)}`;
}
