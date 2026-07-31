/**
 * Employee Dashboard circular shift-clock coverage.
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
const readPublic = (relative) =>
  fs.readFileSync(path.join(webRoot, "public", relative), "utf8");

let passed = 0;
const failures = [];
function check(label, condition) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(label);
  }
}

const dashboard = read("app/(app)/dashboard/dashboard-client.tsx");
const shiftClock = read("features/time-clock/employee-shift-clock.tsx");
const duration = read("features/time-clock/shift-duration.ts");
const api = read("features/time-clock/api.ts");
const oldCardPath = path.join(srcRoot, "features/time-clock/employee-dashboard-clock-card.tsx");

check("old employee-dashboard-clock-card.tsx removed", !fs.existsSync(oldCardPath));
check("dashboard does not import old clock card", !/employee-dashboard-clock-card/.test(dashboard));
check("dashboard uses EmployeeShiftClock", /EmployeeShiftClock/.test(dashboard));
check("CLOCKED OUT badge not rendered", !/CLOCKED OUT|clocked_out_badge|StatusBadge/.test(shiftClock));
check("clocked-out copy present", /You are not currently clocked in/.test(shiftClock));
check("Open clock action text present", /"Open clock"/.test(shiftClock));
check("Clock In / Out card heading not rendered", !/t\("nav\.clock"/.test(shiftClock) && !/>Clock In \/ Out</.test(shiftClock));
check("circle links to /clock", /href = "\/clock"/.test(shiftClock) || /href="\/clock"/.test(dashboard));
check("dashboard passes href /clock", /href="\/clock"/.test(dashboard));
check("clocked-in status copy present", /Shift in progress/.test(shiftClock));
check("welcome line remains on dashboard", /Welcome back, \{\{name\}\}/.test(dashboard) || /dashboard\.welcome_back/.test(dashboard));
check("assigned locations remain visible", /Assigned active locations/.test(shiftClock));
check("supplied icons referenced", [
  "/icons/shift-clock/clock-outline.svg",
  "/icons/shift-clock/arrow-right.svg",
  "/icons/shift-clock/map-pin.svg",
  "/icons/shift-clock/calendar-clock.svg",
].every((p) => shiftClock.includes(p)));
check("icon files exist on disk", [
  "icons/shift-clock/clock-outline.svg",
  "icons/shift-clock/arrow-right.svg",
  "icons/shift-clock/map-pin.svg",
  "icons/shift-clock/calendar-clock.svg",
].every((p) => fs.existsSync(path.join(webRoot, "public", p))));
check("icon geometry preserved (clock-outline circle+path)", /<circle cx="12" cy="12" r="8"\/>/.test(readPublic("icons/shift-clock/clock-outline.svg")));
check("mobile diameter uses clamp(13.5rem, 64vw, 15.5rem)", /clamp\(13\.5rem,\s*64vw,\s*15\.5rem\)/.test(shiftClock));
check("bottom-nav safe padding on employee dashboard sheet", /layout-mobile-bottom-nav-height/.test(dashboard));
check("exactly one Link control for the circle", (shiftClock.match(/<Link\b/g) || []).length === 1);
check("no nested button inside Link", !/<Link[\s\S]*?<button[\s\S]*?<\/Link>/.test(shiftClock));
check("aria-live off on timer", /aria-live="off"/.test(shiftClock));
check("decorative icons aria-hidden", /aria-hidden/.test(shiftClock));
check("accessible names for both states", /Open Clock In \/ Out/.test(shiftClock) && /Shift in progress, open Clock In \/ Out/.test(shiftClock));
check("no emoji in shift clock", !/[\u{1F300}-\u{1FAFF}]/u.test(shiftClock));
check("no Lucide import", !/lucide-react/.test(shiftClock));
check("no rectangular Open clock button class on primary CTA", !/min-h-\[3rem\].*Open clock|w-full min-h-\[3rem\]/.test(shiftClock));
check("rounded-full circular control", /rounded-full/.test(shiftClock));
check("interval cleanup in live duration hook", /clearInterval/.test(duration) && /setInterval\(tick, 1000\)/.test(duration));
check("elapsed recomputed from clockInIso each tick", /computeLabels\(clockInIso\)/.test(duration) && /Date\.now\(\) - started/.test(duration));
check("formatElapsedHms exported", /export function formatElapsedHms/.test(duration));
check("no per-second API polling in shift clock", !/getClockStatus|fetch\(|setInterval/.test(shiftClock));
const employeeDashboardBlock =
  dashboard.slice(dashboard.indexOf("function EmployeeDashboard"), dashboard.indexOf("function ManagementDashboard"));

check(
  "employee dashboard loads clock status without per-second polling",
  /getClockStatus\(\)/.test(employeeDashboardBlock) && !/setInterval\(/.test(employeeDashboardBlock),
);

check("active state has decorative radial tick layer", /ActiveShiftTickRing|shift-clock-tick-ring/.test(shiftClock));
check("tick layer is aria-hidden", /data-testid="shift-clock-tick-ring"[\s\S]*aria-hidden="true"|aria-hidden="true"[\s\S]*data-testid="shift-clock-tick-ring"/.test(shiftClock));
check("quarter-hour ticks use stronger green styling", /isQuarter[\s\S]*RING_IN|#16A34A/.test(shiftClock) && /data-tick=\{isQuarter \? "quarter"/.test(shiftClock));
check("60 programmatic ticks", /TICK_COUNT = 60/.test(shiftClock));
check("ticks only for active/clocked-in state", /showActiveTicks = isClockedIn && !clockLoading/.test(shiftClock));
check("blue clocked-out state does not mount tick ring when inactive", /showActiveTicks \? <ActiveShiftTickRing/.test(shiftClock));
check("status dot with Shift in progress", /rounded-full[\s\S]*Shift in progress|Shift in progress[\s\S]*rounded-full/.test(shiftClock) || /inline-block h-2 w-2[\s\S]*shift_in_progress/.test(shiftClock));
check("timer remains dominant tabular mono", /employee-shift-clock-timer[\s\S]*tabular-nums|tabular-nums[\s\S]*employee-shift-clock-timer/.test(shiftClock));
check("clock status fetch uses no-store for freshness", /getClockStatus[\s\S]*cache:\s*"no-store"/.test(api));

function loadDurationModule() {
  const source = read("features/time-clock/shift-duration.ts");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText;
  const module = { exports: {} };
  const react = {
    useState: (init) => [typeof init === "function" ? init() : init, () => {}],
    useLayoutEffect: () => undefined,
  };
  vm.runInNewContext(transpiled, {
    module,
    exports: module.exports,
    require: (id) => {
      if (id === "react") return react;
      return require(id);
    },
    console,
  });
  return module.exports;
}

const durationMod = loadDurationModule();
check("formatElapsedHms formats zero-padded HH:MM:SS", durationMod.formatElapsedHms(3661 * 1000) === "01:01:01");
check("formatElapsedHms handles more than 24 hours", durationMod.formatElapsedHms(25 * 3600 * 1000 + 5 * 1000) === "25:00:05");
check("formatElapsedHms derives from elapsed ms (not counter)", durationMod.formatElapsedHms(0) === "00:00:00");

if (failures.length) {
  console.error(`FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`ok - employee dashboard shift clock (${passed} checks)`);
