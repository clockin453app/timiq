import { addDaysIsoYmd } from "../features/timesheets/week-utils";

/** Calendar Y-M-D of `weekStartIso` as it falls in `timeZone` (noon UTC anchor). */
function calendarDayInTimeZone(weekStartIso: string, timeZone: string): { y: number; m: number; d: number } {
  const [y, mo, d] = weekStartIso.split("-").map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(probe);
  const [yy, mm, dd] = s.split("-").map(Number);
  return { y: yy, m: mm, d: dd };
}

/** ISO 8601 week number for a calendar date (UTC noon representation of y-m-d). */
export function getIsoWeekNumberForCalendarDate(y: number, m: number, d: number): number {
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function getUkWeekNumber(weekStartIso: string, timeZone: string): number {
  const { y, m, d } = calendarDayInTimeZone(weekStartIso, timeZone);
  return getIsoWeekNumberForCalendarDate(y, m, d);
}

function formatRangeParts(
  weekStartIso: string,
  weekEndIso: string,
  timeZone: string,
  compact: boolean,
): { start: string; end: string } {
  const [y, m, d] = weekStartIso.split("-").map(Number);
  const [ey, em, ed] = weekEndIso.split("-").map(Number);
  const startProbe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const endProbe = new Date(Date.UTC(ey, em - 1, ed, 12, 0, 0));
  if (compact) {
    const df = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    return { start: df.format(startProbe), end: df.format(endProbe) };
  }
  const df = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return { start: df.format(startProbe), end: df.format(endProbe) };
}

/**
 * UK-style payroll week label, e.g. "Week 20 · 11 May 2026 – 17 May 2026".
 * `weekStartIso` is the inclusive payroll week start (YYYY-MM-DD); week end is +6 days in the same calendar sense.
 */
export function formatPayrollWeekUkLabel(weekStartIso: string, timeZone: string, compact = false): string {
  const endIso = addDaysIsoYmd(weekStartIso, 6);
  const wn = getUkWeekNumber(weekStartIso, timeZone);
  const { start, end } = formatRangeParts(weekStartIso, endIso, timeZone, compact);
  return `Week ${wn} · ${start} – ${end}`;
}
