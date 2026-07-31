/**
 * Bridge between `<input type="datetime-local">` values and the API's ISO 8601
 * timestamps.
 *
 * A `datetime-local` value is a wall-clock time with no offset, so it is read and
 * written in the browser's timezone. Conversion to UTC happens exactly once here,
 * via `toISOString()`, which is the convention the admin time-record endpoints
 * already expect.
 */

const pad = (value: number) => String(value).padStart(2, "0");

/** Format an ISO timestamp as a browser-local `YYYY-MM-DDTHH:mm` value. */
export function toDatetimeLocalValue(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return (
    `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}` +
    `T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
  );
}

/** Convert a browser-local `datetime-local` value to a UTC ISO timestamp. */
export function fromDatetimeLocalToIso(localValue: string): string {
  const trimmed = localValue.trim();
  if (!trimmed) {
    return "";
  }
  // Some engines are pickier about minute-only values; append seconds once.
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}:00` : trimmed;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString();
}

/** Current browser-local wall-clock time, rounded down to the minute. */
export function nowDatetimeLocalValue(): string {
  return toDatetimeLocalValue(new Date().toISOString());
}

export function isValidDatetimeLocalValue(localValue: string): boolean {
  return localValue.trim().length > 0 && fromDatetimeLocalToIso(localValue) !== "";
}

/** Today's calendar date in the browser timezone as `YYYY-MM-DD` (not UTC). */
export function todayLocalDateString(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** True when `value` is a plausible `YYYY-MM-DD` calendar date. */
export function isValidLocalDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return false;
  }
  const [y, m, d] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!y || !m || !d) {
    return false;
  }
  const parsed = new Date(y, m - 1, d);
  return (
    parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d
  );
}
