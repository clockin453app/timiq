/**
 * Force clock-in / clock-out date and time coverage.
 *
 * Part 1 executes the shared datetime-local <-> ISO helpers for real, so the
 * timezone contract is behaviourally verified rather than string-matched.
 * Part 2 asserts the Live Attendance modals wire that value into form state,
 * the request payload, and the error surface.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = new URL("../src/", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
const failures = [];
function check(label, condition) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(label);
  }
}

/* ------------------------------------------------------------------ *
 * 1. Shared datetime-local helpers, executed
 * ------------------------------------------------------------------ */

function loadModule(relative) {
  const source = read(relative);
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(transpiled, { module, exports: module.exports, require, console });
  return module.exports;
}

const dt = loadModule("lib/datetime-local.ts");

check("toDatetimeLocalValue is exported", typeof dt.toDatetimeLocalValue === "function");
check("fromDatetimeLocalToIso is exported", typeof dt.fromDatetimeLocalToIso === "function");
check("nowDatetimeLocalValue is exported", typeof dt.nowDatetimeLocalValue === "function");

// A datetime-local value is wall-clock in the host timezone; round-tripping it
// must return the same wall clock, whatever the runner's offset is.
for (const wall of ["2026-01-15T09:05", "2026-06-30T23:59", "2026-12-31T00:00", "2026-02-28T12:00"]) {
  const iso = dt.fromDatetimeLocalToIso(wall);
  check(`${wall} converts to a UTC ISO instant`, /Z$/.test(iso));
  check(`${wall} survives a local round trip`, dt.toDatetimeLocalValue(iso) === wall);
}

// DST boundaries. A wall-clock time that does not exist (spring forward) is
// normalised forward by the platform rather than discarded, and a wall-clock
// time that occurs twice (fall back) resolves to one real instant. In both cases
// the conversion must be a fixed point: converting again must not drift, which
// is what would happen under a double UTC conversion.
for (const [label, wall] of [
  ["UK spring-forward morning", "2026-03-29T01:30"],
  ["UK fall-back morning", "2026-10-25T01:30"],
  ["US spring-forward morning", "2026-03-08T02:30"],
]) {
  const iso = dt.fromDatetimeLocalToIso(wall);
  check(`${label} still produces a valid UTC instant`, /Z$/.test(iso) && !Number.isNaN(Date.parse(iso)));

  const settled = dt.toDatetimeLocalValue(iso);
  check(`${label} normalises to a real local wall clock`, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(settled));
  check(
    `${label} does not drift on a second round trip`,
    dt.toDatetimeLocalValue(dt.fromDatetimeLocalToIso(settled)) === settled,
  );
  check(`${label} never moves the instant backwards`, Date.parse(iso) >= Date.parse(`${wall}Z`) - 86400000);
}

// Minute precision must not be rounded or truncated to the hour.
const minutePrecise = dt.fromDatetimeLocalToIso("2026-02-10T14:37");
check("minutes are preserved through conversion", new Date(minutePrecise).getMinutes() === 37);
check(
  "the local wall-clock hour is preserved",
  new Date(minutePrecise).getHours() === 14,
);

// An overnight span stays ordered and spans the correct duration.
const overnightIn = dt.fromDatetimeLocalToIso("2026-04-02T22:15");
const overnightOut = dt.fromDatetimeLocalToIso("2026-04-03T06:45");
check("overnight clock-out sorts after clock-in", new Date(overnightOut) > new Date(overnightIn));
check(
  "overnight span is 8h30m",
  new Date(overnightOut).getTime() - new Date(overnightIn).getTime() === 8.5 * 3600 * 1000,
);

// Invalid input must be rejected rather than silently becoming "now".
for (const bad of ["", "   ", "not-a-date", "2026-13-45T99:99"]) {
  check(`invalid value ${JSON.stringify(bad)} yields no ISO string`, dt.fromDatetimeLocalToIso(bad) === "");
  check(`invalid value ${JSON.stringify(bad)} fails validation`, dt.isValidDatetimeLocalValue(bad) === false);
}
check("a well-formed value passes validation", dt.isValidDatetimeLocalValue("2026-05-05T08:00"));

