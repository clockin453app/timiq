const WEEKDAY_SHORT_MON_FIRST: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

export function weekdayMondayFirst(date: Date, timeZone: string): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
  const key = short.slice(0, 3);
  return WEEKDAY_SHORT_MON_FIRST[key] ?? 0;
}

export function formatYmdInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Monday calendar date (YYYY-MM-DD) for the week containing `reference`, interpreted in `timeZone`. */
export function mondayWeekStartIso(reference: Date, timeZone: string): string {
  let ms = reference.getTime();
  for (let i = 0; i < 8; i++) {
    const probe = new Date(ms);
    if (weekdayMondayFirst(probe, timeZone) === 0) {
      return formatYmdInTimeZone(probe, timeZone);
    }
    ms -= 24 * 60 * 60 * 1000;
  }
  return formatYmdInTimeZone(reference, timeZone);
}

export function addDaysIsoYmd(isoYmd: string, days: number): string {
  const [y, m, d] = isoYmd.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function browserDefaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  } catch {
    return "UTC";
  }
}
