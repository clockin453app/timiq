/** Europe/London-relative notification timestamps for the bell hub. */

const LONDON_TZ = "Europe/London";

export type NotificationDateGroup = "today" | "yesterday" | "earlier_this_week" | "older" | "unknown";

function londonParts(iso: string | Date, now: Date = new Date()): {
  date: Date;
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
} | null {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date,
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    hh: Number(get("hour")),
    mm: Number(get("minute")),
  };
}

function londonDayKey(parts: { y: number; m: number; d: number }): number {
  return parts.y * 10_000 + parts.m * 100 + parts.d;
}

function startOfLondonWeekMonday(parts: { y: number; m: number; d: number }): number {
  const utcNoon = Date.UTC(parts.y, parts.m - 1, parts.d, 12, 0, 0);
  const dow = new Date(utcNoon).getUTCDay(); // 0 Sun .. 6 Sat
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(utcNoon);
  monday.setUTCDate(monday.getUTCDate() + mondayOffset);
  return monday.getUTCFullYear() * 10_000 + (monday.getUTCMonth() + 1) * 100 + monday.getUTCDate();
}

export function notificationDateGroup(
  occurredAt: string | null | undefined,
  now: Date = new Date(),
): NotificationDateGroup {
  const parts = occurredAt ? londonParts(occurredAt, now) : null;
  if (!parts) {
    return "unknown";
  }
  const nowParts = londonParts(now, now);
  if (!nowParts) {
    return "unknown";
  }
  const day = londonDayKey(parts);
  const today = londonDayKey(nowParts);
  if (day === today) {
    return "today";
  }
  const yesterdayDate = new Date(Date.UTC(nowParts.y, nowParts.m - 1, nowParts.d - 1, 12, 0, 0));
  const yParts = londonParts(yesterdayDate, now);
  if (yParts && day === londonDayKey(yParts)) {
    return "yesterday";
  }
  if (startOfLondonWeekMonday(parts) === startOfLondonWeekMonday(nowParts) && day < today) {
    return "earlier_this_week";
  }
  return "older";
}

export function formatNotificationOccurredAt(
  occurredAt: string | null | undefined,
  now: Date = new Date(),
): { label: string; exact: string } | null {
  const parts = occurredAt ? londonParts(occurredAt, now) : null;
  if (!parts) {
    return null;
  }
  const exact = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
    dateStyle: "full",
    timeStyle: "short",
  }).format(parts.date);

  const diffMs = now.getTime() - parts.date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMs >= 0 && diffMin < 1) {
    return { label: "Just now", exact };
  }
  if (diffMs >= 0 && diffMin < 60) {
    return { label: `${diffMin} min ago`, exact };
  }

  const group = notificationDateGroup(occurredAt, now);
  const time = `${String(parts.hh).padStart(2, "0")}:${String(parts.mm).padStart(2, "0")}`;
  if (group === "today") {
    return { label: `Today, ${time}`, exact };
  }
  if (group === "yesterday") {
    return { label: `Yesterday, ${time}`, exact };
  }
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return { label: `${parts.d} ${months[parts.m - 1]} ${parts.y}, ${time}`, exact };
}

export const DATE_GROUP_ORDER: NotificationDateGroup[] = [
  "today",
  "yesterday",
  "earlier_this_week",
  "older",
  "unknown",
];

export function dateGroupHeading(group: NotificationDateGroup): string {
  switch (group) {
    case "today":
      return "Today";
    case "yesterday":
      return "Yesterday";
    case "earlier_this_week":
      return "Earlier this week";
    case "older":
      return "Older";
    default:
      return "Undated";
  }
}