// The default offered to the administrator is the current local minute.
const nowValue = dt.nowDatetimeLocalValue();
check("default value has datetime-local shape", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(nowValue));
check(
  "default value is the current local minute",
  nowValue === dt.toDatetimeLocalValue(new Date().toISOString()),
);
check("toDatetimeLocalValue rejects garbage", dt.toDatetimeLocalValue("nope") === "");

/* ------------------------------------------------------------------ *
 * 2. Live Attendance force-clock modals
 * ------------------------------------------------------------------ */

const live = read("app/(app)/live-attendance/live-attendance-client.tsx");
const liveApi = read("features/live-attendance/api.ts");

check("force-clock uses the shared helpers", /from "@\/lib\/datetime-local"/.test(live));
check(
  "no duplicated local datetime helper remains in Live Attendance",
  !/function (toDatetimeLocalValue|fromDatetimeLocalToIso)/.test(live),
);
check(
  "time-records reuses the shared helpers",
  /from "@\/lib\/datetime-local"/.test(read("app/(app)/time-records/time-records-client.tsx")) &&
    !/function fromDatetimeLocalToIso/.test(read("app/(app)/time-records/time-records-client.tsx")),
);
check(
  "payroll-report reuses the shared helpers",
  /from "@\/lib\/datetime-local"/.test(read("app/(app)/payroll-report/payroll-report-client.tsx")) &&
    !/function fromDatetimeLocalToIso/.test(read("app/(app)/payroll-report/payroll-report-client.tsx")),
);

check("clock-in timestamp lives in form state", /const \[clockInAtLocal, setClockInAtLocal\] = useState/.test(live));
check("clock-out timestamp lives in form state", /const \[clockOutAtLocal, setClockOutAtLocal\] = useState/.test(live));
check(
  "clock-in field is editable and bound to state",
  /id="force-clock-in-at"[\s\S]{0,220}type="datetime-local"[\s\S]{0,220}value=\{clockInAtLocal\}[\s\S]{0,220}setClockInAtLocal\(event\.target\.value\)/.test(
    live,
  ),
);
check(
  "clock-out field is editable and bound to state",
  /id="force-clock-out-at"[\s\S]{0,260}type="datetime-local"[\s\S]{0,260}value=\{clockOutAtLocal\}[\s\S]{0,260}setClockOutAtLocal\(event\.target\.value\)/.test(
    live,
  ),
);
check("opening clock-in defaults to the current local minute", /setClockInAtLocal\(nowDatetimeLocalValue\(\)\)/.test(live));
check("opening clock-out defaults to the current local minute", /setClockOutAtLocal\(nowDatetimeLocalValue\(\)\)/.test(live));

