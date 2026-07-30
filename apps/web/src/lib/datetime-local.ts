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
  const parsed = new Date(localValue);
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
