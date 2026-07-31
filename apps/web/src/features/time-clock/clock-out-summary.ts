/**
 * One-time post–clock-out Dashboard summary helpers.
 * Payload is short-lived sessionStorage only (never localStorage / URL).
 *
 * Day bounds must match Time Records / payroll: company time-policy timezone
 * (CompanyTimePolicy.timezone_name), exposed to employees as timesheet
 * `company_timezone`. Never invent a browser-local day boundary for the total.
 */

export const CLOCK_OUT_SUMMARY_STORAGE_KEY = "timiq:last-clock-out-summary";
export const CLOCK_OUT_SUMMARY_MAX_AGE_MS = 60_000;
export const CLOCK_OUT_SUMMARY_DISMISS_MS = 7_000;

export type ClockOutSummary = {
  totalWorkedSecondsToday: number;
  clockedOutAt: string;
  createdAt: number;
};

export type TimeRecordsDayBounds = {
  /** Inclusive company-local calendar day (YYYY-MM-DD). */
  startDate: string;
  /** Exclusive end date for listMyTimeRecords (startDate + 1 day). */
  endDateExclusive: string;
  timeZone: string;
};

export function formatWorkedTodayLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) {
    return `${total}s`;
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h < 1) {
    return `${m}m`;
  }
  return `${h}h ${m}m`;
}

export function formatClockedOutAtLocal(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Accept only a usable IANA timezone from company time policy / timesheets.
 * Returns null when missing or invalid — callers must omit the summary rather
 * than fall back to the browser timezone.
 */
export function resolveAuthoritativeCompanyTimeZone(
  companyTimezone: string | null | undefined,
): string | null {
  if (typeof companyTimezone !== "string") {
    return null;
  }
  const trimmed = companyTimezone.trim();
  if (!trimmed) {
    return null;
  }
  try {
    Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    return null;
  }
}

function formatYmdInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDaysIsoYmd(isoYmd: string, days: number): string {
  const [y, m, d] = isoYmd.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/**
 * Same day window Time Records uses for an explicit single day:
 * start_date = company-local today, end_date = tomorrow (exclusive).
 * Backend interprets those YMD strings in CompanyTimePolicy.timezone_name.
 */
export function timeRecordsDayBoundsForNow(
  now: Date,
  companyTimeZone: string,
): TimeRecordsDayBounds | null {
  const timeZone = resolveAuthoritativeCompanyTimeZone(companyTimeZone);
  if (!timeZone) {
    return null;
  }
  const startDate = formatYmdInTimeZone(now, timeZone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return null;
  }
  return {
    startDate,
    endDateExclusive: addDaysIsoYmd(startDate, 1),
    timeZone,
  };
}

/** Sum authoritative shift durations for completed rows (actual_seconds preferred). */
export function sumTodayWorkedSeconds(
  rows: Array<{
    clock_out_at?: string | null;
    actual_seconds?: number | null;
    counted_seconds?: number | null;
  }>,
): number {
  let total = 0;
  for (const row of rows) {
    if (!row.clock_out_at) {
      continue;
    }
    const value =
      typeof row.actual_seconds === "number" && Number.isFinite(row.actual_seconds)
        ? row.actual_seconds
        : typeof row.counted_seconds === "number" && Number.isFinite(row.counted_seconds)
          ? row.counted_seconds
          : null;
    if (value !== null && value >= 0) {
      total += value;
    }
  }
  return total;
}

export function isValidClockOutSummary(
  value: unknown,
  nowMs: number = Date.now(),
): value is ClockOutSummary {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.totalWorkedSecondsToday !== "number" || !Number.isFinite(record.totalWorkedSecondsToday)) {
    return false;
  }
  if (record.totalWorkedSecondsToday < 0) {
    return false;
  }
  if (typeof record.clockedOutAt !== "string" || !record.clockedOutAt.trim()) {
    return false;
  }
  if (Number.isNaN(Date.parse(record.clockedOutAt))) {
    return false;
  }
  if (typeof record.createdAt !== "number" || !Number.isFinite(record.createdAt)) {
    return false;
  }
  if (nowMs - record.createdAt > CLOCK_OUT_SUMMARY_MAX_AGE_MS || record.createdAt > nowMs + 5_000) {
    return false;
  }
  return true;
}

function getSessionStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) {
      return null;
    }
    const probe = "__timiq_ss_probe__";
    window.sessionStorage.setItem(probe, "1");
    window.sessionStorage.removeItem(probe);
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function writeClockOutSummary(summary: ClockOutSummary): boolean {
  const storage = getSessionStorage();
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(CLOCK_OUT_SUMMARY_STORAGE_KEY, JSON.stringify(summary));
    return true;
  } catch {
    return false;
  }
}

/** Read and immediately remove the one-time payload. */
export function consumeClockOutSummary(nowMs: number = Date.now()): ClockOutSummary | null {
  const storage = getSessionStorage();
  if (!storage) {
    return null;
  }
  let raw: string | null = null;
  try {
    raw = storage.getItem(CLOCK_OUT_SUMMARY_STORAGE_KEY);
    storage.removeItem(CLOCK_OUT_SUMMARY_STORAGE_KEY);
  } catch {
    try {
      storage.removeItem(CLOCK_OUT_SUMMARY_STORAGE_KEY);
    } catch {
      // ignore
    }
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValidClockOutSummary(parsed, nowMs)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearClockOutSummary(): void {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(CLOCK_OUT_SUMMARY_STORAGE_KEY);
  } catch {
    // ignore
  }
}