check(
  "clock-in payload carries the selected timestamp",
  /postManualClockIn\(\{[\s\S]{0,240}effective_at: effectiveAt,/.test(live),
);
check(
  "clock-out payload carries the selected timestamp",
  /postManualClockOut\(\{[\s\S]{0,240}effective_at: effectiveAt,/.test(live),
);
check(
  "submit is blocked when the clock-in timestamp is invalid",
  /const effectiveAt = fromDatetimeLocalToIso\(clockInAtLocal\);[\s\S]{0,200}Enter a valid clock-in date and time/.test(
    live,
  ),
);
check(
  "submit is blocked when the clock-out timestamp is invalid",
  /const effectiveAt = fromDatetimeLocalToIso\(clockOutAtLocal\);[\s\S]{0,200}Enter a valid clock-out date and time/.test(
    live,
  ),
);
check(
  "clock-out before clock-in is rejected client-side",
  /new Date\(effectiveAt\) <= new Date\(modalOutUser\.clock_in_at\)[\s\S]{0,160}must be after the clock-in time/.test(
    live,
  ),
);

// The invalid-timestamp guards must run before the busy flag is set, otherwise a
// rejected submit would leave the dialog spinning.
const clockInHandler = live.slice(
  live.indexOf("async function handleManualClockIn"),
  live.indexOf("async function handleManualClockOut"),
);
check("clock-in handler was located", clockInHandler.length > 0);
check(
  "clock-in validates before entering the busy state",
  clockInHandler.indexOf("Enter a valid clock-in date and time") <
    clockInHandler.indexOf("setActionBusy(true)"),
);
check(
  "clock-in re-enables submit in a finally block",
  /finally \{\s*setActionBusy\(false\);/.test(clockInHandler),
);
check(
  "clock-in surfaces server errors instead of closing silently",
  /catch \(error\) \{\s*setActionError\(/.test(clockInHandler) &&
    clockInHandler.indexOf("setModalInUser(null)") < clockInHandler.indexOf("catch (error)"),
);

check("API client accepts an optional effective_at", /effective_at\?: string;/.test(liveApi));
check(
  "both manual clock bodies expose effective_at",
  (liveApi.match(/effective_at\?: string;/g) ?? []).length === 2,
);

// Submit buttons are outside the scrolling form, so they must stay associated.
check("clock-in submit stays wired to its form", /form="force-clock-in-form"/.test(live));
check("clock-out submit stays wired to its form", /form="force-clock-out-form"/.test(live));
check("submit is disabled while saving", /disabled=\{actionBusy/.test(live));
check("busy state is visible in the submit label", /actionBusy \? "Saving…"/.test(live));
check("errors are announced", /role="alert"/.test(live));
check("long errors wrap", /break-words[\s\S]{0,200}color-danger-700/.test(live));
check(
  "the timezone the value is interpreted in is stated to the administrator",
  /Entered in your local time \(\$\{localTimeZoneLabel\}\) and stored in UTC/.test(live),
);

/* ------------------------------------------------------------------ *
 * 3. Mobile fit of the force-clock dialog
 * ------------------------------------------------------------------ */

const modal = read("components/ui/modal.tsx");
const formField = read("components/ui/form-field.tsx");
const globals = read("styles/globals.css");

check("force-clock uses the shared viewport-safe modal", /<Modal/.test(live));
check("modal width never exceeds the viewport", /max-w-full/.test(modal));
check("modal height is capped against dvh", /max-h-\[calc\(100dvh-1rem\)]/.test(modal));
check("modal body scrolls internally", /min-h-0 flex-1 overflow-y-auto/.test(modal));
check("modal header stays reachable", /shrink-0 border-b/.test(modal));
check("modal actions stay reachable", /shrink-0 border-t/.test(modal));
check("modal actions clear the home indicator", /env\(safe-area-inset-bottom/.test(modal));
check("modal traps escape", /event\.key === "Escape"/.test(modal));
check("modal blocks background scroll", /document\.body\.style\.overflow = "hidden"/.test(modal));
check("modal moves focus into the panel", /panelRef\.current\?\.focus\(\)/.test(modal));
check("backdrop click closes only from the backdrop", /event\.target === event\.currentTarget/.test(modal));
check("modal sits above the app shell chrome", /z-\[1200]/.test(modal));

check("form fields allow their controls to shrink", /min-w-0/.test(formField));
check("form action rows stack on narrow screens", /flex-col-reverse gap-2 sm:flex-row/.test(formField));
check("validation errors wrap", /break-words/.test(formField));

check(
  "native date/time controls are allowed to shrink below their intrinsic width",
  /input\.timiq-input\[type="datetime-local"\][\s\S]{0,400}min-width: 0/.test(globals),
);
check(
  "date/time controls are capped at the container width",
  /input\.timiq-input\[type="datetime-local"\][\s\S]{0,400}max-width: 100%/.test(globals),
);
check(
  "focused fields keep clear of the mobile keyboard",
  /scroll-margin-block: var\(--space-page-y\) var\(--layout-mobile-keyboard-pad\)/.test(globals),
);
check(
  "form controls stay at 16px on mobile so iOS does not zoom on focus",
  /--text-form-control: 1rem;/.test(read("styles/tokens.css")),
);

if (failures.length > 0) {
  console.error(`${failures.length} force clock check(s) failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`${passed} force clock date/time checks passed`);
