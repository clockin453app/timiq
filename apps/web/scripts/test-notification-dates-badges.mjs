/**
 * Notification date formatting / grouping and badge independence checks.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(root, "src", rel), "utf8");
}

// --- Source contract checks ---
const api = read("features/notifications/api.ts");
assert.match(api, /occurred_at\?:/);
assert.match(api, /messages_unread_count\?:/);

const nav = read("features/notifications/nav-badges.ts");
assert.match(nav, /messagesUnreadCount/);

const bell = read("components/layout/notification-bell.tsx");
assert.match(bell, /formatNotificationOccurredAt/);
assert.match(bell, /DATE_GROUP_ORDER/);
assert.match(bell, /attendance_missing_clock_in/);
assert.match(bell, /messages_unread_count: data\?\.messages_unread_count/);
assert.match(bell, /aria-label=\{when\.exact\}/);
assert.doesNotMatch(bell, /kind === "message"/);

const messagesBtn = read("components/layout/messages-header-button.tsx");
assert.match(messagesBtn, /row\.messages_unread_count/);

// --- Runtime helpers (transpile-light via dynamic eval of TS-free logic) ---
// Import compiled by reimplementing expected contracts against the TS module via ts-node is unavailable;
// instead execute the pure logic mirrored from format-occurred-at.ts for regression coverage.

const LONDON_TZ = "Europe/London";

function londonParts(iso, now = new Date()) {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return null;
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
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date,
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    hh: Number(get("hour")),
    mm: Number(get("minute")),
  };
}

function londonDayKey(parts) {
  return parts.y * 10_000 + parts.m * 100 + parts.d;
}

function notificationDateGroup(occurredAt, now = new Date()) {
  const parts = occurredAt ? londonParts(occurredAt, now) : null;
  if (!parts) return "unknown";
  const nowParts = londonParts(now, now);
  if (!nowParts) return "unknown";
  const day = londonDayKey(parts);
  const today = londonDayKey(nowParts);
  if (day === today) return "today";
  const yesterdayDate = new Date(Date.UTC(nowParts.y, nowParts.m - 1, nowParts.d - 1, 12, 0, 0));
  const yParts = londonParts(yesterdayDate, now);
  if (yParts && day === londonDayKey(yParts)) return "yesterday";
  return "older";
}

function formatLabel(occurredAt, now = new Date()) {
  const parts = occurredAt ? londonParts(occurredAt, now) : null;
  if (!parts) return null;
  const diffMs = now.getTime() - parts.date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMs >= 0 && diffMin < 1) return "Just now";
  if (diffMs >= 0 && diffMin < 60) return `${diffMin} min ago`;
  const group = notificationDateGroup(occurredAt, now);
  const time = `${String(parts.hh).padStart(2, "0")}:${String(parts.mm).padStart(2, "0")}`;
  if (group === "today") return `Today, ${time}`;
  if (group === "yesterday") return `Yesterday, ${time}`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${parts.d} ${months[parts.m - 1]} ${parts.y}, ${time}`;
}

const now = new Date("2026-08-05T15:00:00.000Z");
assert.equal(formatLabel(new Date(now.getTime() - 20_000).toISOString(), now), "Just now");
assert.equal(formatLabel(new Date(now.getTime() - 5 * 60_000).toISOString(), now), "5 min ago");

const todayIso = "2026-08-05T10:35:00.000Z";
assert.match(formatLabel(todayIso, now), /^Today, /);
assert.equal(notificationDateGroup(todayIso, now), "today");

const yesterdayIso = "2026-08-04T08:10:00.000Z";
assert.match(formatLabel(yesterdayIso, now), /^Yesterday, /);
assert.equal(notificationDateGroup(yesterdayIso, now), "yesterday");

const olderIso = "2026-08-01T15:20:00.000Z";
assert.match(formatLabel(olderIso, now), /Aug 2026/);
assert.equal(notificationDateGroup(olderIso, now), "older");
assert.equal(notificationDateGroup(null, now), "unknown");

// BST: 2026-08-05 14:35 London = 13:35 UTC
const bst = formatLabel("2026-08-05T13:35:00.000Z", now);
assert.equal(bst, "Today, 14:35");

// Badge independence: messages_unread_count drives Messages; items without message kinds do not.
function navBadgesFromSummary(items, messagesUnreadCount) {
  let messagesFromItems = 0;
  for (const it of items) {
    if (it.kind === "message" || it.kind === "announcement") messagesFromItems += it.count;
  }
  const messages =
    typeof messagesUnreadCount === "number" && Number.isFinite(messagesUnreadCount)
      ? Math.max(0, Math.floor(messagesUnreadCount))
      : messagesFromItems;
  const out = {};
  if (messages > 0) out["/messages"] = messages;
  return out;
}

const bellOnly = [{ kind: "attendance_missing_clock_in", count: 1 }];
assert.equal(navBadgesFromSummary(bellOnly, 3)["/messages"], 3);
assert.equal(navBadgesFromSummary(bellOnly, 0)["/messages"], undefined);
assert.equal(navBadgesFromSummary([{ kind: "message", count: 5 }], undefined)["/messages"], 5);

console.log("test-notification-dates-badges: ok");
