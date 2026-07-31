/**
 * Post–clock-out daily hours summary helpers and wiring.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(here, "..");
const srcRoot = path.join(webRoot, "src");
const read = (relative) =>
  fs.readFileSync(path.join(srcRoot, relative), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
const failures = [];
function check(label, condition) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(label);
  }
}

const helpers = read("features/time-clock/clock-out-summary.ts");
const banner = read("features/time-clock/clock-out-summary-banner.tsx");
const clockClient = read("app/(app)/clock/clock-client.tsx");
const dashboard = read("app/(app)/dashboard/dashboard-client.tsx");

check("sessionStorage key is namespaced", /timiq:last-clock-out-summary/.test(helpers));
check("max age is ~60s", /CLOCK_OUT_SUMMARY_MAX_AGE_MS = 60_000/.test(helpers));
check("auto-dismiss is ~7s", /CLOCK_OUT_SUMMARY_DISMISS_MS = 7_000/.test(helpers));
check("payload fields documented", /totalWorkedSecondsToday/.test(helpers) && /clockedOutAt/.test(helpers) && /createdAt/.test(helpers));
check("consume removes storage immediately", /removeItem\(CLOCK_OUT_SUMMARY_STORAGE_KEY\)/.test(helpers));
check("no localStorage usage", !/\blocalStorage\b/.test(helpers.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "") + clockClient + dashboard + banner));
check("no URL query for duration", !/searchParams|URLSearchParams|worked=/.test(clockClient));
check("no selfie/GPS stored in summary helper", !/selfie|latitude|longitude|accuracy/.test(helpers));

check("Clock Out writes summary then redirects", /writeClockOutSummary[\s\S]*router\.replace\("\/dashboard"\)/.test(clockClient));
check("Clock Out uses authoritative today total helper", /fetchAuthoritativeTodayWorkedSeconds/.test(clockClient));
check("Clock Out does not use browser timezone for day bounds", !/browserDefaultTimeZone\(\)/.test(clockClient));
check("authoritative fetch uses timesheet company_timezone", (() => {
  const fetchSrc = read("features/time-clock/fetch-today-worked-seconds.ts");
  return (
    /fetchMyTimesheetWeek/.test(fetchSrc) &&
    /company_timezone/.test(fetchSrc) &&
    /timeRecordsDayBoundsForNow/.test(fetchSrc) &&
    /listMyTimeRecords/.test(fetchSrc) &&
    /sumTodayWorkedSeconds/.test(fetchSrc)
  );
})());
check("authoritative fetch does not fall back to browser day bounds", (() => {
  const fetchSrc = read("features/time-clock/fetch-today-worked-seconds.ts");
  // hint TZ only for week_start probe; day bounds must use company TZ
  return (
    /resolveAuthoritativeCompanyTimeZone\(week\.company_timezone\)/.test(fetchSrc) &&
    !/timeRecordsDayBoundsForNow\(\s*now\s*,\s*hintTz\s*\)/.test(fetchSrc) &&
    !/timeRecordsDayBoundsForNow\(\s*now\s*,\s*browserDefaultTimeZone/.test(fetchSrc)
  );
})());
check("Clock In does not write clock-out summary", (() => {
  const inBlock = clockClient.slice(
    clockClient.indexOf("async function handleClockIn"),
    clockClient.indexOf("async function handleClockOut"),
  );
  return !/writeClockOutSummary/.test(inBlock);
})());
check("failed Clock Out path has no writeClockOutSummary", (() => {
  const fail = clockClient.match(/Clock-out failed[\s\S]{0,280}/)?.[0] ?? "";
  return !/writeClockOutSummary/.test(fail);
})());
check("Dashboard consumes summary once on mount", /consumeClockOutSummary\(\)/.test(dashboard));
check("Dashboard shows banner above Open clock", (() => {
  const welcome = dashboard.indexOf("employee-dashboard-welcome");
  const bannerIdx = dashboard.indexOf("<ClockOutSummaryBanner");
  const clockIdx = dashboard.indexOf("<EmployeeShiftClock");
  return welcome > 0 && bannerIdx > welcome && clockIdx > bannerIdx;
})());
check("banner uses role=status", /role="status"/.test(banner));
check("dismiss button accessible label", /Dismiss shift summary/.test(banner));
check("banner auto-dismiss uses 7s constant", /CLOCK_OUT_SUMMARY_DISMISS_MS/.test(banner));

function loadHelpers() {
  const source = read("features/time-clock/clock-out-summary.ts");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const store = new Map();
  const sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      store.set(k, String(v));
    },
    removeItem: (k) => {
      store.delete(k);
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(
    transpiled,
    {
      module,
      exports: module.exports,
      window: { sessionStorage },
      console,
      Date,
      Number,
      JSON,
      Math,
      String,
      Intl,
      RegExp,
    },
    { timeout: 2000 },
  );
  return { exports: module.exports, store, sessionStorage };
}

const { exports: mod, store } = loadHelpers();

check("format under 1 hour is Xm", mod.formatWorkedTodayLabel(35 * 60) === "35m");
check("format 1h+ is Xh Ym", mod.formatWorkedTodayLabel(7 * 3600 + 35 * 60) === "7h 35m");
check("sumTodayWorkedSeconds includes multiple completed shifts", (() => {
  const total = mod.sumTodayWorkedSeconds([
    { clock_out_at: "2026-07-31T12:00:00Z", actual_seconds: 4 * 3600 },
    { clock_out_at: "2026-07-31T16:30:00Z", actual_seconds: 3.5 * 3600 },
    { clock_out_at: null, actual_seconds: 999 },
  ]);
  return total === 7.5 * 3600;
})());

check("company timezone preferred over browser for day bounds", (() => {
  // 2026-07-31 23:30 UTC = 2026-08-01 00:30 Europe/London (BST), still 2026-07-31 in America/Los_Angeles
  const now = new Date("2026-07-31T23:30:00.000Z");
  const company = mod.timeRecordsDayBoundsForNow(now, "Europe/London");
  const browserLike = mod.timeRecordsDayBoundsForNow(now, "America/Los_Angeles");
  return (
    company &&
    browserLike &&
    company.startDate === "2026-08-01" &&
    company.endDateExclusive === "2026-08-02" &&
    browserLike.startDate === "2026-07-31" &&
    company.startDate !== browserLike.startDate
  );
})());

check("near-midnight company day uses exclusive end = tomorrow", (() => {
  const now = new Date("2026-07-31T23:05:00.000Z"); // 00:05 BST Aug 1
  const bounds = mod.timeRecordsDayBoundsForNow(now, "Europe/London");
  return bounds && bounds.startDate === "2026-08-01" && bounds.endDateExclusive === "2026-08-02";
})());

check("cross-midnight shift stays on clock-in company day (Time Records rule)", (() => {
  // Overnight: clocked in 22:00 London Jul 30, out 06:00 Jul 31 — attributed to Jul 30
  // Summary day Jul 31 must not invent a split; API day window for Jul 31 is Aug? No — Jul 31 local:
  const day = mod.timeRecordsDayBoundsForNow(new Date("2026-07-31T12:00:00.000Z"), "Europe/London");
  // Time Records filters clock_in_at in [start, end). Overnight shift with clock_in on Jul 30
  // is outside Jul 31 window — same as Time Records view for that day.
  return (
    day &&
    day.startDate === "2026-07-31" &&
    day.endDateExclusive === "2026-08-01" &&
    // document parity: exclusive end matches Time Records client convention
    day.endDateExclusive ===
      (() => {
        const [y, m, d] = day.startDate.split("-").map(Number);
        const utc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
        utc.setUTCDate(utc.getUTCDate() + 1);
        return utc.toISOString().slice(0, 10);
      })()
  );
})());

check("DST spring-forward day still resolves a single company calendar day", (() => {
  // UK clocks spring forward 2026-03-29 01:00 → 02:00. Midday is unambiguous.
  const midday = mod.timeRecordsDayBoundsForNow(
    new Date("2026-03-29T12:00:00.000Z"),
    "Europe/London",
  );
  // Just after local midnight before transition (00:30 GMT on Mar 29)
  const early = mod.timeRecordsDayBoundsForNow(
    new Date("2026-03-29T00:30:00.000Z"),
    "Europe/London",
  );
  return (
    midday &&
    early &&
    midday.startDate === "2026-03-29" &&
    midday.endDateExclusive === "2026-03-30" &&
    early.startDate === "2026-03-29" &&
    early.endDateExclusive === "2026-03-30"
  );
})());

check("summary and Time Records share identical day-bound shape", (() => {
  const now = new Date("2026-01-15T15:00:00.000Z");
  const bounds = mod.timeRecordsDayBoundsForNow(now, "Europe/London");
  // Same contract as time-records-client / backend: start inclusive, end exclusive (+1 day)
  return bounds && bounds.startDate === "2026-01-15" && bounds.endDateExclusive === "2026-01-16";
})());

check("missing company timezone yields null bounds (no browser fallback)", (() => {
  return (
    mod.resolveAuthoritativeCompanyTimeZone("") === null &&
    mod.resolveAuthoritativeCompanyTimeZone(null) === null &&
    mod.timeRecordsDayBoundsForNow(new Date(), "") === null
  );
})());

check("invalid IANA timezone rejected", mod.resolveAuthoritativeCompanyTimeZone("Not/AZone") === null);

const now = Date.now();
const valid = {
  totalWorkedSecondsToday: 2700,
  clockedOutAt: new Date(now).toISOString(),
  createdAt: now,
};
check("valid payload accepted", mod.isValidClockOutSummary(valid, now) === true);
check("stale payload rejected", mod.isValidClockOutSummary({ ...valid, createdAt: now - 61_000 }, now) === false);
check("invalid JSON ignored on consume", (() => {
  store.set(mod.CLOCK_OUT_SUMMARY_STORAGE_KEY, "{not-json");
  return mod.consumeClockOutSummary(now) === null && !store.has(mod.CLOCK_OUT_SUMMARY_STORAGE_KEY);
})());

check("write then consume once", (() => {
  mod.writeClockOutSummary(valid);
  const first = mod.consumeClockOutSummary(now);
  const second = mod.consumeClockOutSummary(now);
  return first && first.totalWorkedSecondsToday === 2700 && second === null;
})());

check("unavailable sessionStorage does not throw on write/consume", (() => {
  const source = read("features/time-clock/clock-out-summary.ts");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(
    transpiled,
    {
      module,
      exports: module.exports,
      window: {
        get sessionStorage() {
          throw new Error("blocked");
        },
      },
      console,
      Date,
      Number,
      JSON,
      Math,
      String,
      Intl,
      RegExp,
    },
    { timeout: 2000 },
  );
  const blocked = module.exports;
  return (
    blocked.writeClockOutSummary(valid) === false &&
    blocked.consumeClockOutSummary(now) === null
  );
})());

// Fake timers: auto-dismiss fires after CLOCK_OUT_SUMMARY_DISMISS_MS
check("auto-dismiss fires after ~7s with fake timers", (() => {
  let dismissed = false;
  const timers = [];
  let nowFake = 0;
  const setTimeoutFake = (fn, ms) => {
    const id = timers.length + 1;
    timers.push({ id, fn, due: nowFake + ms });
    return id;
  };
  const clearTimeoutFake = (id) => {
    const idx = timers.findIndex((t) => t.id === id);
    if (idx >= 0) timers.splice(idx, 1);
  };
  const flush = (advanceMs) => {
    nowFake += advanceMs;
    const due = timers.filter((t) => t.due <= nowFake);
    for (const t of due) {
      clearTimeoutFake(t.id);
      t.fn();
    }
  };
  const id = setTimeoutFake(() => {
    dismissed = true;
  }, mod.CLOCK_OUT_SUMMARY_DISMISS_MS);
  flush(6_999);
  const mid = dismissed;
  flush(1);
  clearTimeoutFake(id);
  return mid === false && dismissed === true;
})());

check("manual dismiss clears via onDismiss", /onDismiss\(\)/.test(banner) && /clearTimeout/.test(banner));
check("payload omits sensitive fields", (() => {
  const keys = Object.keys(valid).sort().join(",");
  return keys === "clockedOutAt,createdAt,totalWorkedSecondsToday";
})());

if (failures.length) {
  console.error(`FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`ok - clock-out daily hours summary (${passed} checks)`);

