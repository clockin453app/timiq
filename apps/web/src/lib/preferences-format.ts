/** Supported display preferences (aligned with backend Batch 43). */

export const supportedLocales = ["en-GB", "ro-RO", "pl-PL", "es-ES", "ru-RU"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

export const supportedDateFormats = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;
export type SupportedDateFormat = (typeof supportedDateFormats)[number];

export const supportedTimeFormats = ["12h", "24h"] as const;
export type SupportedTimeFormat = (typeof supportedTimeFormats)[number];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format a calendar date using TimIQ date_format tokens (not full locale parsing). */
export function formatDateByPreference(date: Date, dateFormat: string): string {
  const dd = pad2(date.getDate());
  const mm = pad2(date.getMonth() + 1);
  const yyyy = String(date.getFullYear());
  switch (dateFormat) {
    case "MM/DD/YYYY":
      return `${mm}/${dd}/${yyyy}`;
    case "YYYY-MM-DD":
      return `${yyyy}-${mm}-${dd}`;
    case "DD/MM/YYYY":
    default:
      return `${dd}/${mm}/${yyyy}`;
  }
}

/** Format clock time using 12h or 24h preference. */
export function formatTimeByPreference(date: Date, timeFormat: string, locale: string): string {
  if (timeFormat === "24h") {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** Format currency amounts for display (Settings preview only in this batch). */
export function formatMoneyByPreference(
  amount: number,
  currencyCode: string,
  locale: string,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}
